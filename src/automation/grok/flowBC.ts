/**
 * Grok flow B (image-to-video) and flow C (images-to-image); shared upload and settings-after-upload.
 */
import * as fs from 'fs'
import * as path from 'path'
import { SELECTORS } from '../selectors'
import { isVideoOutput } from '../types'
import type { GrokWorkerContext, GrokJob } from './context'
import { flowA_submit, enterPrompt } from './flowA'
import { configureInlinePromptBar, hasInlinePromptBar } from './inlinePromptBar'

const S  = SELECTORS
const SP = SELECTORS.settingsPopover
const SI = SELECTORS.settingsPopoverImageMode
const PI = SELECTORS.promptWithImage

export const STOP_AFTER_IMAGE_UPLOAD = false
export const STOP_AFTER_UPLOAD_WAIT_MS = 5 * 60 * 1000

export async function runFlowB(ctx: GrokWorkerContext, job: GrokJob): Promise<void> {
  if (job.mode !== 'image-to-video') throw new Error('runFlowB: wrong mode')

  const inline = await hasInlinePromptBar(ctx.page)

  if (inline) {
    ctx.emit('progress', { jobId: job.id, step: 'Cau hinh (Video, ratio, res)...', percent: 12 })
    await configureInlinePromptBar(ctx, job)
  }

  ctx.emit('progress', { jobId: job.id, step: 'Upload anh...', percent: 15 })
  await uploadImages(ctx, [(job as { imagePath: string }).imagePath])

  if (STOP_AFTER_IMAGE_UPLOAD) {
    ctx.log('info', `Stopping after image upload for DOM inspection (${STOP_AFTER_UPLOAD_WAIT_MS / 60000} min). Set STOP_AFTER_IMAGE_UPLOAD=false and update selectors to continue.`)
    await ctx.page.waitForTimeout(STOP_AFTER_UPLOAD_WAIT_MS)
    throw new Error('Stopped for DOM inspection — update selectors and set STOP_AFTER_IMAGE_UPLOAD=false')
  }

  if (!inline) {
    ctx.emit('progress', { jobId: job.id, step: 'Chon Make Video...', percent: 28 })
    await openSettingsAndSelect(ctx, job, SI.makeVideoFromImageModeBtn, 'Make Video', { skipRatioResolution: true })
  }

  ctx.emit('progress', { jobId: job.id, step: 'Nhap prompt...', percent: 40 })
  await enterPrompt(ctx, job.prompt)

  ctx.emit('progress', { jobId: job.id, step: 'Submit...', percent: 50 })
  if (inline) {
    await flowA_submit(ctx)
  } else {
    await flowB_submit(ctx)
  }
}

export async function runFlowC(ctx: GrokWorkerContext, job: GrokJob): Promise<void> {
  if (job.mode !== 'images-to-image') throw new Error('runFlowC: wrong mode')

  const imagePaths = (job as { imagePaths: string[] }).imagePaths
  const inline = await hasInlinePromptBar(ctx.page)

  if (inline) {
    ctx.emit('progress', { jobId: job.id, step: 'Cau hinh (Image, ratio)...', percent: 12 })
    await configureInlinePromptBar(ctx, job)
  }

  ctx.emit('progress', { jobId: job.id, step: `Upload ${imagePaths.length} anh...`, percent: 15 })
  await uploadImages(ctx, imagePaths)

  if (STOP_AFTER_IMAGE_UPLOAD) {
    ctx.log('info', `Stopping after image upload for DOM inspection (${STOP_AFTER_UPLOAD_WAIT_MS / 60000} min). Set STOP_AFTER_IMAGE_UPLOAD=false and update selectors to continue.`)
    await ctx.page.waitForTimeout(STOP_AFTER_UPLOAD_WAIT_MS)
    throw new Error('Stopped for DOM inspection — update selectors and set STOP_AFTER_IMAGE_UPLOAD=false')
  }

  if (!inline) {
    ctx.emit('progress', { jobId: job.id, step: 'Chon Edit Image...', percent: 28 })
    await openSettingsAndSelect(ctx, job, SI.makeImageFromImageModeBtn, 'Edit Image')
  }

  ctx.emit('progress', { jobId: job.id, step: 'Nhap prompt...', percent: 40 })
  await enterPrompt(ctx, job.prompt)

  ctx.emit('progress', { jobId: job.id, step: 'Submit...', percent: 50 })
  await flowA_submit(ctx)
}

export async function uploadImages(ctx: GrokWorkerContext, imagePaths: string[]): Promise<void> {
  const { page, log, waitStable } = ctx
  const valid = imagePaths.filter(p => p && fs.existsSync(p))
  if (valid.length === 0) throw new Error(`Không tìm thấy file ảnh: ${imagePaths.join(', ')}`)

  let fileInput = page.locator(S.upload.fileInputQueryBar).first()
  if (await fileInput.count() === 0) {
    fileInput = page.locator(S.upload.fileInput).first()
  }
  if (await fileInput.count() === 0) {
    await page.click(S.prompt.attachBtn)
    await waitStable()
    fileInput = page.locator(S.upload.fileInputQueryBar).first()
    if (await fileInput.count() === 0) {
      fileInput = page.locator(S.upload.fileInput).first()
    }
  }
  if (await fileInput.count() === 0) {
    throw new Error('Không tìm thấy input file sau khi mở Attach')
  }

  await fileInput.setInputFiles(valid.slice(0, 3))
  await waitStable()
  log('info', `Upload: ${valid.map(p => path.basename(p)).join(', ')}`)
}

export async function openSettingsAndSelect(
  ctx: GrokWorkerContext,
  job: GrokJob,
  itemSelector: string,
  label: string,
  options?: { skipRatioResolution?: boolean }
): Promise<void> {
  const { page, log, waitStable } = ctx

  await page.click(S.prompt.settingsBtn)
  await waitStable()
  await page.waitForSelector(SP.container, { timeout: 8000 })

  if (!options?.skipRatioResolution) {
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
  }

  await page.locator(itemSelector).click()
  await waitStable()
  log('info', `Chon: ${label}`)
}

export async function flowB_submit(ctx: GrokWorkerContext): Promise<void> {
  const { page, log, waitStable } = ctx
  const btn = page.locator(PI.makeVideoBtn)
  await btn.waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForFunction(
    (sel: string) => { const b = document.querySelector(sel) as HTMLButtonElement | null; return b && !b.disabled },
    PI.makeVideoBtn,
    { timeout: 10000 }
  )
  await btn.click()
  await waitStable()
  log('info', 'Submit (Flow B)')
}
