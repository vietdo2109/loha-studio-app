/**
 * Grok Imagine — inline prompt bar (03/2026): Generation mode, Aspect Ratio menu,
 * Video resolution / duration (when Video). Thay thế popover Settings cũ.
 */
import { SELECTORS } from '../selectors'
import type { Duration, GrokJob } from '../types'
import { isVideoOutput } from '../types'
import type { GrokWorkerContext } from './context'

const INLINE = SELECTORS.inlinePromptBar

export async function hasInlinePromptBar(page: GrokWorkerContext['page']): Promise<boolean> {
  return (await page.locator(INLINE.generationModeGroup).count()) > 0
}

export async function setGenerationMode(ctx: GrokWorkerContext, mode: 'Image' | 'Video'): Promise<void> {
  const { page, log, waitStable } = ctx
  const group = page.locator(INLINE.generationModeGroup)
  await group.getByRole('radio', { name: mode, exact: true }).click()
  await waitStable()
  log('info', `Generation mode: ${mode}`)
}

export async function pickAspectRatio(ctx: GrokWorkerContext, ratio: string): Promise<void> {
  const { page, log, waitStable } = ctx
  await page.locator(INLINE.aspectRatioBtn).click()
  await waitStable()
  await page.getByRole('menuitem', { name: ratio, exact: true }).click()
  await waitStable()
  log('info', `Aspect ratio: ${ratio}`)
}

function jobDuration(job: GrokJob): Duration {
  const d = (job as { duration?: Duration }).duration
  return d === '10s' ? '10s' : '6s'
}

export async function setVideoResolution(ctx: GrokWorkerContext, res: '480p' | '720p'): Promise<void> {
  const { page, log, waitStable } = ctx
  const group = page.locator(INLINE.videoResolutionGroup)
  await group.waitFor({ state: 'visible', timeout: 8000 })
  await group.getByRole('radio', { name: res, exact: true }).click()
  await waitStable()
  log('info', `Video resolution: ${res}`)
}

export async function setVideoDuration(ctx: GrokWorkerContext, dur: Duration): Promise<void> {
  const { page, log, waitStable } = ctx
  const group = page.locator(INLINE.videoDurationGroup)
  await group.waitFor({ state: 'visible', timeout: 8000 })
  await group.getByRole('radio', { name: dur, exact: true }).click()
  await waitStable()
  log('info', `Video duration: ${dur}`)
}

/**
 * Cấu hình đầy đủ inline bar theo job (Image vs Video, ratio, res/duration khi video).
 */
export async function configureInlinePromptBar(ctx: GrokWorkerContext, job: GrokJob): Promise<void> {
  const { log } = ctx
  const targetMode: 'Image' | 'Video' = isVideoOutput(job) ? 'Video' : 'Image'
  await setGenerationMode(ctx, targetMode)

  if (isVideoOutput(job)) {
    const j = job as { resolution: '480p' | '720p' }
    await setVideoResolution(ctx, j.resolution)
    await setVideoDuration(ctx, jobDuration(job))
  }

  try {
    await pickAspectRatio(ctx, job.ratio)
  } catch (e) {
    log('warn', `Không set được aspect ratio ${job.ratio}: ${String(e)}`)
  }
}
