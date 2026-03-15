/**
 * FLOW AUTOMATION - Test Login Accounts
 * File: src/test-login-accounts.ts
 * Chay: npx ts-node src/test-login-accounts.ts
 *
 * Mo profile Chrome MOI HOAN TOAN cho moi lan login
 * (khong xoa profile cu, dung folder theo timestamp)
 */

import path from 'path'
import * as fs from 'fs'
import { chromium, BrowserContext } from 'patchright'

import { WorkerEventType } from './automation/types'
import { AccountLogin, parseCredentialsFile } from './automation/AccountLogin'

const CONFIG = {
  credentialsFile: path.resolve('./credentials.txt'),

  // Profiles duoc luu vao subfolder theo session timestamp
  // Vi du: profiles/session-1748123456789/account-001/
  // Profile cu van con nguyen trong profiles/session-.../
  profilesDir: path.resolve('./profiles'),

  staggerMs: 1500,
}

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
const openContexts: BrowserContext[] = []

async function main() {
  log('Test Login Accounts')

  if (!fs.existsSync(CONFIG.credentialsFile)) {
    log(`Khong tim thay: ${CONFIG.credentialsFile}`)
    log('Tao file credentials.txt, moi dong: email:password')
    process.exit(1)
  }

  const credentials = parseCredentialsFile(CONFIG.credentialsFile)
  log(`Doc duoc ${credentials.length} credentials`)
  credentials.forEach((c, i) => log(`   ${i + 1}. ${c.email}`))

  // Tao session folder moi theo timestamp - profiles cu khong bi anh huong
  const sessionId  = `session-${Date.now()}`
  const sessionDir = path.join(CONFIG.profilesDir, sessionId)
  fs.mkdirSync(sessionDir, { recursive: true })
  log(`Session moi: ${sessionDir}`)
  log('─────────────────────────────────────────────')

  process.on('SIGINT', async () => {
    log('\nDang dong Chrome...')
    for (const ctx of openContexts) { try { await ctx.close() } catch {} }
    process.exit(0)
  })

  const results = await Promise.allSettled(
    credentials.map((cred, i) => loginProfile(cred, i, sessionDir))
  )

  log('─────────────────────────────────────────────')
  const success = results.filter(r => r.status === 'fulfilled' && r.value.success).length
  const failed  = credentials.length - success
  log(`Ket qua: ${success}/${credentials.length} thanh cong, ${failed} that bai`)

  if (failed === 0) {
    log('Tat ca profiles ready!')
    for (const ctx of openContexts) { try { await ctx.close() } catch {} }
    process.exit(0)
  } else {
    log('Browser giu mo de debug - Ctrl+C de thoat')
  }
}

async function loginProfile(
  cred: { email: string; password: string },
  index: number,
  sessionDir: string
): Promise<{ success: boolean; email: string; error?: string }> {
  const profileId  = `account-${String(index + 1).padStart(3, '0')}`
  // Profile folder nam trong session folder -> hoan toan moi
  const profileDir = path.join(sessionDir, profileId)
  fs.mkdirSync(profileDir, { recursive: true })

  // Stagger
  await new Promise(r => setTimeout(r, index * CONFIG.staggerMs))

  let ctx: BrowserContext
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      channel:  'chrome',
      headless: false,
      viewport: { width: 1280, height: 700 },
      args:     ['--no-sandbox'],
    })
    openContexts.push(ctx)
  } catch (err: any) {
    log(`[${profileId}] Khong mo duoc Chrome: ${err.message}`)
    return { success: false, email: cred.email, error: err.message }
  }

  const login = new AccountLogin(ctx, profileId, (type: WorkerEventType, payload: any) => {
    if (type === 'progress') {
      process.stdout.write(
        `\r  [${profileId}] ${String(payload.step).padEnd(28)} ${String(payload.percent).padStart(3)}%`
      )
      if (payload.percent === 100) process.stdout.write('\n')
    } else if (type === 'completed') {
      log(`  OK   [${payload.profileId}] ${payload.email}`)
    } else if (type === 'failed') {
      log(`\n  FAIL [${payload.profileId}] ${payload.error}`)
    } else if (type === 'log' && payload.level !== 'info') {
      log(`  ${payload.level.toUpperCase()} [${profileId}] ${payload.message}`)
    }
  })

  const result = await login.login(cred)
  return { success: result.success, email: cred.email, error: result.error }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })