/**
 * FLOW AUTOMATION — BrowserWorker (Grok)
 * Orchestrates grok.com/imagine flows; delegates to grok/ modules.
 */
import { BrowserContext, Page } from 'patchright'
import {
  GrokJob,
  JobResult,
  WorkerEventHandler,
  WorkerEventType,
  isVideoOutput,
} from './types'
import type { GrokWorkerContext } from './grok/context'
import { runFlowA } from './grok/flowA'
import { runFlowB, runFlowC } from './grok/flowBC'
import { setupNetworkIntercept } from './grok/network'
import { waitForGeneration, upscaleVideo, downloadMedia } from './grok/waitAndDownload'
import { SELECTORS } from './selectors'

const DOM_STABLE_MS = 1000
const GROK_URL = 'https://grok.com/imagine'
const S = SELECTORS

export class BrowserWorker {
  private ctx:              BrowserContext
  private profileId:        string
  private page:             Page | null = null
  private onEvent:          WorkerEventHandler
  private onLog?:           (level: 'info' | 'warn' | 'error', message: string) => void
  private capturedMediaUrl: string | null = null
  private upscaledMediaUrl: string | null = null

  constructor(ctx: BrowserContext, profileId: string, onEvent: WorkerEventHandler, opts?: { onLog?: (level: 'info' | 'warn' | 'error', message: string) => void }) {
    this.ctx       = ctx
    this.profileId = profileId
    this.onEvent   = onEvent
    this.onLog     = opts?.onLog
  }

  async run(job: GrokJob, outputPath: string): Promise<JobResult & { deferred?: boolean; finalize?: Promise<void> }> {
    this.log('info', `[${job.id}] "${job.title}" mode:${job.mode}`)
    this.capturedMediaUrl = null
    this.upscaledMediaUrl = null

    try {
      const existingPage = await this.getOrCreateGrokTab()
      this.page = existingPage

      const ctx = this.getGrokContext()
      setupNetworkIntercept(ctx, job)

      this.emit('progress', { jobId: job.id, step: 'Mo grok.com/imagine...', percent: 5 })
      try {
        if (!this.page.url().includes('grok.com/imagine')) {
          await this.page.goto(GROK_URL, { waitUntil: 'domcontentloaded' })
        } else {
          // Reload trước mỗi job để thanh prompt / preview ảnh không dùng chung DOM state (nhiều profile song song)
          await this.page.reload({ waitUntil: 'domcontentloaded' })
        }
        await Promise.race([
          this.page.waitForSelector(S.prompt.input, { timeout: 8000 }),
          this.page.waitForSelector(S.inlinePromptBar.generationModeGroup, { timeout: 8000 }),
        ]).catch(() => {
          this.log('warn', 'Homepage chua on dinh theo selector, van tiep tuc flow')
        })
        await this.page.waitForTimeout(120)
      } catch (e) {
        this.log('warn', `Tai trang imagine: ${e}`)
      }

      switch (job.mode) {
        case 'prompt-to-image':
        case 'prompt-to-video':
          await runFlowA(ctx, job)
          break
        case 'image-to-video':
          await runFlowB(ctx, job)
          break
        case 'images-to-image':
          await runFlowC(ctx, job)
          break
      }

      this.emit('progress', { jobId: job.id, step: 'AI dang render...', percent: 55 })
      await waitForGeneration(ctx, job)

      const needUpscale = isVideoOutput(job)
      if (needUpscale) {
        this.emit('progress', { jobId: job.id, step: 'Upscale video...', percent: 75 })
        await upscaleVideo(ctx, job)
      }

      this.emit('progress', { jobId: job.id, step: 'Dang tai file ve...', percent: 90 })
      await downloadMedia(ctx, needUpscale, outputPath)
      this.emit('progress', { jobId: job.id, step: 'Hoan thanh!', percent: 100 })
      this.emit('completed', { jobId: job.id, filePath: outputPath })
      this.log('info', `Done -> ${outputPath}`)

      if (this.page) {
        try {
          this.log('info', 'Quay ve grok.com/imagine cho job tiep theo')
          await this.page.goto(GROK_URL, { waitUntil: 'domcontentloaded' })
          await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
        } catch (_) { /* ignore */ }
      }
      this.page = null
      return { jobId: job.id, success: true, filePath: outputPath }

    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.emit('failed', { jobId: job.id, error })
      this.log('error', `That bai: ${error}`)
      if (this.page) {
        try {
          this.log('info', 'Quay ve grok.com/imagine cho job tiep theo')
          await this.page.goto(GROK_URL, { waitUntil: 'domcontentloaded' })
          await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
        } catch (_) { /* ignore */ }
      }
      return { jobId: job.id, success: false, error }

    } finally {
      this.capturedMediaUrl = null
      this.upscaledMediaUrl = null
    }
  }

  private getOrCreateGrokTab(): Promise<Page> {
    const grokUrl = 'grok.com/imagine'
    for (const p of this.ctx.pages()) {
      try {
        if (p.url().includes(grokUrl)) {
          this.log('info', 'Tai su dung tab grok.com/imagine')
          p.removeAllListeners('request')
          return Promise.resolve(p)
        }
      } catch {
        /* page closed */
      }
    }
    return this.ctx.newPage()
  }

  private getGrokContext(): GrokWorkerContext {
    if (!this.page) throw new Error('Page chưa khởi tạo')
    return {
      page: this.page,
      emit: (type, payload) => this.emit(type as WorkerEventType, payload as Record<string, any>),
      log: (level, message) => this.log(level, message),
      waitStable: () => this.waitStable(),
      getCapturedMediaUrl: () => this.capturedMediaUrl,
      setCapturedMediaUrl: (url) => { this.capturedMediaUrl = url },
      getUpscaledMediaUrl: () => this.upscaledMediaUrl,
      setUpscaledMediaUrl: (url) => { this.upscaledMediaUrl = url },
    }
  }

  private emit(type: WorkerEventType, payload: Record<string, unknown>) {
    this.onEvent(type as any, { ...payload, profileId: this.profileId } as any)
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString()
    console.log(`[${ts}][${this.profileId.slice(0, 8)}][${level.slice(0, 3).toUpperCase()}] ${message}`)
    this.onLog?.(level, message)
    this.onEvent('log' as any, { level, message, timestamp: ts } as any)
  }

  private async waitStable(): Promise<void> {
    if (this.page) await this.page.waitForTimeout(DOM_STABLE_MS)
  }
}
