/**
 * Google Flow (Veo3) — automation steps for creating video
 * Uses veo3Selectors; call from a Flow page (after login).
 */

import { Page } from 'patchright'
import * as path from 'path'
import * as fs from 'fs'
import { VEO3_SELECTORS as S, VEO3_FLOW_BASE, VEO3_PROJECT_URL_PATTERN, VEO3_EDIT_PAGE_URL_PATTERN } from './veo3Selectors'
import {
  parseGeneratedContentListInPage,
  parsedListToLayoutString,
  parsedListToVerboseLayoutString,
  type ParsedGeneratedList,
} from './veo3GeneratedListParser'

const DOM_STABLE_MS = 800

export type Veo3VideoMode = 'frames' | 'ingredients'
export type Veo3AiModel = 'veo-3.1-fast' | 'veo-3.1-fast-lower-priority' | 'veo-3.1-quality'
export type Veo3FlowOptions = {
  aiModel?: Veo3AiModel
  videoMode?: Veo3VideoMode
  landscape?: boolean
  multiplier?: 1 | 2 | 3 | 4
  imagePaths?: string[]
  maxImagesIngredients?: number
  maxImagesFrames?: number
  /** When true: only upload, wait for all to finish, log everything, skip add-to-prompt and submit */
  debugUploadOnly?: boolean
}

const AI_MODEL_LABEL: Record<Veo3AiModel, string> = {
  'veo-3.1-fast': 'Veo 3.1 - Fast',
  'veo-3.1-fast-lower-priority': 'Veo 3.1 - Fast [Lower Priority]',
  'veo-3.1-quality': 'Veo 3.1 - Quality',
}
const VEO3_TRACE_IMAGE_IMPORT = true
const VEO3_ACTION_LOG = true
let veo3ActionLogPath: string | null = null

function resetVeo3TraceLogs(): void {
  try {
    const dir = path.resolve('./veo3-trace')
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const fp = path.join(dir, name)
        try {
          if (fs.statSync(fp).isFile()) fs.unlinkSync(fp)
        } catch {
          // ignore per-file cleanup failures
        }
      }
    } else {
      fs.mkdirSync(dir, { recursive: true })
    }
  } catch {
    // ignore cleanup errors; logging will still try to proceed
  } finally {
    veo3ActionLogPath = null
  }
}

function stepLog(message: string): void {
  console.log(`[Veo3 flow] ${message}`)
  if (!VEO3_ACTION_LOG) return
  try {
    if (!veo3ActionLogPath) {
      const dir = path.resolve('./veo3-trace')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      veo3ActionLogPath = path.join(dir, `${ts}-actions.log`)
      fs.appendFileSync(veo3ActionLogPath, `# Veo3 action log started at ${new Date().toISOString()}\n`, 'utf-8')
    }
    const lower = message.toLowerCase()
    const level = (lower.includes('error') || lower.includes('failed'))
      ? 'ERROR'
      : (lower.includes('skip') || lower.includes('retry') || lower.includes('timeout'))
        ? 'WARN'
        : 'INFO'
    fs.appendFileSync(
      veo3ActionLogPath,
      `${new Date().toISOString()} [${level}] ${message}\n`,
      'utf-8'
    )
  } catch {
    // keep runtime resilient if file logging fails on customer machine
  }
}

function traceImportLog(message: string): void {
  if (!VEO3_TRACE_IMAGE_IMPORT) return
  stepLog(`[TRACE image-import] ${message}`)
}

function logImageImportHardStopGuidance(context: string): void {
  stepLog(`[HARD STOP] Image import failed at: ${context}`)
  stepLog('[HARD STOP] Please check manually: click "Bắt đầu" (start frame picker) and verify the upload dialog opens.')
  stepLog('[HARD STOP] In upload dialog, confirm the expected image filename appears in the list and is clickable.')
  stepLog('[HARD STOP] If dialog does not open or item is not clickable, capture this action log and report this timestamp.')
}

async function captureImageImportTrace(
  _page: Page,
  tag: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  if (!VEO3_TRACE_IMAGE_IMPORT) return
  stepLog(`[TRACE image-import] ${tag} ${JSON.stringify(detail)}`)
}

async function waitStable(page: Page, ms = DOM_STABLE_MS) {
  await page.waitForTimeout(ms)
}

let focusLock = Promise.resolve<void>(undefined)
const promptInputBusyCounter = new WeakMap<Page, number>()
const imageImportBusyCounter = new WeakMap<Page, number>()

async function withFocusLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = focusLock
  let release!: () => void
  focusLock = new Promise<void>(r => { release = r })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

async function bringProjectPageToFront(page: Page, opts: { bypassLock?: boolean } = {}): Promise<void> {
  try {
    if (!opts.bypassLock) await focusLock
    const p = page as unknown as { bringToFront?: () => Promise<void> }
    if (typeof p.bringToFront === 'function') {
      await p.bringToFront()
      await waitStable(page, 120)
    }
  } catch {
    // Ignore focus errors; caller will still operate on this Page object.
  }
}

/** Shared lock so submission (add-to-prompt, type-and-submit) and download (right-click video → 1080p) never run at the same time on the page. */
export type PageLock = { withLock<T>(fn: () => Promise<T>): Promise<T> }

export function createPageLock(): PageLock {
  let lock = Promise.resolve<void>(undefined)
  return {
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
      const prev = lock
      let release!: () => void
      lock = new Promise<void>(r => { release = r })
      await prev
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

/** Queue of actions: each enqueued action runs after the previous one completes. Actions run one after another, never concurrent. */
export type ActionQueue = {
  /** Enqueue an action; returns a promise that resolves with the action's result when it has run. */
  enqueue<T>(fn: () => Promise<T>): Promise<T>
}

export function createActionQueue(): ActionQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    enqueue<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(() => fn())
      tail = next
      return next as Promise<T>
    },
  }
}

function isPromptInputBusy(page: Page): boolean {
  return (promptInputBusyCounter.get(page) ?? 0) > 0
}

function isImageImportBusy(page: Page): boolean {
  return (imageImportBusyCounter.get(page) ?? 0) > 0
}

async function withPromptInputBusy<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const current = promptInputBusyCounter.get(page) ?? 0
  promptInputBusyCounter.set(page, current + 1)
  try {
    return await fn()
  } finally {
    const next = (promptInputBusyCounter.get(page) ?? 1) - 1
    if (next <= 0) promptInputBusyCounter.delete(page)
    else promptInputBusyCounter.set(page, next)
  }
}

async function withImageImportBusy<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const current = imageImportBusyCounter.get(page) ?? 0
  imageImportBusyCounter.set(page, current + 1)
  try {
    return await fn()
  } finally {
    const next = (imageImportBusyCounter.get(page) ?? 1) - 1
    if (next <= 0) imageImportBusyCounter.delete(page)
    else imageImportBusyCounter.set(page, next)
  }
}


/** 1. Click "Dự án mới" (new project) and wait for navigation to project URL */
export async function flowClickNewProject(page: Page): Promise<void> {
  stepLog('Step 1: Click new project button…')
  const btn = page.locator(S.newProjectBtn).first()
  await btn.waitFor({ state: 'visible', timeout: 15000 })
  await Promise.all([
    page.waitForURL(VEO3_PROJECT_URL_PATTERN, { timeout: 20000 }),
    btn.click(),
  ])
  await waitStable(page, 1500)
  stepLog('Step 1: Done — on project page')
}

/** 2. Open settings (model/mode button) and switch to Video, optionally set aspect and multiplier.
 *  Must run before uploading images so the project generates video, not images. */
export async function flowSetVideoMode(page: Page, opts: Veo3FlowOptions = {}): Promise<void> {
  stepLog('Step 2: Set Video mode (Frames/Ingredients, aspect, multiplier)…')
  const promptBar = page
    .locator('#__next div:has([role="textbox"][data-slate-editor="true"]):has(button:has(i:text-is("arrow_forward")))')
    .first()
  await promptBar.waitFor({ state: 'visible', timeout: 15000 })
  await waitStable(page, 1200)

  // Open settings/mode menu from either initial state (Nano Banana) or video/image state.
  // Never click generic more_vert ("Tùy chọn khác") menu.
  const candidateTriggers = [
    promptBar.locator('button[type="button"][aria-haspopup="menu"]:has-text("Video")').first(),
    promptBar.locator('button[type="button"][aria-haspopup="menu"]:has-text("Image")').first(),
    promptBar.locator('button[type="button"][aria-haspopup="menu"]:has-text("Nano Banana")').first(),
    page.locator('#__next button[type="button"][aria-haspopup="menu"]:has-text("Video")').first(),
    page.locator('#__next button[type="button"][aria-haspopup="menu"]:has-text("Image")').first(),
    page.locator('#__next button[type="button"][aria-haspopup="menu"]:has-text("Nano Banana")').first(),
  ]
  let openedMenu = false
  for (const trigger of candidateTriggers) {
    if ((await trigger.count()) === 0) continue
    const visible = await trigger.isVisible().catch(() => false)
    if (!visible) continue
    try {
      await trigger.click({ timeout: 6000 })
      await waitStable(page, 500)
      const videoTabProbe = page.locator('button[role="tab"]:has-text("Video")').first()
      await videoTabProbe.waitFor({ state: 'visible', timeout: 3000 })
      openedMenu = true
      break
    } catch {
      try {
        const el = await trigger.elementHandle()
        if (el) {
          await el.evaluate((node: HTMLElement) => node.click())
          await waitStable(page, 500)
          const videoTabProbe = page.locator('button[role="tab"]:has-text("Video")').first()
          await videoTabProbe.waitFor({ state: 'visible', timeout: 3000 })
          openedMenu = true
          break
        }
      } catch {
        // ignore and try next candidate
      } finally {
        await page.keyboard.press('Escape').catch(() => {})
        await waitStable(page, 250)
      }
    }
  }
  if (!openedMenu) {
    throw new Error('Could not open settings/mode menu from current prompt bar (Video/Image/Nano Banana).')
  }

  // Wait for the mode menu to show (Video tab visible) then click Video
  const videoTab = page.locator('button[role="tab"]:has-text("Video")').first()
  await videoTab.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null)
  const hasVideoTab = (await videoTab.count()) > 0
  if (!hasVideoTab) {
    await page.keyboard.press('Escape')
    await waitStable(page, 300)
    throw new Error('Settings menu opened but Video tab not found. UI may have changed. Cannot set Video mode — would generate images instead of videos.')
  }

  await videoTab.click()
  await waitStable(page, 600)

  if (opts.aiModel) {
    const modelLabel = AI_MODEL_LABEL[opts.aiModel]
    stepLog(`Step 2: Set AI model -> ${modelLabel}`)
    const modelTriggerCandidates = [
      page.locator('[data-radix-menu-content][role="menu"] > button[type="button"][aria-haspopup="menu"]').first(),
      page.locator('[data-radix-menu-content][role="menu"] button[type="button"][aria-haspopup="menu"]:has-text("Veo")').first(),
      page.locator('[data-radix-menu-content][role="menu"] button[type="button"][aria-haspopup="menu"]').filter({ hasText: '3.1' }).first(),
      page.locator('button[type="button"][aria-haspopup="menu"]:has-text("Veo 3.1")').first(),
    ]
    let openedModelMenu = false
    for (const trigger of modelTriggerCandidates) {
      if ((await trigger.count()) === 0) continue
      const visible = await trigger.isVisible().catch(() => false)
      if (!visible) continue
      try {
        await trigger.click({ timeout: 7000 })
        await waitStable(page, 350)
        const modelOptionProbe = page.locator(`div[role="menuitem"]:has(span:text-is("${modelLabel}")) button`).first()
        await modelOptionProbe.waitFor({ state: 'visible', timeout: 5000 })
        openedModelMenu = true
        break
      } catch {
        try {
          const el = await trigger.elementHandle()
          if (el) {
            await el.evaluate((node: HTMLElement) => node.click())
            await waitStable(page, 350)
            const modelOptionProbe = page.locator(`div[role="menuitem"]:has(span:text-is("${modelLabel}")) button`).first()
            await modelOptionProbe.waitFor({ state: 'visible', timeout: 5000 })
            openedModelMenu = true
            break
          }
        } catch {
          // continue trying next candidate
        }
      }
    }
    if (!openedModelMenu) {
      throw new Error(`Could not open model selector menu in settings. Target model: ${modelLabel}`)
    }

    const modelOption = page.locator(`div[role="menuitem"]:has(span:text-is("${modelLabel}")) button`).first()
    try {
      await modelOption.click({ timeout: 7000 })
    } catch {
      const el = await modelOption.elementHandle()
      if (!el) throw new Error(`Model option not interactable: ${modelLabel}`)
      await el.evaluate((node: HTMLElement) => node.click())
    }
    await waitStable(page, 500)
    stepLog(`Step 2: AI model selected -> ${modelLabel}`)
  }

  // Frame mode (Khung hình) vs Ingredients mode (Thành phần)
  if (opts.videoMode) {
    const frameModeLabel = opts.videoMode === 'ingredients' ? 'Thành phần' : 'Khung hình'
    const tab = page.locator(`button[role="tab"]:has-text("${frameModeLabel}")`).first()
    if ((await tab.count()) > 0) {
      const isSelected = await tab.getAttribute('data-state').then(a => a === 'active').catch(() => false)
      if (!isSelected) {
        await tab.click()
        await waitStable(page, 400)
      }
    }
  }

  // Aspect ratio: 16:9 (landscape) / 9:16 (portrait). Fallback: Ngang/Dọc (older locale)
  if (opts.landscape !== undefined) {
    const ratioSelectors = opts.landscape
      ? ['button[role="tab"]:has-text("16:9")', 'button[role="tab"]:has-text("Ngang")']
      : ['button[role="tab"]:has-text("9:16")', 'button[role="tab"]:has-text("Dọc")']
    for (const sel of ratioSelectors) {
      const tab = page.locator(sel).first()
      if ((await tab.count()) > 0) {
        const isSelected = await tab.getAttribute('data-state').then(a => a === 'active').catch(() => false)
        if (!isSelected) {
          await tab.click()
          await waitStable(page, 400)
        }
        break
      }
    }
  }

  if (opts.multiplier) {
    const tab = page.locator(`button[role="tab"]:has-text("x${opts.multiplier}")`).first()
    if ((await tab.count()) > 0) {
      const isSelected = await tab.getAttribute('data-state').then(a => a === 'active').catch(() => false)
      if (!isSelected) {
        await tab.click()
        await waitStable(page, 400)
      }
    }
  }

  await page.keyboard.press('Escape')
  await waitStable(page)
  stepLog('Step 2: Done')
}

/** 3. Open content dialog, set files on file input, capture upload request/response details, wait for all tiles, then close dialog. Returns ordered media names and full upload log. */
export interface UploadLogEntry {
  request: { url: string; method: string; postData: string; fileName: string | null; slot: number; when: number }
  response?: { status: number; body: unknown; when: number }
}

export async function flowUploadImages(page: Page, imagePaths: string[], mode: Veo3VideoMode = 'frames', opts: { leaveDialogOpen?: boolean } = {}): Promise<{ orderedNames: string[]; uploadLog: UploadLogEntry[] }> {
  await bringProjectPageToFront(page)
  const valid = imagePaths.filter(p => p && fs.existsSync(p))
  if (valid.length === 0) throw new Error('No valid image paths')

    const uploadUrlPattern = /uploadImage|v1\/flow\/upload|trpc.*media|media\.(create|upload)|getMediaUrlRedirect/i
    const uploadPostPattern = /uploadImage|v1\/flow\/upload|trpc.*(media|upload|create)|media\.(create|upload)/i
    const slotCount = Math.max(valid.length, 2)
    const resultBySlot: (string | null)[] = Array(slotCount).fill(null)
    const uploadLog: UploadLogEntry[] = []
    const requestToEntryIndex = new Map<object, number>()

    function displayNameToSlotIndex(displayName: string | null | undefined): number {
      if (!displayName) return 0
      const base = displayName.toLowerCase()
      const m = base.match(/^(\d+)([ab])?\.(png|jpg|jpeg|webp)$/)
      if (!m) return 0
      const num = parseInt(m[1], 10)
      const letter = m[2]
      if (letter === 'b') return (num - 1) * 2 + 1
      if (letter === 'a') return (num - 1) * 2
      return num - 1
    }

    function fileNameToSlotIndex(fileName: string | null): number {
      if (!fileName) return 0
      const base = path.basename(fileName).toLowerCase()
      const m = base.match(/^(\d+)([ab])?\.(png|jpg|jpeg|webp)$/)
      if (!m) return 0
      const num = parseInt(m[1], 10)
      const letter = m[2]
      if (letter === 'b') return (num - 1) * 2 + 1
      if (letter === 'a') return (num - 1) * 2
      return num - 1
    }

    const onRequest = (req: { url: () => string; method: () => string; postData: () => string | undefined }) => {
    const url = req.url()
    const method = req.method()
    if (!uploadUrlPattern.test(url)) return
    // Only log and track POST upload requests; ignore GET (e.g. getMediaUrlRedirect)
    if (method !== 'POST' || !uploadPostPattern.test(url)) return
    const postData = req.postData() ?? ''
    let fileName: string | null = null
    const jsonMatch = postData.match(/"fileName"\s*:\s*"([^"]+)"/)
    if (jsonMatch) fileName = jsonMatch[1]
    else {
      const multipartMatch = postData.match(/name="fileName"[^]*?[\r\n]+([^\r\n]+)/)
      if (multipartMatch) fileName = multipartMatch[1].trim()
    }
    const slot = Math.min(fileNameToSlotIndex(fileName), slotCount - 1)
    const idx = uploadLog.length
    uploadLog.push({
      request: { url: req.url(), method: req.method(), postData, fileName, slot, when: Date.now() },
    })
    requestToEntryIndex.set(req as object, idx)
  }
    const onResponse = async (res: { url: () => string; status: () => number; request: () => object; json: () => Promise<unknown> }) => {
    if (!uploadPostPattern.test(res.url())) return
    const idx = requestToEntryIndex.get(res.request())
    if (idx == null) return
    try {
      const body = await res.json()
      if (uploadLog[idx]) uploadLog[idx].response = { status: res.status(), body, when: Date.now() }
      const name =
        (body as any)?.media?.name ??
        (body as any)?.result?.data?.json?.name ??
        (body as any)?.result?.data?.name ??
        (body as any)?.result?.data?.media?.name ??
        (body as any)?.data?.name ??
        (body as any)?.data?.media?.name ??
        (body as any)?.name
      const displayName = (body as any)?.workflow?.metadata?.displayName ?? (body as any)?.metadata?.displayName
      if (typeof name === 'string') {
        // Prefer slot from response displayName so order is correct even if responses arrive out of order
        const slotFromResponse = displayName != null ? displayNameToSlotIndex(displayName) : undefined
        const slot = slotFromResponse !== undefined ? Math.min(slotFromResponse, slotCount - 1) : uploadLog[idx].request.slot
        resultBySlot[slot] = name
      }
    } catch {
      if (uploadLog[idx]) uploadLog[idx].response = { status: res.status(), body: null, when: Date.now() }
    }
  }
    page.on('request', onRequest)
    page.on('response', onResponse)

  stepLog(`Step 3: Open content dialog and upload ${valid.length} image(s)…`)
  const openBtn = page.locator(S.openContentDialogBtn).first()
  await openBtn.waitFor({ state: 'visible', timeout: 10000 })
  await openBtn.click()
  await waitStable(page, 1200)

  const fileInput = page.locator(S.contentDialogFileInput).first()
  const uploadBtn = page.locator('button:has(span:text-is("Tải hình ảnh lên"))').first()
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(valid.slice(0, 10))
  } else {
    await uploadBtn.click()
    await waitStable(page, 500)
    const input = page.locator('input[type="file"]').first()
    await input.waitFor({ state: 'attached', timeout: 5000 })
    await input.setInputFiles(valid.slice(0, 10))
  }

    stepLog('Step 3: Waiting for uploads to finish (tiles with img)…')
  const expectedCount = valid.length
  const imagesPerJob = mode === 'ingredients' ? 3 : 2
  const neededForFirstJob = Math.min(expectedCount, imagesPerJob)
  const neededForAllJobs = expectedCount
  const uploadTimeout = 60000
  const deadline = Date.now() + uploadTimeout
  while (Date.now() < deadline) {
    const tiles = page.locator(S.uploadedTile).filter({ has: page.locator('img') })
    const count = await tiles.count()
    if (count >= expectedCount) break
    await page.waitForTimeout(800)
  }

  const collectDomMediaNames = async (maxCount: number): Promise<string[]> => {
    const out: string[] = []
    let tilesToUse = page.locator(S.uploadedTile).filter({ has: page.locator('img[src*="name="]') })
    if (opts.leaveDialogOpen) {
      const dialogTiles = page.locator('[role="dialog"]').locator(S.uploadedTile).filter({ has: page.locator('img[src*="name="]') })
      const dialogCount = await dialogTiles.count()
      if (dialogCount > 0) tilesToUse = dialogTiles
    }
    const tileCount = await tilesToUse.count()
    const n = Math.min(tileCount, maxCount)
    for (let i = 0; i < n; i++) {
      const src = await tilesToUse.nth(i).locator('img[src*="name="]').first().getAttribute('src').catch(() => null)
      const nameMatch = src?.match(/name=([^&]+)/)
      if (nameMatch?.[1]) out.push(nameMatch[1])
    }
    return out
  }

  stepLog('Step 3: Waiting for upload media names (response-first, DOM fallback) before adding to prompt…')
  const slotWaitStart = Date.now()
  const slotWaitDeadline = slotWaitStart + 25000
  while (Date.now() < slotWaitDeadline) {
    const haveAll = Array.from({ length: neededForAllJobs }, (_, i) => resultBySlot[i]).every(Boolean)
    if (haveAll) break

    // If API response mapping is late/missing, proceed as soon as DOM has enough
    // names for the first prompt. This removes long idle gaps after thumbnails appear.
    if (Date.now() - slotWaitStart >= 3000) {
      const domNames = await collectDomMediaNames(neededForAllJobs)
      if (domNames.length >= neededForFirstJob) {
        for (let i = 0; i < domNames.length && i < neededForAllJobs; i++) {
          if (!resultBySlot[i]) resultBySlot[i] = domNames[i]
        }
        stepLog(`Step 3: Proceeding with DOM media names (${domNames.length}/${neededForAllJobs})`)
        break
      }
    }
    await page.waitForTimeout(500)
  }

  await page.waitForTimeout(1500)
  page.off('request', onRequest)
  page.off('response', onResponse)

  const orderedNames: string[] = []
  for (let i = 0; i < neededForAllJobs; i++) {
    if (resultBySlot[i]) orderedNames.push(resultBySlot[i] as string)
  }
  if (orderedNames.length < neededForFirstJob && uploadLog.length > 0) {
    for (const entry of uploadLog) {
      if (entry.response?.body != null && typeof entry.response.body === 'object') {
        const b = entry.response.body as Record<string, unknown>
        const name =
          (b?.media as any)?.name ??
          (b?.result as any)?.data?.json?.name ??
          (b?.result as any)?.data?.name ??
          (b?.result as any)?.data?.media?.name ??
          (b?.data as any)?.name ??
          (b?.data as any)?.media?.name ??
          b?.name
        if (typeof name === 'string') {
          const slot = Math.min(entry.request.slot, slotCount - 1)
          if (!resultBySlot[slot]) resultBySlot[slot] = name
        }
      }
    }
    orderedNames.length = 0
    for (let i = 0; i < neededForAllJobs; i++) {
      if (resultBySlot[i]) orderedNames.push(resultBySlot[i] as string)
    }
  }
  if (orderedNames.length < neededForFirstJob) {
    const domNames = await collectDomMediaNames(neededForFirstJob)
    if (domNames.length >= neededForFirstJob) {
      orderedNames.length = 0
      orderedNames.push(...domNames.slice(0, neededForFirstJob))
    }
    if (orderedNames.length === 0 && opts.leaveDialogOpen) {
      const dialogImgs = page.locator('[role="dialog"]').locator('img[src*="getMediaUrlRedirect"][src*="name="]')
      const n = await dialogImgs.count()
      if (n >= neededForFirstJob) {
        orderedNames.length = 0
        for (let i = 0; i < neededForFirstJob; i++) {
          const src = await dialogImgs.nth(i).getAttribute('src').catch(() => null)
          const nameMatch = src?.match(/name=([^&]+)/)
          if (nameMatch?.[1]) orderedNames.push(nameMatch[1])
        }
      }
    }
    if (orderedNames.length > 0) stepLog(`Step 3: Got ${orderedNames.length} media name(s) from DOM img src`)
  }
  if (orderedNames.length < neededForFirstJob) {
    stepLog(`Step 3: Only ${orderedNames.length}/${neededForFirstJob} media names received; add-to-prompt may be wrong`)
  }
  // Explicit readiness gate for slot-picker flow:
  // after upload, the original local filename(s) must be visible in content dialog list.
  if (opts.leaveDialogOpen) {
    const expectedLabels = valid
      .slice(0, neededForFirstJob)
      .map(p => path.basename(p))
      .filter(Boolean)
    if (expectedLabels.length > 0) {
      const dialog = page.locator('[role="dialog"]').first()
      await dialog.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null)
      const rows = dialog.locator('[data-testid="virtuoso-item-list"] [data-index]')
      for (const label of expectedLabels) {
        let found = false
        const labelDeadline = Date.now() + 12000
        while (Date.now() < labelDeadline) {
          const rowByLabel = rows.filter({ hasText: label }).first()
          if ((await rowByLabel.count().catch(() => 0)) > 0) {
            found = true
            break
          }
          const scroller = dialog.locator('[data-virtuoso-scroller="true"]').first()
          await scroller.hover().catch(() => {})
          await page.mouse.wheel(0, 900).catch(() => {})
          await page.waitForTimeout(300)
        }
        if (!found) {
          stepLog(`[WARN] Step 3 verify: uploaded image label "${label}" not visible in dialog on this machine; continue to Step 4 retry-check`)
          await captureImageImportTrace(page, 'upload-verify-label-miss', { label })
          // Do not hard-stop here: Step 4 has stronger slot-level retry+verify and remains hard-stop authority.
          continue
        }
      }
      stepLog(`Step 3: Verified uploaded image label(s) in dialog: ${expectedLabels.join(', ')}`)
    }
  }

  await waitStable(page, 500)
  const leaveDialogOpen = opts.leaveDialogOpen === true
  if (!leaveDialogOpen) {
    await page.keyboard.press('Escape')
    await waitStable(page)
  }
  stepLog(`Step 3: Done — images uploaded. Upload log: ${uploadLog.length} request(s)`)
  return { orderedNames, uploadLog }
}

/** 4a. Right-click an uploaded tile (by DOM index) and click "Thêm vào câu lệnh" */
export async function flowAddImageToPrompt(page: Page, tileIndex: number): Promise<void> {
  stepLog(`Step 4: Add image ${tileIndex + 1} to prompt (by index, right-click → Thêm vào câu lệnh)…`)
  await page.keyboard.press('Escape')
  await waitStable(page, 400)
  const tiles = page.locator(S.uploadedTile).filter({ has: page.locator('img') })
  const tile = tiles.nth(tileIndex)
  await tile.waitFor({ state: 'visible', timeout: 8000 })
  await tile.scrollIntoViewIfNeeded()
  await waitStable(page, 300)
  const img = tile.locator('img[src*="getMediaUrlRedirect"]').first()
  await img.evaluate((el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: x,
        clientY: y,
      })
    )
  })
  await waitStable(page, 400)
  const addBtn = page.locator(S.contextMenuAddToPrompt).first()
  await addBtn.waitFor({ state: 'visible', timeout: 8000 })
  await addBtn.click()
  await waitStable(page, 600)
}

/** 4b. Add image to prompt by clicking frame slot button (Bắt đầu/Kết thúc), opening content menu, then selecting media by name. Falls back to right-click add when needed. */
export async function flowAddImageToPromptByMediaName(page: Page, mediaName: string, slotIndex: number): Promise<void> {
  await withImageImportBusy(page, async () => {
  const fallbackRightClickAdd = async (): Promise<void> => {
    const tile = page.locator(S.uploadedTile).filter({ has: page.locator(`img[src*="name=${mediaName}"]`) }).first()
    await tile.waitFor({ state: 'visible', timeout: 12000 })
    await tile.scrollIntoViewIfNeeded()
    await waitStable(page, 500)
    try {
      const img = tile.locator('img[src*="getMediaUrlRedirect"]').first()
      await img.evaluate((el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: x,
            clientY: y,
          })
        )
      })
    } catch {
      await page.keyboard.press('Escape')
      await waitStable(page, 300)
      await tile.scrollIntoViewIfNeeded()
      await waitStable(page, 400)
      const img = tile.locator('img[src*="getMediaUrlRedirect"]').first()
      await img.evaluate((el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: x,
            clientY: y,
          })
        )
      })
    }
    await waitStable(page, 400)
    let addBtn = page.locator(S.contextMenuAddToPrompt).first()
    let addVisible = await addBtn.isVisible().catch(() => false)
    if (!addVisible) {
      await page.keyboard.press('Escape')
      await waitStable(page, 600)
      const img = tile.locator('img[src*="getMediaUrlRedirect"]').first()
      await img.evaluate((el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: x,
            clientY: y,
          })
        )
      })
      await waitStable(page, 500)
      addBtn = page.locator(S.contextMenuAddToPrompt).first()
    }
    await addBtn.waitFor({ state: 'visible', timeout: 10000 })
    await addBtn.click()
    await waitStable(page, 600)
  }

  stepLog(`Step 4: Add image ${slotIndex + 1} to prompt (image key=${mediaName.slice(0, 24)}…, frame-slot picker)…`)
  await page.keyboard.press('Escape')
  await waitStable(page, 350)

  // Frames mode: select slot by clicking "Bắt đầu"/"Kết thúc", then choose media in dialog list.
  // If slot button is unavailable (e.g. ingredients mode), use legacy fallback.
  const slotBtn = slotIndex === 0
    ? page.locator(S.framesStartSlot).first()
    : slotIndex === 1
      ? page.locator(S.framesEndSlot).first()
      : null

  if (slotBtn == null) {
    throw new Error(`JS-only import requires frame slot button for slot=${slotIndex}`)
  }
  try {
    let lastErr: string | null = null
    for (let openAttempt = 1; openAttempt <= 1; openAttempt++) {
      await bringProjectPageToFront(page)
      await slotBtn.waitFor({ state: 'visible', timeout: 10000 })
      traceImportLog(`slot=${slotIndex} media=${mediaName} button visible (openAttempt=${openAttempt})`)
      try {
        await slotBtn.click({ timeout: 6000 })
      } catch {
        const h = await slotBtn.elementHandle()
        if (!h) throw new Error('slot button not interactable')
        await h.evaluate((node: HTMLElement) => node.click())
      }
      await waitStable(page, 400)
      const dialog = page.locator('[role="dialog"]').first()
      await dialog.waitFor({ state: 'visible', timeout: 8000 })
      traceImportLog(`slot=${slotIndex} dialog opened (openAttempt=${openAttempt})`)

      // JS-only pick path: exact/contains filename text and force dispatch click events.
      const jsPicked = await page.evaluate(({ wanted }) => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        const dialogEl = dialogs.find(d => (d as HTMLElement).offsetParent !== null) as HTMLElement | undefined
        if (!dialogEl) return { ok: false, reason: 'dialog-not-visible' }

        const rows = Array.from(dialogEl.querySelectorAll('[data-testid="virtuoso-item-list"] [data-index]')) as HTMLElement[]
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
        const wantedNorm = norm(wanted)

        const row = rows.find(r => {
          const text = norm(r.textContent || '')
          return text === wantedNorm || text.includes(wantedNorm)
        })
        if (!row) return { ok: false, reason: 'row-not-found-by-filename' }

        row.scrollIntoView({ block: 'center' })
        const clickTarget = (row.querySelector(`img[alt="${wanted}"], img[title="${wanted}"]`) as HTMLElement | null)
          || (row.querySelector('img') as HTMLElement | null)
          || row
        ;['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
          clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
        })
        return { ok: true }
      }, { wanted: mediaName })
      if (jsPicked?.ok) {
        traceImportLog(`slot=${slotIndex} JS-picked media by filename=${mediaName}`)
        await waitStable(page, 450)
        await page.keyboard.press('Escape').catch(() => {})
        await waitStable(page, 200)
        await captureImageImportTrace(page, 'media-selected', { slotIndex, mediaName, via: 'js-filename-match' })
        return
      }
      lastErr = jsPicked?.reason ?? 'js-pick-miss'
      await page.keyboard.press('Escape').catch(() => {})
      await waitStable(page, 250)
    }
    await captureImageImportTrace(page, 'row-click-failed', { slotIndex, mediaName, lastErr })
    throw new Error(`failed JS-only pick for ${mediaName}: ${lastErr ?? 'unknown'}`)
  } catch (e) {
    await captureImageImportTrace(page, 'slot-picker-failed', { slotIndex, mediaName, error: (e as Error).message })
    await page.keyboard.press('Escape').catch(() => {})
    await waitStable(page, 250)
    throw e
  }
  })
}

/** Add up to maxImages images to prompt in order. If orderedMediaNames is provided (from upload responses), use them to find the correct tile by img src; otherwise use tile index. */
export async function flowAddImagesToPrompt(
  page: Page,
  mode: Veo3VideoMode,
  imagePaths: string[],
  alreadyUploadedCount: number,
  orderedMediaNames?: string[]
): Promise<void> {
  const max = mode === 'ingredients' ? 3 : 2
  const toAdd = Math.min(max, imagePaths.length, alreadyUploadedCount)
  const useNames = orderedMediaNames && orderedMediaNames.length >= toAdd
  for (let i = 0; i < toAdd; i++) {
    try {
      if (useNames && orderedMediaNames![i]) {
        await flowAddImageToPromptByMediaName(page, orderedMediaNames![i], i)
      } else {
        await flowAddImageToPrompt(page, i)
      }
    } catch (e) {
      stepLog(`Step 4: failed to add image ${i + 1} to prompt: ${(e as Error).message}. Continuing with next image.`)
    }
  }
}

/** Add images for one job by slice of ordered media names (e.g. jobIndex 0 → [0,1], jobIndex 1 → [2,3]). Use when all images were uploaded once and we run multiple prompts in the same project. */
export async function flowAddImagesToPromptForJob(
  page: Page,
  mode: Veo3VideoMode,
  orderedMediaNames: string[],
  jobIndex: number
): Promise<void> {
  const perJob = mode === 'ingredients' ? 3 : 2
  const start = jobIndex * perJob
  const slice = orderedMediaNames.slice(start, start + perJob)
  if (slice.length === 0) return
  for (let i = 0; i < slice.length; i++) {
    await flowAddImageToPromptByMediaName(page, slice[i], i)
  }
}

/** Add one image (by script index) to both frames — for script mode: 1 image per script, same image for start and end frame. */
export async function flowAddImagesToPromptForScriptJob(
  page: Page,
  orderedMediaNames: string[],
  scriptIndex: number
): Promise<void> {
  const name = orderedMediaNames[scriptIndex]
  if (!name) return
  try {
    await flowAddImageToPromptByMediaName(page, name, 0)
    await flowAddImageToPromptByMediaName(page, name, 1)
  } catch (e) {
    stepLog(`Step 4: failed to add script image ${scriptIndex + 1} to both frames: ${(e as Error).message}. Continuing.`)
  }
}

/** Add image(s) to prompt from ordered names.
 * Current production behavior: use only slot 0 (Bắt đầu) for stability across machines.
 */
export async function flowAddImagesToPromptFromOrderedNames(
  page: Page,
  orderedNames: string[],
  twoSlots: boolean = true
): Promise<void> {
  if (orderedNames.length === 0) return
  try {
    await flowAddImageToPromptByMediaName(page, orderedNames[0], 0)
    if (twoSlots) {
      const nameForSlot1 = orderedNames.length >= 2 ? orderedNames[1] : orderedNames[0]
      await flowAddImageToPromptByMediaName(page, nameForSlot1, 1)
    }
  } catch (e) {
    logImageImportHardStopGuidance('step4-add-images-from-ordered-names')
    throw new Error(`Step 4 hard stop: failed to add images from ordered names: ${(e as Error).message}`)
  }
}

/** 5. Paste prompt into the textbox and submit (clipboard + Ctrl+V for speed; fallback insertText). */
export async function flowTypePromptAndSubmit(page: Page, prompt: string): Promise<void> {
  await withPromptInputBusy(page, async () => {
    await bringProjectPageToFront(page)
    stepLog('Step 5: Paste prompt and submit…')
    const input = page.locator(S.promptInput).first()
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.click()
    await waitStable(page, 300)
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    if (prompt.length > 0) {
      let pasted = false
      try {
        await page.evaluate((text: string) => navigator.clipboard.writeText(text), prompt)
        await page.keyboard.press('Control+V')
        pasted = true
      } catch {
        // clipboard not available (e.g. not focused or secure context)
      }
      if (!pasted) {
        const { clipboard } = require('electron')
        try {
          clipboard.writeText(prompt)
          await page.keyboard.press('Control+V')
          pasted = true
        } catch {
          // not in Electron or clipboard failed
        }
      }
      if (!pasted) {
        await page.keyboard.insertText(prompt)
      }
    }
    await waitStable(page, 300)
    const submit = page.locator(S.submitBtn).first()
    await submit.waitFor({ state: 'visible', timeout: 5000 })
    await submit.click()
    await waitStable(page)
    stepLog('Step 5: Done — submitted')
  })
}

// ─── Generated videos: completion detection and 1080p download ─────────────────
//
// Layout (e.g. 1 script, 5 prompts, x2): each prompt generates 2 videos, newest on the LEFT of the uploaded image.
// After prompt 1:  [2.mp4 generating] [1.mp4 generating] [1.png]
// After prompt 2:  [4.mp4] [3.mp4] [2.mp4] [1.mp4] [1.png]
// DOM order (left to right): tile 0 = N.mp4, tile (N-1) = 1.mp4. File (i+1).mp4 <- tile index (count - 1 - i).
//
// 1) Generating status: count tiles with completed video. 2) 1080p: right-click -> Tai xuong -> 1080p. 3) 1.mp4 = tile (count-1).
//
const GENERATED_VIDEO_POLL_MS = 4000
// No hard deadline: keep tracking/downloading until done conditions are met.
const GENERATED_VIDEO_DEADLINE_MS = Number.POSITIVE_INFINITY
const RETRY_RATE_LIMIT_BASE_COOLDOWN_MS = 60 * 1000
const RETRY_RATE_LIMIT_JITTER_MS = 15 * 1000
/** Delay between starting each download (click 1080p); do not wait for the previous download to finish. */
const DOWNLOAD_START_INTERVAL_MS = 4000

/** Count how many tiles currently show a completed video. Leftmost tile = newest (N.mp4), rightmost = 1.mp4. */
export async function getCompletedGeneratedVideoCount(page: Page): Promise<number> {
  const tiles = page.locator(S.generatedCompletedVideoTile)
  return await tiles.count()
}

/** If any failed tile exists, click its retry button (failed tile disappears, new generating tile appears to the left). Returns true if a retry was clicked. */
export async function clickRetryOnFirstFailedTile(page: Page): Promise<boolean> {
  const failed = page.locator(S.generatedFailedVideoTile)
  const n = await failed.count()
  if (n === 0) return false
  const firstFailed = failed.first()
  const retryBtn = firstFailed.locator(S.generatedFailedRetryBtn).first()
  try {
    await retryBtn.click({ timeout: 15000 })
    stepLog('Clicked retry on failed video tile')
    return true
  } catch (e) {
    stepLog(`Retry click failed: ${(e as Error).message}`)
    return false
  }
}

/** Click retry on the failed tile with the given tileId (from parser). Use when parser reports data.failed so we retry the exact tile. Returns false if tile not found or click times out. */
export async function clickRetryOnFailedTileByTileId(page: Page, tileId: string): Promise<boolean> {
  const tile = page.locator(`[data-tile-id="${tileId}"]:has(div.sc-9a984650-1.dEfdsQ)`).first()
  const visible = await tile.isVisible().catch(() => false)
  if (!visible) return false
  const retryBtn = tile.locator(S.generatedFailedRetryBtn).first()
  try {
    await retryBtn.click({ timeout: 15000 })
    stepLog(`Clicked retry on failed tile ${tileId}`)
    return true
  } catch (e) {
    stepLog(`Retry click failed for tile ${tileId}: ${(e as Error).message}`)
    return false
  }
}

/** Wait until at least expectedCount completed video tiles exist. On failed tiles, clicks retry and keeps waiting. */
export async function waitForGeneratedVideosCount(
  page: Page,
  expectedCount: number,
  opts: { timeoutMs?: number; onProgress?: (completedCount: number) => void } = {}
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? GENERATED_VIDEO_DEADLINE_MS
  const deadline = Date.now() + timeoutMs
  let lastCount = 0
  while (Date.now() < deadline) {
    const count = await getCompletedGeneratedVideoCount(page)
    if (count !== lastCount && opts.onProgress) opts.onProgress(count)
    lastCount = count
    if (count >= expectedCount) return count
    const didRetry = await clickRetryOnFirstFailedTile(page)
    if (didRetry) await page.waitForTimeout(2000)
    else await page.waitForTimeout(GENERATED_VIDEO_POLL_MS)
  }
  return lastCount
}

/** Right-click tile at tileIndex (0 = leftmost = N.mp4), open Tải xuống, click 1080p in submenu, then save to outputPath. Uses temp path + copy so we get the actual bytes; validates file is not HTML (redirect page). */
export async function flowDownloadGeneratedVideo1080pAtTile(
  page: Page,
  tileIndex: number,
  outputPath: string
): Promise<void> {
  stepLog(`Download tile ${tileIndex + 1} as 1080p to ${outputPath}`)
  const tile = page.locator(S.generatedCompletedVideoTile).nth(tileIndex)
  await tile.waitFor({ state: 'visible', timeout: 10000 })
  await tile.scrollIntoViewIfNeeded()
  await waitStable(page, 150)
  await page.keyboard.press('Escape')
  await waitStable(page, 150)
  // Right-click the video element so the download menu opens (not the list menu "Tạo bộ sưu tập" / "Dán").
  const videoEl = tile.locator('video[src*="getMediaUrlRedirect"]').first()
  await videoEl.evaluate((el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: x, clientY: y })
    )
  })
  await waitStable(page, 200)
  const downloadItem = page.locator(S.contextMenuDownload).first()
  await downloadItem.waitFor({ state: 'visible', timeout: 5000 })
  await downloadItem.hover()
  await waitStable(page, 200)
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 })
  await page.locator(S.contextMenuDownload1080p).first().click()
  const download = await downloadPromise
  const tmpPath = await download.path()
  if (tmpPath && fs.existsSync(tmpPath)) {
    const buf = fs.readFileSync(tmpPath)
    await download.delete().catch(() => {})
    if (buf.length < 1000 || buf[0] === 0x3c) throw new Error(`Downloaded file too small or not video (${buf.length} bytes, first byte 0x${buf[0]?.toString(16) ?? '?'})`)
    fs.writeFileSync(outputPath, buf)
    stepLog(`Saved ${outputPath} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)
  } else {
    await download.saveAs(outputPath)
    stepLog(`Saved ${outputPath}`)
  }
  await waitStable(page, 150)
}

/** Download a single completed video by tileId. Right-click → open Download submenu → wait for 1080p → hover + click 1080p. Single attempt, 120s timeout. Always closes the context menu after. */
const DOWNLOAD_EVENT_TIMEOUT_MS = 120000
/** Delay between triggering each 1080p (after waiting for download event). */
const DOWNLOAD_BATCH_CLICK_GAP_MS = 100
/** Ordered mode strategy: warm-up pass (discard) then final save pass. */
const ORDERED_TWO_PASS_DOWNLOAD = true
/** Edit-page Download button can stay non-interactable while backend/upscale state settles. */
const EDIT_PAGE_DOWNLOAD_CLICK_TIMEOUT_MS = 120000

/** Opens context menu, opens Download submenu (hover), waits for resolution submenu, then clicks 1080p.
 * Works for both left and right submenus. If 1080p does not appear within ~2s after the first hover, we
 * hover "Tải xuống" again (matching the manual fix you observed) and wait once more before failing. */
async function openMenuHoverDownloadAndClick1080p(
  page: Page,
  tile: ReturnType<Page['locator']>
): Promise<void> {
  await tile.scrollIntoViewIfNeeded()
  await waitStable(page, 150)
  // Dismiss any toast/notification overlay so it doesn't intercept the right-click (e.g. "Upscaling your video").
  await page.keyboard.press('Escape')
  await waitStable(page, 150)
  // If tile is near the right edge, the resolution submenu can open off-screen or the portalled menu
  // may be tied to the wrong tile. Scroll so the tile is in the left 60% of the viewport to give the
  // submenu room and reduce risk of clicking a stale menu.
  const tileBox = await tile.boundingBox().catch(() => null)
  if (tileBox) {
    const viewport = page.viewportSize()
    if (viewport) {
      const rightEdge = tileBox.x + tileBox.width
      const targetMaxRight = viewport.width * 0.6
      if (rightEdge > targetMaxRight) {
        const scrollBy = rightEdge - targetMaxRight
        await page.evaluate((delta: number) => window.scrollBy(delta, 0), scrollBy)
        await waitStable(page, 150)
      }
    }
  }
  // Right-click on the VIDEO element inside the tile so the download context menu opens (not the list/page menu "Tạo bộ sưu tập" / "Dán").
  const videoEl = tile.locator('video[src*="getMediaUrlRedirect"]').first()
  await videoEl.evaluate((el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: x,
        clientY: y,
      })
    )
  })
  await waitStable(page, 200)
  const downloadItem = page.locator(S.contextMenuDownload).first()
  await downloadItem.waitFor({ state: 'visible', timeout: 10000 })
  await downloadItem.hover()
  await waitStable(page, 200)

  // Resolution submenu that actually contains 1080p. Use .last() so we interact with the
  // most recently opened menu (portalled menus can render at top-right; stale menus may
  // remain in DOM), ensuring we click 1080p for the tile we just right-clicked.
  const resolutionMenu = page
    .locator('[data-radix-menu-content][role="menu"]')
    .filter({ has: page.locator('button[role="menuitem"]:has(span:text-is("1080p"))') })
    .last()

  // Try once, then if it still isn't visible after ~1s, hover "Tải xuống" again and retry.
  let menuVisible = false
  try {
    await resolutionMenu.waitFor({ state: 'visible', timeout: 1000 })
    menuVisible = true
  } catch {
    // First hover wasn't enough — mimic manual fix by hovering again.
    await downloadItem.hover()
    await waitStable(page, 300)
    await resolutionMenu.waitFor({ state: 'visible', timeout: 1000 })
    menuVisible = true
  }

  if (!menuVisible) throw new Error('Resolution submenu with 1080p did not appear')

  const btn1080 = resolutionMenu
    .locator('button[role="menuitem"]')
    .filter({ has: page.locator('span:text-is("1080p")') })
    .first()

  await btn1080.scrollIntoViewIfNeeded()
  await waitStable(page, 100)

  // Always use JS click so 1080p is triggered regardless of menu position or overlapping toasts.
  await btn1080.evaluate((el: HTMLButtonElement) => el.click())
}

/** Tile locator for a completed video by tileId (matches parser output). */
function completedVideoTile(page: Page, tileId: string) {
  return page.locator(`[data-tile-id="${tileId}"]:has(video[src*="getMediaUrlRedirect"])`).first()
}

/**
 * Open a new page in the same context, navigate to one video's edit URL, click 1080p,
 * then bring the project tab to front immediately. Keep the edit tab open until the
 * download event is actually triggered, then close it.
 */
async function openEditPageInNewTabAndTrigger1080p(
  page: Page,
  editUrl: string
): Promise<{ downloadPromise: Promise<unknown> }> {
  stepLog(`  Open edit tab: ${editUrl}`)
  const editPage = await page.context().newPage()
  // Use page-level download event (more stable for edit-tab initiated downloads).
  const rawDownloadPromise = editPage.waitForEvent('download', { timeout: DOWNLOAD_EVENT_TIMEOUT_MS })
  try {
    await editPage.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await editPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null)
    await waitStable(editPage, 120)

    await withFocusLock(async () => {
      await bringProjectPageToFront(editPage, { bypassLock: true })
      const downloadBtn = editPage.locator(S.editPageDownloadBtn).first()
      await downloadBtn.waitFor({ state: 'visible', timeout: 20000 })
      const clickDeadline = Date.now() + EDIT_PAGE_DOWNLOAD_CLICK_TIMEOUT_MS
      let clickedDownload = false
      while (Date.now() < clickDeadline) {
        try {
          await bringProjectPageToFront(editPage, { bypassLock: true })
          await downloadBtn.scrollIntoViewIfNeeded().catch(() => null)
          await downloadBtn.click({ timeout: 8000 })
          clickedDownload = true
          break
        } catch (e) {
          const remain = Math.max(0, Math.ceil((clickDeadline - Date.now()) / 1000))
          stepLog(`  Download button not clickable yet, retry (${remain}s left): ${(e as Error).message}`)
          await waitStable(editPage, 900)
        }
      }
      if (!clickedDownload) {
        throw new Error(`Edit page download button not clickable within ${Math.floor(EDIT_PAGE_DOWNLOAD_CLICK_TIMEOUT_MS / 1000)}s`)
      }
      await waitStable(editPage, 150)

      const btn1080 = editPage.locator(S.editPage1080p).first()
      try {
        await bringProjectPageToFront(editPage, { bypassLock: true })
        await btn1080.waitFor({ state: 'visible', timeout: 8000 })
      } catch {
        // Retry opening resolution menu once (submenu can fail first time).
        await bringProjectPageToFront(editPage, { bypassLock: true })
        await downloadBtn.click().catch(() => null)
        await waitStable(editPage, 250)
        await btn1080.waitFor({ state: 'visible', timeout: 8000 })
      }
      try {
        await bringProjectPageToFront(editPage, { bypassLock: true })
        await btn1080.click()
      } catch {
        // Fallback JS click for flaky overlay cases.
        await btn1080.evaluate((el: HTMLButtonElement) => el.click())
      }
      stepLog('  Clicked 1080p on edit tab')
      // Return focus to project right after click while still in critical section.
      await bringProjectPageToFront(page, { bypassLock: true })
      stepLog('  Brought project tab to front')
    })
    await waitStable(editPage, 150)
    const downloadPromise = rawDownloadPromise.then(async (download) => {
      const downloadUrl = (download as { url(): string }).url()
      stepLog(`  Download URL (blob, new tab): ${downloadUrl}`)
      await editPage.close().catch(() => {})
      stepLog('  Closed edit tab after download event')
      return download
    }).catch(async (err) => {
      await editPage.close().catch(() => {})
      stepLog(`  Closed edit tab after download error: ${(err as Error).message}`)
      throw err
    })
    return { downloadPromise }
  } catch (err) {
    // Prevent unhandled rejection when we fail before returning downloadPromise.
    rawDownloadPromise.catch(() => {})
    await editPage.close().catch(() => {})
    await bringProjectPageToFront(page).catch(() => {})
    stepLog(`  Edit tab failed and closed: ${(err as Error).message}`)
    throw err
  }
}

/**
 * Trigger 1080p for multiple tiles one after another. For each tile: go to edit page (click tile link),
 * click 1080p, wait for the download event before starting the next tile, so the order of download events
 * matches the order of filenames (no duplicated/wrong assignment). Returns download objects and items in same order.
 * (We do not use trigger-all + match-by-URL because Veo uses blob: URLs for downloads, which don't contain workflowId.)
 *
 * When opts.unordered is true: register all download listeners first, then trigger all tiles in quick succession
 * (no await between triggers). Downloads resolve in completion order; caller must only commit when all N fulfill,
 * and saves in that order (filenames 1.mp4, 2.mp4, ... then reflect completion order, not tile order).
 */
async function batchTrigger1080pDownloads(
  page: Page,
  items: Array<{ tileId: string; outputPath: string; outputFileName: string; workflowKey: string; editUrl: string }>,
  opts?: { unordered?: boolean }
): Promise<{ downloadPromises: Promise<unknown>[]; successfulItems: typeof items }> {
  const downloadPromises: Promise<unknown>[] = []
  const successfulItems: Array<{ tileId: string; outputPath: string; outputFileName: string; workflowKey: string; editUrl: string }> = []
  if (items.length === 0) return { downloadPromises, successfulItems }

  const unordered = opts?.unordered === true
  stepLog(
    unordered
      ? `Batch 1080p (unordered/fast): trigger ${items.length} in quick succession, save in completion order`
      : `Batch 1080p: trigger ${items.length} download(s), wait for each download to start before next`
  )
  const outputDir = path.dirname(items[0].outputPath)
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  if (unordered) {
    // Unordered/fast: trigger all in parallel, each in its own tab, downloads resolve in completion order.
    const promises = items.map(async (item, idx) => {
      stepLog(`  Trigger 1080p (new tab) ${idx + 1}/${items.length}: ${item.outputFileName}`)
      const { downloadPromise } = await openEditPageInNewTabAndTrigger1080p(page, item.editUrl)
      return await downloadPromise
    })
    for (let i = 0; i < items.length; i++) {
      downloadPromises.push(promises[i])
      successfulItems.push(items[i])
    }
  } else {
    if (ORDERED_TWO_PASS_DOWNLOAD) {
      stepLog(`Batch 1080p two-pass: warm-up then final save (${items.length} item(s))`)
      const warmTasks: Promise<{ ok: boolean; item: typeof items[number] }>[] = []
      // Pass 1: sequentially trigger 1080p per tab, but do not wait each warm download to finish.
      // This opens many tabs quickly while preserving ordered click actions.
      for (let i = 0; i < items.length; i++) {
        if (isImageImportBusy(page)) {
          stepLog('  [WARM] Stop opening new upscale tabs: image import started')
          break
        }
        const item = items[i]
        stepLog(`  [WARM] Trigger 1080p ${i + 1}/${items.length}: ${item.outputFileName}`)
        try {
          const { downloadPromise } = await openEditPageInNewTabAndTrigger1080p(page, item.editUrl)
          stepLog(`  [WARM] Armed warm-up watcher: ${item.outputFileName}`)
          const task = downloadPromise
            .then(async (warmDownload) => {
              stepLog(`  [WARM] Download event received: ${item.outputFileName}`)
              await discardDownload(warmDownload)
              return { ok: true, item }
            })
            .catch((e) => {
              stepLog(`  [WARM] Skip ${item.outputFileName}: ${(e as Error).message}`)
              return { ok: false, item }
            })
          warmTasks.push(task)
        } catch (e) {
          stepLog(`  [WARM] Skip ${item.outputFileName}: ${(e as Error).message}`)
        }
        if (i < items.length - 1) await page.waitForTimeout(DOWNLOAD_BATCH_CLICK_GAP_MS)
      }
      const warmResults = await Promise.all(warmTasks)
      const warmedItems = warmResults.filter(r => r.ok).map(r => r.item)
      if (warmedItems.length === 0) {
        stepLog('  [WARM] No warmed items succeeded in this batch')
        return { downloadPromises, successfulItems }
      }
      stepLog(`  [WARM] Warmed ${warmedItems.length}/${items.length} item(s); start FINAL pass`)

      // Pass 2: click 1080p again, keep this download for actual save.
      for (let i = 0; i < warmedItems.length; i++) {
        if (isImageImportBusy(page)) {
          stepLog('  [FINAL] Stop opening new upscale tabs: image import started')
          break
        }
        const item = warmedItems[i]
        stepLog(`  [FINAL] Trigger 1080p ${i + 1}/${warmedItems.length}: ${item.outputFileName}`)
        try {
          const { downloadPromise } = await openEditPageInNewTabAndTrigger1080p(page, item.editUrl)
          stepLog(`  [FINAL] Waiting download event: ${item.outputFileName}`)
          const finalDownload = await downloadPromise
          downloadPromises.push(Promise.resolve(finalDownload))
          successfulItems.push(item)
        } catch (e) {
          stepLog(`  [FINAL] Skip ${item.outputFileName}: ${(e as Error).message}`)
        }
        if (i < warmedItems.length - 1) await page.waitForTimeout(DOWNLOAD_BATCH_CLICK_GAP_MS)
      }
      return { downloadPromises, successfulItems }
    }

    for (let i = 0; i < items.length; i++) {
      if (isImageImportBusy(page)) {
        stepLog('  Stop opening new upscale tabs: image import started')
        break
      }
      const item = items[i]
      stepLog(`  Click 1080p (new tab) ${i + 1}/${items.length}: ${item.outputFileName} (tile ${item.tileId})`)
      try {
        const { downloadPromise } = await openEditPageInNewTabAndTrigger1080p(page, item.editUrl)
        // Strictly wait for this download event before triggering the next one.
        // This prevents overlap/misalignment where multiple files can map to wrong slots.
        const download = await downloadPromise
        downloadPromises.push(Promise.resolve(download))
        successfulItems.push(item)
      } catch (e) {
        stepLog(`  Skip ${item.outputFileName} (menu failed): ${(e as Error).message}`)
      }
      if (i < items.length - 1) await page.waitForTimeout(DOWNLOAD_BATCH_CLICK_GAP_MS)
    }
  }

  return { downloadPromises, successfulItems }
}

export async function flowDownloadGeneratedVideo1080pByTileId(
  page: Page,
  tileId: string,
  outputPath: string
): Promise<void> {
  stepLog(`Download tile ${tileId} as 1080p to ${outputPath}`)
  await page.keyboard.press('Escape')
  await waitStable(page, 400)
  const tile = completedVideoTile(page, tileId)
  await tile.waitFor({ state: 'visible', timeout: 10000 })
  await tile.scrollIntoViewIfNeeded()
  await waitStable(page, 300)
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_EVENT_TIMEOUT_MS })
  await openMenuHoverDownloadAndClick1080p(page, tile)
  const download = await downloadPromise
  try {
    const tmpPath = await download.path()
    if (tmpPath && fs.existsSync(tmpPath)) {
      const buf = fs.readFileSync(tmpPath)
      await download.delete().catch(() => {})
      if (buf.length < 1000 || buf[0] === 0x3c) throw new Error(`Downloaded file too small or not video (${buf.length} bytes)`)
      fs.writeFileSync(outputPath, buf)
      stepLog(`Saved ${outputPath} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)
    } else {
      await download.saveAs(outputPath)
      stepLog(`Saved ${outputPath}`)
    }
  } finally {
    await page.keyboard.press('Escape')
    await waitStable(page, 500)
  }
}

/** Start 1080p download for a tile (open menu, click 1080p, wait for download event). Returns download and outputPath; caller saves in background. Use when starting many downloads with DOWNLOAD_START_INTERVAL_MS between each, without waiting for file to finish. */
export async function flowStartDownload1080pByTileId(
  page: Page,
  tileId: string,
  outputPath: string
): Promise<{ download: unknown; outputPath: string }> {
  stepLog(`Start download ${tileId} → ${outputPath}`)
  await page.keyboard.press('Escape')
  await waitStable(page, 400)
  const tile = completedVideoTile(page, tileId)
  await tile.waitFor({ state: 'visible', timeout: 10000 })
  await tile.scrollIntoViewIfNeeded()
  await waitStable(page, 300)
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_EVENT_TIMEOUT_MS })
  await openMenuHoverDownloadAndClick1080p(page, tile)
  const download = await downloadPromise
  await page.keyboard.press('Escape')
  await waitStable(page, 500)
  return { download, outputPath }
}

/** Save a Playwright download to outputPath (temp path + copy or saveAs). Resolves to outputPath on success. */
async function saveDownloadToFile(
  download: unknown,
  outputPath: string
): Promise<string> {
  const d = download as {
    path(): Promise<string | null>
    saveAs(p: string): Promise<void>
    delete(): Promise<void>
    url(): string
  }
  stepLog(`  Download blob URL: ${d.url()}`)
  try {
    const tmpPath = await d.path()
    if (tmpPath && fs.existsSync(tmpPath)) {
      const buf = fs.readFileSync(tmpPath)
      await d.delete().catch(() => {})
      if (buf.length < 1000 || buf[0] === 0x3c) throw new Error(`Downloaded file too small or not video (${buf.length} bytes)`)
      fs.writeFileSync(outputPath, buf)
      stepLog(`Saved ${outputPath} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)
    } else {
      await d.saveAs(outputPath)
      stepLog(`Saved ${outputPath}`)
    }
    return outputPath
  } finally {
    // ensure download is cleaned up
  }
}

/** Delete/consume a download object without saving to output (warm-up pass). */
async function discardDownload(download: unknown): Promise<void> {
  const d = download as {
    path(): Promise<string | null>
    delete(): Promise<void>
  }
  try {
    const tmpPath = await d.path().catch(() => null)
    if (tmpPath && fs.existsSync(tmpPath)) {
      await d.delete().catch(() => {})
      stepLog('  [WARM] Discarded warm-up download file')
    } else {
      await d.delete().catch(() => {})
      stepLog('  [WARM] Discarded warm-up download handle')
    }
  } catch {
    // ignore discard errors
  }
}

/** Wait for expectedCount videos, then download: tile (count-1) → 1.mp4, tile (count-2) → 2.mp4, ..., tile 0 → N.mp4. */
export async function flowWaitAndDownloadAllGeneratedVideos1080p(
  page: Page,
  outputDir: string,
  expectedCount: number,
  opts: { timeoutMs?: number; onProgress?: (completedCount: number) => void } = {}
): Promise<string[]> {
  stepLog(`Waiting for ${expectedCount} generated video(s)`)
  const count = await waitForGeneratedVideosCount(page, expectedCount, opts)
  if (count < expectedCount) stepLog(`Only ${count}/${expectedCount} videos completed within timeout`)
  const saved: string[] = []
  // Layout: leftmost tile = N.mp4, rightmost video tile = 1.mp4 → file (i+1).mp4 comes from tile index (count - 1 - i)
  for (let i = 0; i < count; i++) {
    const fileName = `${i + 1}.mp4`
    const outputPath = path.join(outputDir, fileName)
    const tileIndex = count - 1 - i
    try {
      await flowDownloadGeneratedVideo1080pAtTile(page, tileIndex, outputPath)
      saved.push(outputPath)
    } catch (e) {
      stepLog(`Download ${fileName} (tile ${tileIndex}) failed: ${(e as Error).message}`)
    }
  }
  return saved
}

/**
 * Parse the generated content list (virtuoso-item-list) into a data object.
 * Rows are processed data-index 1 first, then 0. Each row: left = newest video, right = image (1.png, 2.png).
 * Failed tile = e.g. 5.mp4 slot; retry makes it disappear and a new generating tile (to become 5.mp4) appears on the left.
 * Use: const data = await getParsedGeneratedList(page)
 */
export async function getParsedGeneratedList(page: Page): Promise<ParsedGeneratedList> {
  return page.evaluate(parseGeneratedContentListInPage, S.generatedListContainer)
}

/** Try primary list selector, then fallback if no rows/videos found (in case testid or DOM changed). */
export async function getParsedGeneratedListWithFallback(page: Page): Promise<ParsedGeneratedList> {
  let data = await page.evaluate(parseGeneratedContentListInPage, S.generatedListContainer)
  if ((data.rows.length === 0 || data.videos.length === 0) && data.generating.length === 0 && data.failed.length === 0) {
    data = await page.evaluate(parseGeneratedContentListInPage, S.generatedListContainerFallback)
    if (data.rows.length > 0 || data.videos.length > 0) stepLog('List found via fallback selector')
  }
  return data
}

/**
 * Track the generated list (virtuoso-item-list), download each video as soon as it's done (no waiting for all).
 * Preserves order: 1.mp4, 2.mp4, ... by slot. If any tile fails, click retry right away and track so the
 * re-generated video is saved with the correct filename (e.g. 5.mp4).
 * When opts.actionQueue is provided, all UI work (retries + 1080p clicks) is enqueued and runs after any submission; submission and download actions never run at the same time, so the flow of entering prompts and generating videos is not interrupted (we never navigate away during a submission).
 */
export async function flowWaitAndDownloadAllGeneratedVideos1080pUsingParser(
  page: Page,
  outputDir: string,
  expectedCount: number,
  opts: { timeoutMs?: number; onProgress?: (completedCount: number) => void; actionQueue?: ActionQueue; unordered?: boolean } = {}
): Promise<string[]> {
  const unordered = opts.unordered === true
  const timeoutMs = opts.timeoutMs ?? GENERATED_VIDEO_DEADLINE_MS
  const deadline = Date.now() + timeoutMs
  const pollIntervalMs = 1500
  const downloadedOutputNames = new Set<string>()
  const downloadedWorkflowKeys = new Set<string>()
  const workflowAssignedOutputNames = new Map<string, string>()
  const reservedOutputNames = new Set<string>()
  const retriedTileIds = new Set<string>()
  const permanentUpsampleFailures = new Set<string>()
  const permanentUpsampleFailureWorkflowKeys = new Set<string>()
  const downloadErrorCounts = new Map<string, number>()
  const saved: string[] = []
  const actionQueue = opts.actionQueue
  let lastData: ParsedGeneratedList | null = null
  let hasEverSeenVideoSlot = false
  let nextRetryAllowedAt = 0
  let maxObservedTotalSlots = 0
  let lastVirtualizedSweepAt = 0

  const workflowKeyForTile = (workflowId: string | null | undefined, outputFileName: string): string =>
    workflowId && workflowId.length > 0 ? workflowId : `no-workflow:${outputFileName}`
  const parseOutputNumber = (name: string): number => {
    const m = /^(\d+)\.mp4$/i.exec(name)
    return m ? parseInt(m[1], 10) : NaN
  }
  const nextFreeOutputName = (preferred: string): string => {
    if (!reservedOutputNames.has(preferred) && !downloadedOutputNames.has(preferred)) return preferred
    let n = parseOutputNumber(preferred)
    if (!Number.isFinite(n) || n < 1) n = 1
    while (reservedOutputNames.has(`${n}.mp4`) || downloadedOutputNames.has(`${n}.mp4`)) n++
    return `${n}.mp4`
  }

  stepLog(
    unordered
      ? `Tracking list: download each video (fast: trigger all 1080p, save in completion order)`
      : `Tracking list: download each video in order (1:1 per tile); retry failed immediately`
  )
  const timeoutLabel = Number.isFinite(timeoutMs) ? `${(timeoutMs / 60000).toFixed(1)} minute(s)` : 'unlimited'
  stepLog(`Tracker timeout budget: ${timeoutLabel}, expectedCount=${expectedCount}`)

  // Ensure the list is in view (may be needed for lazy-rendered or virtualized content)
  try {
    const listEl = page.locator(S.generatedListContainer).first()
    await listEl.scrollIntoViewIfNeeded().catch(async () => {
      await page.locator(S.generatedListContainerFallback).first().scrollIntoViewIfNeeded()
    })
  } catch {
    // ignore
  }
  await page.waitForTimeout(400)

  let pollCount = 0
  while (Date.now() < deadline) {
    const data = await getParsedGeneratedListWithFallback(page)
    lastData = data
    if (data.totalVideoSlots > 0) hasEverSeenVideoSlot = true
    if (data.totalVideoSlots > maxObservedTotalSlots) maxObservedTotalSlots = data.totalVideoSlots
    pollCount++

    if (pollCount === 1 || (data.videos.length === 0 && expectedCount > 0))
      stepLog(`Poll #${pollCount}: videos=${data.videos.length} generating=${data.generating.length} failed=${data.failed.length} rows=${data.rows.length} totalSlots=${data.totalVideoSlots}`)

    if (opts.onProgress) opts.onProgress(downloadedOutputNames.size)

    const hasWork = data.failed.some(f => !retriedTileIds.has(f.tileId)) ||
      data.videos.some(v => {
        const key = workflowKeyForTile(v.workflowId, v.outputFileName)
        return !downloadedWorkflowKeys.has(key) && !permanentUpsampleFailureWorkflowKeys.has(key)
      })
    if (hasWork) {
      const runWork = async (): Promise<{ downloadPromises: Promise<unknown>[]; successfulItems: Array<{ tileId: string; outputPath: string; outputFileName: string; workflowKey: string }> }> => {
        if (isImageImportBusy(page)) {
          stepLog('Image import is executing; defer download/retry actions this poll')
          return { downloadPromises: [], successfulItems: [] }
        }
        let pendingDownloadPromises: Promise<unknown>[] = []
        let pendingSuccessfulItems: Array<{ tileId: string; outputPath: string; outputFileName: string; workflowKey: string }> = []
        for (const f of data.failed) {
          if (retriedTileIds.has(f.tileId)) continue
          if (Date.now() < nextRetryAllowedAt) {
            const remainSec = Math.ceil((nextRetryAllowedAt - Date.now()) / 1000)
            stepLog(`Failed ${f.outputFileName} (id=${f.tileId}) → retry delayed (${remainSec}s cooldown)`)
            continue
          }
          const err = (f.errorMessage ?? '').toLowerCase()
          const isRateLimitedFailure =
            err.includes('quá nhanh') ||
            err.includes('too fast') ||
            err.includes('đợi một chút') ||
            err.includes('wait a bit')
          const didRetry = await clickRetryOnFailedTileByTileId(page, f.tileId)
          stepLog(`Failed ${f.outputFileName} (id=${f.tileId})${f.errorMessage ? `: "${f.errorMessage}"` : ''} → retry ${didRetry ? 'clicked' : 'skip'}`)
          retriedTileIds.add(f.tileId)
          if (didRetry) {
            if (isRateLimitedFailure) {
              const cooldownMs = RETRY_RATE_LIMIT_BASE_COOLDOWN_MS + Math.floor(Math.random() * (RETRY_RATE_LIMIT_JITTER_MS + 1))
              nextRetryAllowedAt = Date.now() + cooldownMs
              stepLog(`Rate-limit failure detected; pause retries for ${(cooldownMs / 1000).toFixed(0)}s`)
              await page.waitForTimeout(6000)
            } else {
              await page.waitForTimeout(1500)
            }
          }
        }
        const toDownload = data.videos
          .filter(v => {
            const key = workflowKeyForTile(v.workflowId, v.outputFileName)
            return !downloadedWorkflowKeys.has(key) && !permanentUpsampleFailureWorkflowKeys.has(key)
          })
          .sort((a, b) => a.videoIndex - b.videoIndex)
        if (toDownload.length > 0) {
          const savedNumbers = Array.from(downloadedOutputNames).map(n => parseInt(n.replace(/\D/g, ''), 10)).filter(n => !isNaN(n))
          const maxSavedSlot = savedNumbers.length > 0 ? Math.max(...savedNumbers) : 0
          const gaps = toDownload.filter(v => v.videoIndex <= maxSavedSlot).map(v => v.outputFileName)
          if (gaps.length > 0) stepLog(`Retrying missing slot(s): ${gaps.join(', ')}${toDownload.length > gaps.length ? ` (then ${toDownload.length - gaps.length} more)` : ''}`)

          const currentUrl = page.url()
          const projectMatch = currentUrl.match(VEO3_PROJECT_URL_PATTERN)
          const projectPath = projectMatch ? projectMatch[0] : null
          if (!projectPath) {
            stepLog(`Cannot derive project base URL from ${currentUrl}; skipping batch download this poll`)
            return { downloadPromises: pendingDownloadPromises, successfulItems: pendingSuccessfulItems }
          }

          const projectBase = `${VEO3_FLOW_BASE}${projectPath.replace('/flow', '')}`
          const items = toDownload.map(v => {
            const workflowId = v.workflowId
            const workflowKey = workflowKeyForTile(v.workflowId, v.outputFileName)
            let outputFileName = workflowAssignedOutputNames.get(workflowKey)
            if (!outputFileName) {
              outputFileName = nextFreeOutputName(v.outputFileName)
              workflowAssignedOutputNames.set(workflowKey, outputFileName)
              reservedOutputNames.add(outputFileName)
              if (outputFileName !== v.outputFileName) {
                stepLog(`Output name remap for workflow ${workflowKey}: ${v.outputFileName} -> ${outputFileName}`)
              }
            }
            const editUrl = workflowId
              ? `${projectBase}/edit/${workflowId}`
              : ''
            return {
              tileId: v.tileId,
              outputPath: path.join(outputDir, outputFileName),
              outputFileName,
              workflowKey,
              editUrl,
            }
          }).filter(i => i.editUrl.length > 0)
          try {
            const result = await batchTrigger1080pDownloads(page, items, { unordered })
            pendingDownloadPromises = result.downloadPromises
            pendingSuccessfulItems = result.successfulItems
          } catch (e) {
            stepLog(`Batch trigger failed: ${(e as Error).message}`)
          }
        }
        return { downloadPromises: pendingDownloadPromises, successfulItems: pendingSuccessfulItems }
      }

      const result = actionQueue
        ? await actionQueue.enqueue(runWork)
        : await runWork()

      if (result.successfulItems.length > 0) {
        if (unordered) {
          // Unordered: all downloads must complete; only then save and mark all (completion order → 1.mp4, 2.mp4, …).
          const settled = await Promise.allSettled(result.downloadPromises)
          const allFulfilled = settled.every(s => s.status === 'fulfilled')
          if (allFulfilled) {
            const savePromises = (settled as PromiseFulfilledResult<unknown>[]).map((s, i) =>
              saveDownloadToFile(s.value, result.successfulItems[i].outputPath)
            )
            const saveResults = await Promise.allSettled(savePromises)
            for (let i = 0; i < saveResults.length; i++) {
              if (saveResults[i].status === 'fulfilled') {
                const name = result.successfulItems[i].outputFileName
                const workflowKey = result.successfulItems[i].workflowKey
                downloadedOutputNames.add(name)
                downloadedWorkflowKeys.add(workflowKey)
                saved.push((saveResults[i] as PromiseFulfilledResult<string>).value)
                stepLog(`Downloaded ${name} (${saved.length}/${expectedCount})`)
              }
            }
          } else {
            const failed = settled.filter(s => s.status === 'rejected').length
            stepLog(`Unordered batch: ${failed} download(s) failed or timed out, will retry next poll`)
          }
        } else {
          const savePromises: Promise<string>[] = []
          const outputNamesForSaves: string[] = []
          const workflowKeysForSaves: string[] = []
          for (let i = 0; i < result.downloadPromises.length; i++) {
            const name = result.successfulItems[i].outputFileName
            const workflowKey = result.successfulItems[i].workflowKey
            try {
              const download = await result.downloadPromises[i]
              outputNamesForSaves.push(name)
              workflowKeysForSaves.push(workflowKey)
              savePromises.push(saveDownloadToFile(download, result.successfulItems[i].outputPath))
            } catch (e) {
              const prev = downloadErrorCounts.get(workflowKey) ?? 0
              const next = prev + 1
              downloadErrorCounts.set(workflowKey, next)
              if (next >= 3) {
                permanentUpsampleFailureWorkflowKeys.add(workflowKey)
                permanentUpsampleFailures.add(name)
                stepLog(`Marking ${name} (workflowKey=${workflowKey}) as permanently failed (1080p download error after ${next} attempts): ${(e as Error).message}`)
              } else {
                stepLog(`Download ${name} (workflowKey=${workflowKey}) failed (attempt ${next}), will retry: ${(e as Error).message}`)
              }
            }
          }
          const results = await Promise.allSettled(savePromises)
          for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled') {
              downloadedOutputNames.add(outputNamesForSaves[i])
              downloadedWorkflowKeys.add(workflowKeysForSaves[i])
              saved.push((results[i] as PromiseFulfilledResult<string>).value)
              stepLog(`Downloaded ${outputNamesForSaves[i]} (${saved.length}/${expectedCount})`)
            }
          }
        }
      } else {
        const toDownload = data.videos
          .filter(v => {
            const key = workflowKeyForTile(v.workflowId, v.outputFileName)
            return !downloadedWorkflowKeys.has(key) && !permanentUpsampleFailureWorkflowKeys.has(key)
          })
          .sort((a, b) => a.videoIndex - b.videoIndex)
        if (toDownload.length > 0) {
          stepLog('Batch: no 1080p clicks succeeded, will retry on next poll')
        }
      }
    }

    // Done condition: no generating tiles, no failed tiles with retry, and no completed videos left to download.
    // Require at least one download (or expectedCount===0) so we don't exit on a transient "0 slots" DOM state
    // (e.g. list briefly shows only image tiles after a generating placeholder disappears).
    const anyGenerating = data.generating.length > 0
    const anyFailedWithRetryLeft = data.failed.some(f => f.hasRetry && !retriedTileIds.has(f.tileId))
    const anyReadyVideoUndownloaded = data.videos.some(v => {
      const key = workflowKeyForTile(v.workflowId, v.outputFileName)
      return !downloadedWorkflowKeys.has(key) && !permanentUpsampleFailureWorkflowKeys.has(key)
    })
    const doneShapeReached =
      hasEverSeenVideoSlot &&
      !anyGenerating &&
      !anyFailedWithRetryLeft &&
      !anyReadyVideoUndownloaded &&
      (downloadedOutputNames.size > 0 || expectedCount === 0)
    const coverageCount = downloadedOutputNames.size + permanentUpsampleFailureWorkflowKeys.size
    const expectedSatisfied = expectedCount === 0 || coverageCount >= expectedCount
    const canConsiderDone = doneShapeReached && expectedSatisfied
    if (doneShapeReached && !expectedSatisfied) {
      stepLog(
        `Done-shape reached but coverage not enough: downloaded=${downloadedOutputNames.size}, permanentFailures=${permanentUpsampleFailureWorkflowKeys.size}, coverage=${coverageCount}/${expectedCount}, visibleSlots=${data.totalVideoSlots}, maxObservedSlots=${maxObservedTotalSlots}. Continue tracking.`
      )
      // Virtualized list can hide older tiles; force a periodic sweep so parser can see more rows/slots.
      if (Date.now() - lastVirtualizedSweepAt >= 15000) {
        lastVirtualizedSweepAt = Date.now()
        try {
          await page.evaluate((selector: string) => {
            const el = document.querySelector(selector) as HTMLElement | null
            if (!el) return
            el.scrollTop = 0
            el.dispatchEvent(new Event('scroll', { bubbles: true }))
            el.scrollTop = el.scrollHeight
            el.dispatchEvent(new Event('scroll', { bubbles: true }))
          }, S.generatedListContainer)
          await page.waitForTimeout(400)
          await page.mouse.wheel(0, 1800)
          await page.waitForTimeout(400)
          await page.mouse.wheel(0, -1800)
          stepLog('Forced virtualized-list sweep to reveal hidden video rows')
        } catch (e) {
          stepLog(`Virtualized-list sweep skipped: ${(e as Error).message}`)
        }
      }
    }
    if (canConsiderDone) {
      stepLog(
        `Tracker done: downloaded=${downloadedOutputNames.size}, permanentUpsampleFailures=${permanentUpsampleFailures.size}, totalSlots=${data.totalVideoSlots}${
          expectedCount ? `, expectedCount=${expectedCount}` : ''
        }`
      )
      if (lastData) logFinalSlotStatus(lastData, downloadedOutputNames, permanentUpsampleFailures)
      return saved
    }

    await page.waitForTimeout(pollIntervalMs)
  }

  stepLog(`Timeout: have ${saved.length}/${expectedCount} videos`)
  if (lastData) logFinalSlotStatus(lastData, downloadedOutputNames, permanentUpsampleFailures)
  return saved
}

function logFinalSlotStatus(
  data: ParsedGeneratedList,
  downloadedOutputNames: Set<string>,
  permanentUpsampleFailures: Set<string>
): void {
  const lines: string[] = []
  const rowsAsc = [...data.rows].sort((a, b) => a.dataIndex - b.dataIndex)
  for (const row of rowsAsc) {
    const tiles = row.tiles
    if (tiles.length === 0) continue
    const videoSlots = tiles.filter(t => t.type !== 'image')
    const inPromptOrder = videoSlots.slice().reverse()
    for (const t of inPromptOrder) {
      const name =
        t.type === 'image'
          ? t.outputFileName
          : t.type === 'video' || t.type === 'failed' || t.type === 'generating'
            ? t.outputFileName
            : ''
      if (!name) continue
      const workflow = t.workflowId ?? 'unknown'
      let status: string
      if (downloadedOutputNames.has(name)) status = 'downloaded'
      else if (permanentUpsampleFailures.has(name)) status = '1080p_failed_permanent'
      else if (t.type === 'failed') status = 'generation_failed'
      else if (t.type === 'generating') status = 'still_generating'
      else status = 'video_ready_not_downloaded'
      lines.push(`${name} [workflow=${workflow}] → ${status}`)
    }
  }
  if (lines.length > 0) {
    stepLog(`Final slot status:\n${lines.join('\n')}`)
  }
}
/**
 * Full flow: new project → Video mode → upload images → (optional) add to prompt → (optional) type prompt → submit.
 * When opts.debugUploadOnly is true: only upload, wait for all to finish, then return uploadLog (no add-to-prompt, no submit).
 */
export async function runVeo3CreateVideoFlow(
  page: Page,
  prompt: string,
  imagePaths: string[] = [],
  opts: Veo3FlowOptions = {}
): Promise<{ uploadLog?: UploadLogEntry[] } | void> {
  resetVeo3TraceLogs()
  stepLog('——— Veo3 create-video flow start ———')
  await flowClickNewProject(page)
  await flowSetVideoMode(page, {
    videoMode: opts.videoMode ?? 'frames',
    landscape: opts.landscape ?? false,
    multiplier: opts.multiplier ?? 2,
    ...opts,
  })

  if (imagePaths.length > 0) {
    const { orderedNames, uploadLog } = await flowUploadImages(page, imagePaths, opts.videoMode ?? 'frames')
    if (opts.debugUploadOnly) {
      stepLog('——— Veo3 debug upload only: skipping add-to-prompt and submit ———')
      return { uploadLog }
    }
    const tiles = page.locator(S.uploadedTile).filter({ has: page.locator('img') })
    const count = await tiles.count()
    stepLog(`Adding ${Math.min(opts.videoMode === 'ingredients' ? 3 : 2, imagePaths.length, count)} image(s) to prompt${orderedNames.length > 0 ? ' (by upload order)' : ''}`)
    await flowAddImagesToPrompt(page, opts.videoMode ?? 'frames', imagePaths, count, orderedNames)
    await flowTypePromptAndSubmit(page, prompt)
    stepLog('——— Veo3 create-video flow done ———')
    return
  } else if (opts.debugUploadOnly) {
    return { uploadLog: [] }
  }

  await flowTypePromptAndSubmit(page, prompt)
  stepLog('——— Veo3 create-video flow done ———')
}

const DELAY_BETWEEN_PROMPTS_MS = 20 * 1000
const DELAY_MIN_MS = 15 * 1000
const DELAY_MAX_MS = 19 * 1000

function randomDelayMs(minMs: number = DELAY_MIN_MS, maxMs: number = DELAY_MAX_MS): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1))
}

export interface Veo3FlowGroup {
  imagePaths: string[]
  prompts: string[]
}

/** Run project flow by groups: upload per group, then run all prompts in group reusing same upload; random 15-19s between prompts.
 * When downloadOpts is provided, starts the download tracker in parallel. Submission (add-to-prompt, upload, type-and-submit) is never delayed; the download tracker only runs its UI actions when submission is not in progress. */
export async function runVeo3ProjectFlowByGroups(
  page: Page,
  groups: Veo3FlowGroup[],
  opts: Veo3FlowOptions & { delayMinMs?: number; delayMaxMs?: number } = {},
  downloadOpts?: { outputDir: string; expectedCount: number; timeoutMs?: number; onProgress?: (completedCount: number) => void; unordered?: boolean }
): Promise<string[]> {
  resetVeo3TraceLogs()
  const mode = opts.videoMode ?? 'frames'
  const delayMinMs = opts.delayMinMs ?? DELAY_MIN_MS
  const delayMaxMs = opts.delayMaxMs ?? DELAY_MAX_MS
  stepLog('Veo3 project flow by groups: upload per group, random 15-19s between prompts')
  await flowClickNewProject(page)
  await flowSetVideoMode(page, {
    videoMode: mode,
    landscape: opts.landscape ?? false,
    multiplier: opts.multiplier ?? 2,
    ...opts,
  })

  let downloadPromise: Promise<string[]> | null = null
  if (downloadOpts) {
    stepLog('Starting download tracker in parallel (non-blocking with submissions)')
    downloadPromise = flowWaitAndDownloadAllGeneratedVideos1080pUsingParser(
      page,
      downloadOpts.outputDir,
      downloadOpts.expectedCount,
      {
        timeoutMs: downloadOpts.timeoutMs,
        onProgress: downloadOpts.onProgress,
        unordered: downloadOpts.unordered,
      }
    )
  }

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]
    const validPaths = group.imagePaths.filter(p => p && fs.existsSync(p))
    if (validPaths.length > 0) {
      stepLog(`Group ${g + 1}/${groups.length}: upload ${validPaths.length} image(s), then ${group.prompts.length} prompt(s)`)
      await flowUploadImages(page, validPaths, mode, { leaveDialogOpen: true })
      const localFileNames = validPaths.map(p => path.basename(p))
      await waitStable(page, 800)
      for (let p = 0; p < group.prompts.length; p++) {
        stepLog(`  Prompt ${p + 1}/${group.prompts.length}: add images, type, submit`)
        const twoSlots = false
        const promptText = group.prompts[p]
        await flowAddImagesToPromptFromOrderedNames(page, localFileNames, twoSlots)
        await page.keyboard.press('Escape')
        await waitStable(page)
        await flowTypePromptAndSubmit(page, promptText)
        if (p < group.prompts.length - 1) {
          const waitMs = randomDelayMs(delayMinMs, delayMaxMs)
          stepLog(`  Waiting ${waitMs / 1000}s before next prompt`)
          await page.waitForTimeout(waitMs)
        }
      }
    } else {
      stepLog(`Group ${g + 1}/${groups.length}: no images, run ${group.prompts.length} prompt(s) without images`)
      for (let p = 0; p < group.prompts.length; p++) {
        await flowTypePromptAndSubmit(page, group.prompts[p])
        if (p < group.prompts.length - 1) {
          const waitMs = randomDelayMs(delayMinMs, delayMaxMs)
          await page.waitForTimeout(waitMs)
        }
      }
    }
  }
  stepLog('Veo3 project flow by groups done')
  if (downloadPromise) {
    stepLog('Waiting for download tracker to finish…')
    return downloadPromise
  }
  return []
}

/**
 * One project, no navigating: new project → set video mode → upload ALL images once → for each prompt add that job's images, type prompt, submit; 30s between each.
 * When scriptIndexPerJob is provided (script mode): each job i uses orderedNames[scriptIndexPerJob[i]] for both frames (1 image per script).
 */
export async function runVeo3ProjectFlow(
  page: Page,
  prompts: string[],
  allImagePaths: string[],
  opts: Veo3FlowOptions & { delayBetweenPromptsMs?: number; scriptIndexPerJob?: number[] } = {}
): Promise<{ uploadLog?: UploadLogEntry[] } | void> {
  resetVeo3TraceLogs()
  const mode = opts.videoMode ?? 'frames'
  const delayMs = opts.delayBetweenPromptsMs ?? DELAY_BETWEEN_PROMPTS_MS
  const scriptIndexPerJob = opts.scriptIndexPerJob
  stepLog('——— Veo3 project flow (one project, all images once) ———')
  await flowClickNewProject(page)
  await flowSetVideoMode(page, {
    videoMode: mode,
    landscape: opts.landscape ?? false,
    multiplier: opts.multiplier ?? 2,
    ...opts,
  })

  if (allImagePaths.length === 0) {
    for (let i = 0; i < prompts.length; i++) {
      await flowTypePromptAndSubmit(page, prompts[i])
      if (i < prompts.length - 1) await page.waitForTimeout(delayMs)
    }
    stepLog('——— Veo3 project flow done ———')
    return
  }

  const { orderedNames, uploadLog } = await flowUploadImages(page, allImagePaths, mode)
  if (opts.debugUploadOnly) {
    stepLog('——— Veo3 debug upload only ———')
    return { uploadLog }
  }

  for (let i = 0; i < prompts.length; i++) {
    stepLog(`Job ${i + 1}/${prompts.length}: add images, type prompt, submit`)
    if (scriptIndexPerJob != null && scriptIndexPerJob[i] !== undefined) {
      await flowAddImagesToPromptForScriptJob(page, orderedNames, scriptIndexPerJob[i])
    } else {
      await flowAddImagesToPromptForJob(page, mode, orderedNames, i)
    }
    await flowTypePromptAndSubmit(page, prompts[i])
    if (i < prompts.length - 1) {
      stepLog(`Waiting ${delayMs / 1000}s before next prompt…`)
      await page.waitForTimeout(delayMs)
    }
  }
  stepLog('——— Veo3 project flow done ———')
}
