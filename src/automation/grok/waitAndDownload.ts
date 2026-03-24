/**
 * Grok wait for generation, upscale video, and download media.
 */
import * as fs from 'fs'
import * as path from 'path'
import { SELECTORS } from '../selectors'
import type { GrokWorkerContext, GrokJob } from './context'

const S  = SELECTORS
const OP = SELECTORS.output

async function clickGeneratingTextToCollapsePrompt(
  page: GrokWorkerContext['page'],
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
): Promise<boolean> {
  try {
    // Prefer clicking the progress text ("8%", "16%", ...) to avoid hitting "Cancel Video".
    const progress = page.locator(S.generating.progressText).first()
    if (await progress.isVisible().catch(() => false)) {
      await progress.click({ timeout: 1200, force: true }).catch(() => null)
      await page.waitForTimeout(80).catch(() => null)
      log?.('info', 'Da click vao text "Generating %" de thu gon prompt bar')
      return true
    }
    const generatingLabel = page.locator(S.generating.badge).first()
    if (await generatingLabel.isVisible().catch(() => false)) {
      await generatingLabel.click({ timeout: 1200, force: true }).catch(() => null)
      await page.waitForTimeout(80).catch(() => null)
      log?.('info', 'Da click vao badge "Generating" de thu gon prompt bar')
      return true
    }
  } catch {
    // ignore and let fallback run
  }
  return false
}

export async function waitForGeneration(ctx: GrokWorkerContext, job: GrokJob, timeoutMs = 8 * 60 * 1000): Promise<void> {
  const { page, log, emit, getCapturedMediaUrl } = ctx
  const start = Date.now()
  let lastPct = 0
  const minWaitBeforeCaptureMs = 10000
  let collapsePromptAttempts = 0

  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(2000)

    if (collapsePromptAttempts < 4) {
      const collapsed = await clickGeneratingTextToCollapsePrompt(page, collapsePromptAttempts === 0 ? log : undefined)
      if (collapsed) collapsePromptAttempts = 4
      else collapsePromptAttempts += 1
    }

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

  let openedMenu = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Trial click validates target is not intercepted before real click.
      await page.locator(OP.moreOptionsBtn).first().click({ timeout: 2500, trial: true })
      await page.click(OP.moreOptionsBtn, { timeout: 4000 })
      openedMenu = true
      break
    } catch {
      try {
        await page.click(OP.moreOptionsBtn, { timeout: 3000, force: true })
        openedMenu = true
      } catch {
        await page.locator(OP.moreOptionsBtn).first().evaluate((el: Element) => (el as HTMLElement).click()).catch(() => null)
        openedMenu = true
      }
      if (openedMenu) break
      await page.waitForTimeout(120).catch(() => null)
    }
  }
  await waitStable()
  if (openedMenu) {
    const menuVisible = await page.locator(OP.upscaleMenuItem).first().isVisible().catch(() => false)
    openedMenu = menuVisible
  }
  if (!openedMenu) {
    log('warn', 'Khong mo duoc menu More options — bo qua upscale')
    return
  }

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
  const { log, getCapturedMediaUrl, getUpscaledMediaUrl } = ctx

  const mediaUrl = (preferUpscaled && getUpscaledMediaUrl())
    ? getUpscaledMediaUrl()!
    : getCapturedMediaUrl()

  if (!mediaUrl) throw new Error('Không có media URL để download')
  await downloadMediaByUrl(ctx, mediaUrl, outputPath, log)
}

export async function downloadMediaDetached(
  ctx: GrokWorkerContext,
  mediaUrl: string,
  outputPath: string
): Promise<void> {
  const { log } = ctx
  await downloadMediaByUrl(ctx, mediaUrl, outputPath, log)
}

async function downloadMediaByUrl(
  ctx: GrokWorkerContext,
  mediaUrl: string,
  outputPath: string,
  log: (level: 'info' | 'warn' | 'error', message: string) => void
): Promise<void> {
  const { page } = ctx

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  log('info', `Download: ${mediaUrl.split('/').pop()?.split('?')[0]} -> ${path.basename(outputPath)}`)

  const cookies = await page.context().cookies(mediaUrl).catch(() => [])
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const headers: Record<string, string> = { range: 'bytes=0-' }
  if (cookieHeader) headers.cookie = cookieHeader

  const res = await fetch(mediaUrl, {
    method: 'GET',
    headers,
  })
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
  const arr = new Uint8Array(await res.arrayBuffer())
  fs.writeFileSync(outputPath, Buffer.from(arr))

  const stat = fs.statSync(outputPath)
  if (stat.size < 1000) throw new Error(`File qua nho (${stat.size} bytes)`)
  log('info', `Done: ${(stat.size / 1024 / 1024).toFixed(2)} MB`)
}
