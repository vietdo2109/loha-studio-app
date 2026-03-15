/**
 * FLOW AUTOMATION — ProfileManager
 * File: src/automation/ProfileManager.ts
 *
 * Quản lý vòng đời của các Chrome profiles:
 *   - Tạo mới N profiles (xóa profile cũ nếu có)
 *   - Chạy AccountCreator song song trên tất cả profiles
 *   - Cung cấp danh sách profiles ready cho JobDistributor
 *   - Dọn dẹp profiles khi user bấm "Create accounts" lần mới
 */

import { chromium, BrowserContext } from 'patchright'
import * as fs from 'fs'
import * as path from 'path'
import { AccountCreator, AccountCreatorResult } from './AccountCreator'
import { WorkerEventHandler } from './types'

// ─── Profile record ───────────────────────────────────────────────────────────

export type ProfileStatus =
  | 'creating'    // đang chạy AccountCreator
  | 'ready'       // đã login, đang chờ job
  | 'running'     // đang chạy job
  | 'exhausted'   // hết quota 20 jobs
  | 'failed'      // tạo tài khoản thất bại

export interface ProfileRecord {
  profileId:  string          // 'account-001', 'account-002', ...
  profileDir: string          // path tuyệt đối đến folder profile
  status:     ProfileStatus
  email?:     string          // email đã dùng để đăng ký
  jobsDone:   number          // số jobs đã chạy
  ctx?:       BrowserContext  // giữ context để JobDistributor dùng
  error?:     string
}

// ─── ProfileManager ───────────────────────────────────────────────────────────

export class ProfileManager {
  private profilesBaseDir: string
  private profiles:        Map<string, ProfileRecord> = new Map()
  private onEvent:         WorkerEventHandler

  constructor(profilesBaseDir: string, onEvent: WorkerEventHandler) {
    this.profilesBaseDir = path.resolve(profilesBaseDir)
    this.onEvent         = onEvent
  }

  // ─── Tạo N tài khoản mới song song ───────────────────────────────────────
  //
  // Khi gọi hàm này:
  //   1. Xóa toàn bộ profiles cũ
  //   2. Tạo N profile folders mới
  //   3. Mở N Chrome instances song song
  //   4. Chạy AccountCreator trên mỗi instance
  //   5. Return danh sách profiles đã ready
  //
  async createAccounts(count: number): Promise<ProfileRecord[]> {
    this.log('info', `Bắt đầu tạo ${count} tài khoản...`)

    // Xóa profiles cũ
    await this.deleteAllProfiles()

    // Tạo profile folders + records
    const profileIds = Array.from({ length: count }, (_, i) =>
      `account-${String(i + 1).padStart(3, '0')}`  // account-001, account-002...
    )

    // Mở tất cả Chrome instances song song
    this.log('info', `Mở ${count} Chrome profiles...`)
    const setupResults = await Promise.allSettled(
      profileIds.map(profileId => this.setupProfile(profileId))
    )

    // Log kết quả
    const ready   = this.getReadyProfiles()
    const failed  = [...this.profiles.values()].filter(p => p.status === 'failed')

    this.log('info', `Hoàn tất: ${ready.length}/${count} profiles ready, ${failed.length} thất bại`)
    if (failed.length > 0) {
      failed.forEach(p => this.log('warn', `  ✗ ${p.profileId}: ${p.error}`))
    }

    return ready
  }

  // ─── Setup 1 profile: mở Chrome + chạy AccountCreator ───────────────────
  private async setupProfile(profileId: string): Promise<void> {
    const profileDir = path.join(this.profilesBaseDir, profileId)

    // Tạo folder nếu chưa có
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true })
    }

    const record: ProfileRecord = {
      profileId,
      profileDir,
      status:   'creating',
      jobsDone: 0,
    }
    this.profiles.set(profileId, record)

    let ctx: BrowserContext | null = null

    try {
      // Stagger theo so thu tu account de tranh 429 khi goi mail.tm dong thoi
      // account-001 = 0s, account-002 = 3s, account-003 = 6s, ...
      const accountIndex = parseInt(profileId.split('-')[1] ?? '1', 10) - 1
      await new Promise(r => setTimeout(r, accountIndex * 3000))

      // Mở Chrome profile trắng
      ctx = await chromium.launchPersistentContext(profileDir, {
        channel:  'chrome',
        headless: false,
        viewport: { width: 1280, height: 700 },
        args: ['--no-sandbox'],
      })

      record.ctx = ctx

      // Chạy AccountCreator
      const creator = new AccountCreator(ctx, profileId, this.onEvent)
      const result: AccountCreatorResult = await creator.createAccount()

      if (result.success) {
        record.status = 'ready'
        record.email  = result.email
        this.log('info', `✅ ${profileId} ready (${result.email})`)
      } else {
        record.status = 'failed'
        record.error  = result.error
        // KHÔNG đóng Chrome — giữ mở để debug
      }

    } catch (err: any) {
      record.status = 'failed'
      record.error  = err.message ?? String(err)
      this.log('error', `❌ ${profileId} thất bại: ${record.error}`)
      // KHÔNG đóng Chrome khi lỗi — giữ mở để debug
      // ctx sẽ được đóng thủ công hoặc khi closeAll() được gọi
    }
  }

  // Retry các profiles bị failed — chạy lại AccountCreator trên từng profile
async retryFailedAccounts(): Promise<ProfileRecord[]> {
  const failed = [...this.profiles.values()].filter(p => p.status === 'failed')
  if (failed.length === 0) {
    this.log('info', 'Khong co profile nao can retry')
    return []
  }

  this.log('info', `Retry ${failed.length} profiles that bai...`)

  // Reset status truoc khi retry
  for (const record of failed) {
    record.status = 'creating'
    record.error  = undefined
  }

  // Chay lai song song, stagger 4s theo thu tu
  await Promise.allSettled(
    failed.map((record, i) => this.retryProfile(record, i))
  )

  const nowReady = failed.filter(p => p.status === 'ready')
  this.log('info', `Retry xong: ${nowReady.length}/${failed.length} thanh cong`)
  return nowReady
}

private async retryProfile(record: ProfileRecord, retryIndex: number): Promise<void> {
  // Stagger de tranh 429
  await new Promise(r => setTimeout(r, retryIndex * 4000))

  // Neu chua co Chrome context thi mo lai
  if (!record.ctx) {
    if (!fs.existsSync(record.profileDir)) {
      fs.mkdirSync(record.profileDir, { recursive: true })
    }
    try {
      record.ctx = await chromium.launchPersistentContext(record.profileDir, {
        channel:  'chrome',
        headless: false,
        viewport: { width: 1280, height: 700 },
        args: ['--no-sandbox'],
      })
    } catch (err: any) {
      record.status = 'failed'
      record.error  = `Khong mo duoc Chrome: ${err.message}`
      return
    }
  }

  const creator = new AccountCreator(record.ctx, record.profileId, this.onEvent)
  const result  = await creator.createAccount()

  if (result.success) {
    record.status = 'ready'
    record.email  = result.email
    this.log('info', `Retry OK: ${record.profileId} (${result.email})`)
  } else {
    record.status = 'failed'
    record.error  = result.error
  }
}

  // ─── Getters cho JobDistributor ───────────────────────────────────────────

  getReadyProfiles(): ProfileRecord[] {
    return [...this.profiles.values()].filter(p => p.status === 'ready')
  }

  getAllProfiles(): ProfileRecord[] {
    return [...this.profiles.values()]
  }

  getProfile(profileId: string): ProfileRecord | undefined {
    return this.profiles.get(profileId)
  }

  markRunning(profileId: string) {
    const p = this.profiles.get(profileId)
    if (p) p.status = 'running'
  }

  markReady(profileId: string) {
    const p = this.profiles.get(profileId)
    if (p) p.status = 'ready'
  }

  markExhausted(profileId: string) {
    const p = this.profiles.get(profileId)
    if (p) {
      p.status = 'exhausted'
      this.log('warn', `${profileId} hết quota (${p.jobsDone} jobs)`)
    }
  }

  incrementJobsDone(profileId: string) {
    const p = this.profiles.get(profileId)
    if (p) p.jobsDone++
  }

  // ─── Xóa toàn bộ profiles cũ ─────────────────────────────────────────────
  async deleteAllProfiles(): Promise<void> {
    // Đóng tất cả contexts đang mở
    for (const record of this.profiles.values()) {
      if (record.ctx) {
        try { await record.ctx.close() } catch {}
      }
    }
    this.profiles.clear()

    // Xóa folder profiles
    if (fs.existsSync(this.profilesBaseDir)) {
      fs.rmSync(this.profilesBaseDir, { recursive: true, force: true })
      this.log('info', `Đã xóa profiles cũ: ${this.profilesBaseDir}`)
    }

    // Tạo lại folder rỗng
    fs.mkdirSync(this.profilesBaseDir, { recursive: true })
  }

  // ─── Đóng tất cả contexts (khi app thoát) ────────────────────────────────
  async closeAll(): Promise<void> {
    for (const record of this.profiles.values()) {
      if (record.ctx) {
        try { await record.ctx.close() } catch {}
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private log(level: 'info' | 'warn' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString()
    console.log(`[${ts}][ProfileManager] ${message}`)
    this.onEvent('log' as any, { level, message, timestamp: ts } as any)
  }
}