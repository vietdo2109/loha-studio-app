/**
 * Grok wait for generation, upscale video, and download media.
 */
import * as fs from 'fs'
import * as path from 'path'
import { SELECTORS } from '../selectors'
import type { GrokWorkerContext, GrokJob } from './context'

const S  = SELECTORS
const OP = SELECTORS.output

export async function waitForGeneration(ctx: GrokWorkerContext, job: GrokJob, timeoutMs = 8 * 60 * 1000): Promise<void> {
  const { page, log, emit, getCapturedMediaUrl } = ctx
  const start = Date.now()
  let lastPct = 0
  const minWaitBeforeCaptureMs = 10000

  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(2000)

    if (getCapturedMediaUrl() && (Date.now() - start >= minWaitBeforeCaptureMs)) {
      log('info', 'Generate xong!')
      return
    }

    try {
      const txt = await page.textContent(S.generating.progressText)
      if (txt) {
        const pct = parseInt(txt)
        if (!isNaN(pct) && pct !== lastPct) {
          lastPct = pct
          emit('progress', {
            jobId: job.id,
            step: `Render... ${pct}%`,
            percent: 55 + Math.floor(pct * 0.18),
          })
        }
      }
    } catch { /* ignore */ }

    const mainText = await page.textContent('main').catch(() => '')
    if (mainText?.includes('out of') || mainText?.includes('quota')) {
      throw new Error('OUT_OF_QUOTA')
    }
  }

  throw new Error(`TIMEOUT sau ${timeoutMs / 60000} phút`)
}

export async function upscaleVideo(ctx: GrokWorkerContext, job: GrokJob, timeoutMs = 5 * 60 * 1000): Promise<void> {
  const { page, log, emit, waitStable, getUpscaledMediaUrl } = ctx

  try {
    await page.waitForSelector(OP.moreOptionsBtn, { timeout: 15000 })
  } catch {
    log('warn', 'Không tìm thấy More options — bỏ qua upscale')
    return
  }

  await page.click(OP.moreOptionsBtn)
  await waitStable()

  const upscaleItem = page.locator(OP.upscaleMenuItem)
  if (await upscaleItem.count() === 0) {
    log('warn', 'Không có Upscale video trong menu — bỏ qua')
    await page.keyboard.press('Escape')
    return
  }

  await upscaleItem.click()
  await waitStable()
  log('info', 'Da click Upscale video, cho xu ly...')

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(3000)

    if (getUpscaledMediaUrl()) {
      log('info', 'Upscale xong!')
      return
    }

    const elapsed = Math.floor((Date.now() - start) / 1000)
    emit('progress', {
      jobId: job.id,
      step: `Upscale... ${elapsed}s`,
      percent: Math.min(75 + elapsed, 88),
    })
  }

  log('warn', 'Upscale timeout - dung video goc')
}

export async function downloadMedia(
  ctx: GrokWorkerContext,
  preferUpscaled: boolean,
  outputPath: string
): Promise<void> {
  const { page, log, getCapturedMediaUrl, getUpscaledMediaUrl } = ctx

  const mediaUrl = (preferUpscaled && getUpscaledMediaUrl())
    ? getUpscaledMediaUrl()!
    : getCapturedMediaUrl()

  if (!mediaUrl) throw new Error('Không có media URL để download')

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  log('info', `Download: ${mediaUrl.split('/').pop()?.split('?')[0]} -> ${path.basename(outputPath)}`)

  const buffer = await page.evaluate(async (url: string) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'range': 'bytes=0-' },
    })
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    return Array.from(new Uint8Array(await res.arrayBuffer()))
  }, mediaUrl)

  fs.writeFileSync(outputPath, Buffer.from(buffer))

  const stat = fs.statSync(outputPath)
  if (stat.size < 1000) throw new Error(`File qua nho (${stat.size} bytes)`)
  log('info', `Done: ${(stat.size / 1024 / 1024).toFixed(2)} MB`)
}
