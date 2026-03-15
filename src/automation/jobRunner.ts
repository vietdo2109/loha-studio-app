/**
 * FLOW AUTOMATION — JobRunner
 * File: src/automation/JobRunner.ts
 *
 * Điều phối chạy danh sách GrokJob tuần tự trên 1 Chrome profile.
 * Nhận mảng jobs, chạy từng job, emit events và tổng kết kết quả.
 */

import { BrowserContext } from 'patchright'
import { GrokJob, JobResult, WorkerEventHandler } from './types'
import { BrowserWorker } from './BrowserWorker'
import { resolveOutputPath } from './inputParser'

export interface RunnerResult {
  total:   number
  success: number
  failed:  number
  results: JobResult[]
}

export class JobRunner {
  private ctx:      BrowserContext
  private profileId: string
  private onEvent:  WorkerEventHandler

  constructor(ctx: BrowserContext, profileId: string, onEvent: WorkerEventHandler) {
    this.ctx       = ctx
    this.profileId = profileId
    this.onEvent   = onEvent
  }

  /**
   * Chạy tuần tự tất cả jobs.
   * @param jobs       danh sách GrokJob đã được build bởi InputParser
   * @param outputDir  thư mục output (outputBaseDir/videoTitle)
   */
  async runAll(jobs: GrokJob[], outputDir: string): Promise<RunnerResult> {
    const results: JobResult[] = []

    for (let i = 0; i < jobs.length; i++) {
      const job   = jobs[i]
      const index = i + 1   // 1-based index cho tên file
      const outputPath = resolveOutputPath(outputDir, index, { mode: job.mode } as any)

      this.log('info', `── Job ${index}/${jobs.length}: [${job.id}] "${job.title}"`)

      const worker = new BrowserWorker(this.ctx, this.profileId, this.onEvent)
      const result = await worker.run(job, outputPath)
      results.push(result)

      if (!result.success) {
        this.log('warn', `Job ${index} thất bại: ${result.error}`)
        // Tiếp tục job tiếp theo thay vì dừng
      }
    }

    const success = results.filter(r => r.success).length
    const failed  = results.filter(r => !r.success).length

    this.log('info', `Tổng kết: ${success}/${results.length} thành công, ${failed} thất bại`)
    return { total: results.length, success, failed, results }
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString()
    console.log(`[${ts}][runner] ${message}`)
    this.onEvent('log' as any, { level, message, timestamp: ts } as any)
  }
}