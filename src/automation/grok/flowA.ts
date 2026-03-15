/**
 * Grok flow A (prompt-to-image / prompt-to-video) and shared helpers.
 */
import type { Page } from 'patchright'
import { SELECTORS } from '../selectors'
import { isVideoOutput } from '../types'
import type { GrokWorkerContext, GrokJob } from './context'

const S  = SELECTORS
const SP = SELECTORS.settingsPopover

export async function runFlowA(ctx: GrokWorkerContext, job: GrokJob): Promise<void> {
  ctx.emit('progress', { jobId: job.id, step: 'Cau hinh settings...', percent: 15 })
  await flowA_configureSettings(ctx, job)

  ctx.emit('progress', { jobId: job.id, step: 'Nhap prompt...', percent: 28 })
  await enterPrompt(ctx, job.prompt)

  ctx.emit('progress', { jobId: job.id, step: 'Submit...', percent: 40 })
  await flowA_submit(ctx)
}

export async function flowA_configureSettings(ctx: GrokWorkerContext, job: GrokJob): Promise<void> {
  const { page, log, waitStable } = ctx
  try {
    await page.click(S.prompt.settingsBtn)
    await waitStable()
    await page.waitForSelector(SP.container, { timeout: 10000 })
  } catch {
    log('warn', 'Khong tim thay nut Settings, bo qua cau hinh settings')
    return
  }

  const activeText = await page.textContent(SP.activeModeBtn).catch(() => '')
  const targetMode = isVideoOutput(job) ? 'Video' : 'Image'
  if (!activeText?.includes(targetMode)) {
    await page.click(targetMode === 'Image' ? SP.imageModeBtn : SP.videoModeBtn)
    await waitStable()
    log('info', `Switch mode -> ${targetMode}`)
  }

  await configureAspect(ctx, job)
}

export async function flowA_submit(ctx: GrokWorkerContext): Promise<void> {
  const { page, log, waitStable } = ctx
  await page.waitForFunction(
    (sel: string) => { const b = document.querySelector(sel) as HTMLButtonElement | null; return b && !b.disabled },
    S.prompt.submitBtn,
    { timeout: 10000 }
  )
  await page.click(S.prompt.submitBtn)
  await waitStable()
  log('info', 'Submit (Flow A)')
}

export async function configureAspect(ctx: GrokWorkerContext, job: GrokJob): Promise<void> {
  const { page, log, waitStable } = ctx
  try {
    await page.click(S.prompt.settingsBtn)
    await waitStable()
    await page.waitForSelector(SP.container, { timeout: 8000 })
  } catch {
    log('warn', 'Khong mo duoc settings popover de set ratio/resolution')
    return
  }

  try {
    await page.click(SP.ratioBtn(job.ratio as '2:3' | '3:2' | '1:1' | '9:16' | '16:9'))
    await waitStable()
    log('info', `Ratio: ${job.ratio}`)
  } catch {
    log('warn', `Khong set duoc ratio ${job.ratio}`)
  }

  if (isVideoOutput(job) && (job as { resolution?: string }).resolution) {
    try {
      await page.click(SP.resolutionBtn((job as { resolution: '480p' | '720p' }).resolution))
      await waitStable()
    } catch {
      log('warn', `Resolution ${(job as { resolution: string }).resolution} khong tim thay`)
    }
  }

  await page.keyboard.press('Escape')
  await waitStable()
}

export async function enterPrompt(ctx: GrokWorkerContext, prompt: string): Promise<void> {
  const { page, log, waitStable } = ctx
  await page.click(S.prompt.input)
  await waitStable()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')

  const lines = prompt.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      await page.keyboard.type(lines[i], { delay: 20 })
    }
    if (i < lines.length - 1) {
      await page.keyboard.press('Shift+Enter')
    }
  }
  log('info', `Prompt: "${prompt.slice(0, 60)}${prompt.length > 60 ? '...' : ''}"`)
}
