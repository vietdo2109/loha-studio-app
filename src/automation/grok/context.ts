import type { Page } from 'patchright'
import type { GrokJob } from '../types'

export interface GrokWorkerContext {
  page: Page
  emit: (type: string, payload: Record<string, unknown>) => void
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  waitStable: () => Promise<void>
  getCapturedMediaUrl: () => string | null
  setCapturedMediaUrl: (url: string) => void
  getUpscaledMediaUrl: () => string | null
  setUpscaledMediaUrl: (url: string) => void
}

export type { GrokJob }
