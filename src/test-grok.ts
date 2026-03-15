/**
 * FLOW AUTOMATION — Test Script
 * File: src/test-grok.ts
 *
 * Chạy: npx ts-node src/test-grok.ts
 *
 * Đổi CONFIG.mode để test từng flow:
 *   prompt-to-image   → chỉ cần prompt
 *   prompt-to-video   → cần prompt + resolution
 *   image-to-video    → cần prompt + imagePath
 *   images-to-image   → cần prompt + imagePaths[]
 */

import { chromium } from 'patchright'
import path from 'path'
import fs from 'fs'
import { JobRunner } from './automation/jobRunner'
import { buildJobsFromPrompts, parsePromptsFromText, parsePromptsFromFile } from './automation/inputParser'
import { VideoConfig, WorkerEventType } from './automation/types'

// ════════════════════════════════════════════════════════════
//  ⚙️  CONFIG
// ════════════════════════════════════════════════════════════

const CONFIG = {
  profileDir:    path.resolve('./profiles/account-001'),
  outputBaseDir: path.resolve('./outputs'),

  // Tên video → output folder: outputs/anya-eating/
  videoTitle: 'anya-eating',

  // Config chung cho tất cả prompts
  videoConfig: {
    mode:       'prompt-to-video',
    ratio:      '16:9',
    resolution: '480p',
  } satisfies VideoConfig,

  // Prompts: chọn 1 trong 2 cách

  // Cách 1: nhập thẳng (dùng dòng trắng để phân cách nhiều prompts)
  promptText: `
anya forger eating peanuts, cute anime style, vibrant colors

anya forger drinking tea, cozy afternoon, soft lighting
  `.trim(),

  // Cách 2: đọc từ file (bỏ comment để dùng)
  // promptFile: path.resolve('./prompts/anya.txt'),

  // Thư mục ảnh (chỉ cần khi mode là image-to-video hoặc images-to-image)
  // Ảnh đặt tên: 1.jpg, 2.jpg, ... tương ứng với thứ tự prompt
  // imageDir: path.resolve('./assets/anya'),
}

// ════════════════════════════════════════════════════════════
//  🚀  Main
// ════════════════════════════════════════════════════════════

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)

async function main() {
  log('🚀 Flow Automation — Test Runner')
  log(`📋 Video   : "${CONFIG.videoTitle}"`)
  log(`🎬 Mode    : ${CONFIG.videoConfig.mode} | ${CONFIG.videoConfig.ratio}${
    CONFIG.videoConfig.resolution ? ` | ${CONFIG.videoConfig.resolution}` : ''
  }`)

  // ── Parse prompts ──────────────────────────────────────────
  let prompts: string[]

  if ((CONFIG as any).promptFile) {
    const parsed = parsePromptsFromFile((CONFIG as any).promptFile)
    prompts = parsed.prompts
    log(`📄 Prompts từ file: ${parsed.source} (${prompts.length} prompts)`)
  } else {
    prompts = parsePromptsFromText(CONFIG.promptText)
    log(`📝 Prompts từ text: ${prompts.length} prompts`)
  }

  prompts.forEach((p, i) => log(`   ${i + 1}. "${p.slice(0, 60)}"`))

  // ── Build jobs ─────────────────────────────────────────────
  const videoId   = `video_${Date.now()}`
  const outputDir = path.join(CONFIG.outputBaseDir, CONFIG.videoTitle)

  const jobs = buildJobsFromPrompts({
    videoId,
    videoTitle: CONFIG.videoTitle,
    prompts,
    config:        CONFIG.videoConfig,
    outputBaseDir: CONFIG.outputBaseDir,
    imageDir:      (CONFIG as any).imageDir,
  })

  log(`📦 Tạo ${jobs.length} jobs → output: ${outputDir}`)

  // ── Setup Chrome ───────────────────────────────────────────
  if (!fs.existsSync(CONFIG.profileDir)) {
    fs.mkdirSync(CONFIG.profileDir, { recursive: true })
  }

  log('📂 Mở Chrome profile...')
  const ctx = await chromium.launchPersistentContext(CONFIG.profileDir, {
    channel:  'chrome',
    headless: false,
    viewport: { width: 1280, height: 700 },
    args: ['--no-sandbox'],
  })

  // ── Check login ────────────────────────────────────────────
  const loginPage = await ctx.newPage()
  await loginPage.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded' })

  const isLoggedIn = await checkLoginStatus(loginPage)
  if (!isLoggedIn) {
    await waitForLogin(loginPage)
  } else {
    log('✅ Profile đã đăng nhập.')
  }
  await loginPage.close()

  // ── Cleanup on Ctrl+C ──────────────────────────────────────
  process.on('SIGINT', async () => {
    log('👋 Thoát...')
    await ctx.close()
    process.exit(0)
  })

  // ── Run jobs ───────────────────────────────────────────────
  const runner = new JobRunner(ctx, 'account-001', (type: WorkerEventType, payload: any) => {
    switch (type) {
      case 'progress':
        process.stdout.write(`\r  ⏳ ${payload.step.padEnd(35)} ${String(payload.percent).padStart(3)}%`)
        if (payload.percent === 100) process.stdout.write('\n')
        break
      case 'completed':
        log(`✅ → ${payload.filePath}`)
        break
      case 'failed':
        log(`\n❌ ${payload.error}`)
        break
      case 'log':
        if (payload.level !== 'info') {
          log(`   ${payload.level === 'error' ? '❌' : '⚠️ '} ${payload.message}`)
        }
        break
    }
  })

  log('──────────────────────────────────────────')
  const summary = await runner.runAll(jobs, outputDir)
  log('──────────────────────────────────────────')
  log(`✅ Xong: ${summary.success}/${summary.total} thành công`)
  if (summary.failed > 0) {
    log(`❌ Thất bại: ${summary.failed} jobs`)
    log('⏸️  Browser giữ mở để debug')
  } else {
    await ctx.close()
    process.exit(0)
  }
}

async function checkLoginStatus(page: any): Promise<boolean> {
  try {
    const avatarBtn = await page.$('[data-sidebar="sidebar"] button[aria-haspopup="menu"]')
    if (avatarBtn) return true
    const initialsSpan = await page.$('[data-sidebar="sidebar"] span.bg-surface-l4')
    if (initialsSpan) return true
    return false
  } catch {
    return false
  }
}

async function waitForLogin(page: any): Promise<void> {
  let elapsed = 0
  log('⚠️  Chưa đăng nhập — vui lòng đăng nhập trong cửa sổ Chrome.')
  while (true) {
    await page.waitForTimeout(3000)
    elapsed += 3
    process.stdout.write(`\r⏳ Chờ đăng nhập... ${elapsed}s   `)
    if (await checkLoginStatus(page)) {
      process.stdout.write('\n')
      log('✅ Đăng nhập thành công!')
      return
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})