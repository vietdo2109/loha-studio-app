/**
 * FLOW AUTOMATION — JobDistributor
 * File: src/automation/JobDistributor.ts
 *
 * Phân phối jobs vào các profiles ready theo cơ chế queue động:
 *   - Có 1 queue chứa tất cả jobs
 *   - Mỗi profile xong 1 job → lấy job tiếp theo từ queue
 *   - Profile nào exhausted → đánh dấu, không nhận job mới
 *   - Chạy song song tất cả profiles
 */

import { GrokJob, JobResult, WorkerEventHandler } from './types'
import { BrowserWorker } from './BrowserWorker'
import { ProfileManager, ProfileRecord } from './ProfileManager'
import { resolveOutputPath } from './inputParser'
import * as path from 'path'

export interface DistributorResult {
  total:    number
  success:  number
  failed:   number
  results:  JobResult[]
}

export class JobDistributor {
  private profileManager: ProfileManager
  private onEvent:        WorkerEventHandler

  // Queue động — mỗi profile lấy job từ đây khi rảnh
  private jobQueue:    GrokJob[] = []
  private jobIndex:    number    = 0   // con trỏ vào jobQueue
  private allResults:  JobResult[] = []
  private outputDir:   string    = ''

  constructor(profileManager: ProfileManager, onEvent: WorkerEventHandler) {
    this.profileManager = profileManager
    this.onEvent        = onEvent
  }

  // ─── Public: bắt đầu phân phối jobs ─────────────────────────────────────
  async distribute(jobs: GrokJob[], outputDir: string): Promise<DistributorResult> {
    this.jobQueue  = [...jobs]
    this.jobIndex  = 0
    this.allResults = []
    this.outputDir = outputDir

    const readyProfiles = this.profileManager.getReadyProfiles()
    if (readyProfiles.length === 0) {
      throw new Error('Không có profile nào ready — hãy tạo accounts trước')
    }

    this.log('info', `Bắt đầu: ${jobs.length} jobs trên ${readyProfiles.length} profiles`)

    // Mỗi profile chạy worker loop song song
    await Promise.all(
      readyProfiles.map(profile => this.runWorkerLoop(profile))
    )

    const success = this.allResults.filter(r => r.success).length
    const failed  = this.allResults.filter(r => !r.success).length
    this.log('info', `Hoàn tất: ${success}/${jobs.length} thành công, ${failed} thất bại`)

    return {
      total:   jobs.length,
      success,
      failed,
      results: this.allResults,
    }
  }

  // ─── Worker loop cho 1 profile ────────────────────────────────────────────
  // Liên tục lấy job từ queue cho đến khi hết jobs hoặc profile exhausted
  private async runWorkerLoop(profile: ProfileRecord): Promise<void> {
    if (!profile.ctx) {
      this.log('warn', `${profile.profileId}: không có context, bỏ qua`)
      return
    }

    while (true) {
      // Lấy job tiếp theo từ queue (thread-safe vì JS single-threaded)
      const job = this.dequeueJob()
      if (!job) {
        this.log('info', `${profile.profileId}: hết jobs, dừng`)
        break
      }

      // Resolve output path: outputDir/index.ext
      const jobIndex   = this.jobQueue.indexOf(job) + 1  // 1-based
      const outputPath = resolveOutputPath(
        this.outputDir,
        jobIndex,
        { mode: job.mode } as any
      )

      this.profileManager.markRunning(profile.profileId)
      this.log('info', `${profile.profileId} → job [${job.id}] "${job.title}"`)

      const worker = new BrowserWorker(profile.ctx, profile.profileId, this.onEvent)
      const result = await worker.run(job, outputPath)

      this.allResults.push(result)

      if (!result.success) {
        // Kiểm tra có phải hết quota không
        if (result.error?.includes('OUT_OF_QUOTA')) {
          this.profileManager.markExhausted(profile.profileId)
          this.log('warn', `${profile.profileId} hết quota — requeue job [${job.id}]`)
          // Đẩy job lại vào queue để profile khác làm
          this.requeueJob(job)
          break
        }
        // Lỗi khác → log và tiếp tục job tiếp theo
        this.log('warn', `${profile.profileId} job [${job.id}] lỗi: ${result.error}`)
      } else {
        this.profileManager.incrementJobsDone(profile.profileId)
      }

      this.profileManager.markReady(profile.profileId)
    }
  }

  // ─── Queue operations ─────────────────────────────────────────────────────

  private dequeueJob(): GrokJob | null {
    if (this.jobIndex >= this.jobQueue.length) return null
    return this.jobQueue[this.jobIndex++]
  }

  // Đẩy job bị OUT_OF_QUOTA về cuối queue để profile khác xử lý
  private requeueJob(job: GrokJob): void {
    this.jobQueue.push(job)
    // jobIndex không cần thay đổi vì job đã được push vào cuối
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private log(level: 'info' | 'warn' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString()
    console.log(`[${ts}][Distributor] ${message}`)
    this.onEvent('log' as any, { level, message, timestamp: ts } as any)
  }
}