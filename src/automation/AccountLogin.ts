/**
 * FLOW AUTOMATION - AccountLogin
 * File: src/automation/AccountLogin.ts
 *
 * Dang nhap Grok bang credentials co san tu file .txt
 *
 * Format file credentials.txt:
 *   email1@gmail.com:password1
 *   email2@gmail.com:password2
 *
 * Flow:
 *   1. Mo accounts.x.ai/sign-in?redirect=grok-com&return_to=/imagine&email=true
 *   2. Dien email -> click Next
 *   3. Dien password -> cho Turnstile -> click Login
 *   4. (neu co) /accept-tos -> click 2 checkbox -> click Continue
 *   5. Verify login tren grok.com/imagine
 */

import { BrowserContext, Page } from 'patchright'
import * as fs from 'fs'
import { WorkerEventHandler } from './types'

// ---- Selectors --------------------------------------------------------------

const S = {
  // Buoc 1: nhap email
  emailInput:   'input[data-testid="email"]',
  emailNextBtn: 'button[type="submit"]:has-text("Next")',

  // Buoc 2: nhap password (hien ra sau khi click Next)
  passwordInput: 'input[type="password"][name="password"]',
  loginBtn:      'button[type="submit"]:has-text("Login")',

  // Wrong credentials (login.html: p.text-destructive)
  wrongCredsMessage: 'p.text-destructive:has-text("Wrong email")',

  // Turnstile / human verification (before or after Login)
  turnstile:    'input[name="cf-turnstile-response"]',

  // Human verification checkbox / challenge (after Login - wait for navigation)
  humanVerifyHint: '[data-turnstile], iframe[src*="turnstile"], [aria-label*="human"], [aria-label*="robot"], .cf-turnstile',

  // Accept TOS (neu bi redirect ve /accept-tos)
  tosCheckbox1: 'input[name="readTerms"]',
  tosCheckbox2: 'input[name="ageLimit"]',
  tosContinue:  'button[type="submit"]:has-text("Continue")',

  // Logged-in state on grok.com (login_success_sidebar.html: profile button in footer)
  grokLoggedInFooter: '[data-sidebar="footer"] button[aria-haspopup="menu"]',
} as const

const DOM_STABLE_MS = 1000

export interface Credential {
  email:    string
  password: string
}

export function parseCredentialsFile(filePath: string): Credential[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File khong ton tai: ${filePath}`)
  }

  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))

  const credentials: Credential[] = []
  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { console.warn(`[credentials] Bo qua: "${line}"`); continue }
    const email    = line.slice(0, colonIdx).trim()
    const password = line.slice(colonIdx + 1).trim()
    if (email && password) credentials.push({ email, password })
  }

  if (credentials.length === 0) throw new Error(`Khong co credentials hop le: ${filePath}`)
  return credentials
}

// ---- AccountLogin -----------------------------------------------------------

export interface AccountLoginResult {
  profileId: string
  success:   boolean
  email?:    string
  error?:    string
}

export class AccountLogin {
  private ctx:       BrowserContext
  private profileId: string
  private onEvent:   WorkerEventHandler
  private onLog?:   (level: 'info' | 'warn' | 'error', message: string) => void
  private page:      Page | null = null

  constructor(ctx: BrowserContext, profileId: string, onEvent: WorkerEventHandler, opts?: { onLog?: (level: 'info' | 'warn' | 'error', message: string) => void }) {
    this.ctx       = ctx
    this.profileId = profileId
    this.onEvent   = onEvent
    this.onLog     = opts?.onLog
  }

  async login(credential: Credential): Promise<AccountLoginResult> {
    this.log('info', `Dang nhap: ${credential.email}`)

    try {
      this.emit('progress', { step: 'Mo trang dang nhap...', percent: 15 })
      await this.step1_openSignIn(credential.email)

      this.emit('progress', { step: 'Nhap password...', percent: 40 })
      await this.step2_enterPassword(credential.password)

      this.emit('progress', { step: 'Kiem tra TOS...', percent: 65 })
      await this.step3_handleTosIfNeeded()

      this.emit('progress', { step: 'Xac nhan dang nhap...', percent: 80 })
      await this.step4_verifyGrok()

      this.emit('progress', { step: 'San sang!', percent: 100 })
      this.emit('completed', { profileId: this.profileId, email: credential.email })
      this.log('info', `Ready: ${credential.email}`)

      return { profileId: this.profileId, success: true, email: credential.email }

    } catch (err: any) {
      const error = err.message ?? String(err)
      this.emit('failed', { profileId: this.profileId, error })
      this.log('error', `That bai: ${error}`)
      return { profileId: this.profileId, success: false, error }
    }
  }

  // ---- Step 1: Mo sign-in, dien email, click Next ---------------------------
  private async step1_openSignIn(email: string): Promise<void> {
    this.page = await this.ctx.newPage()

    // URL nay tu dong redirect ve grok.com/imagine sau khi dang nhap thanh cong
    await this.page.goto(
      'https://accounts.x.ai/sign-in?redirect=grok-com&return_to=/imagine&email=true',
      { waitUntil: 'domcontentloaded' }
    )
    await this.page.waitForLoadState('networkidle', { timeout: 30000 })

    // Dien email
    await this.page.waitForSelector(S.emailInput, { timeout: 10000 })
    await this.page.fill(S.emailInput, email)
    await this.page.waitForTimeout(300)

    // Click Next -> hien ra password input
    await this.page.click(S.emailNextBtn)
    await this.page.waitForTimeout(DOM_STABLE_MS)
    this.log('info', 'Da click Next, cho password input...')
  }

  // ---- Step 2: Dien password, cho Turnstile, click Login --------------------
  private async step2_enterPassword(password: string): Promise<void> {
    if (!this.page) throw new Error('page chua mo')

    // Cho password input hien ra
    await this.page.waitForSelector(S.passwordInput, { timeout: 10000 })
    await this.page.fill(S.passwordInput, password)
    await this.page.waitForTimeout(300)

    // Cho Turnstile solve truoc khi Login (neu co)
    this.log('info', 'Cho Turnstile / xac minh nguoi...')
    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | null
        return el && el.value && el.value.length > 10
      },
      S.turnstile,
      { timeout: 25000 }
    ).catch(() => this.log('warn', 'Turnstile chua co token - click Login roi cho xac minh sau'))

    // Click Login (sau do co the hien "verify you are human" checkbox)
    await this.page.click(S.loginBtn)
    await this.page.waitForTimeout(DOM_STABLE_MS)
    this.log('info', 'Da click Login, cho redirect hoac xac minh nguoi...')

    // Doi toi da 60s: redirect ve accept-tos / grok / accounts.x.ai/account HOAC thong bao sai MK
    // accounts.x.ai/account = da dang nhap, step4 se navigate sang grok.com/imagine
    const timeoutMs = 60000
    const pollMs = 2500
    let elapsed = 0
    let lastLoggedHuman = false

    while (elapsed < timeoutMs) {
      await this.page.waitForTimeout(pollMs)
      elapsed += pollMs
      const url = this.page.url()

      if (url.includes('accept-tos') || url.includes('grok.com') || url.includes('accounts.x.ai/account')) {
        this.log('info', `Redirect sau ${elapsed / 1000}s -> ${url.includes('grok.com') ? 'grok' : url.includes('accept-tos') ? 'accept-tos' : 'account'}`)
        return
      }

      if (url.includes('accounts.x.ai') && url.includes('sign-in')) {
        const wrongCreds = await this.page.locator(S.wrongCredsMessage).isVisible().catch(() => false)
        if (wrongCreds) {
          this.log('error', 'Sai email hoac mat khau')
          throw new Error('Wrong email or password')
        }
        const humanVisible = await this.page.locator(S.humanVerifyHint).first().isVisible().catch(() => false)
        if (humanVisible && !lastLoggedHuman) {
          this.log('info', 'Phat hien xac minh nguoi (checkbox/captcha) — cho hoan thanh...')
          lastLoggedHuman = true
        }
      }
    }

    throw new Error('Dang nhap timeout — hay hoan thanh "verify you are human" va thu lai')
  }

  // ---- Step 3: Xu ly /accept-tos neu co -------------------------------------
  private async step3_handleTosIfNeeded(): Promise<void> {
    if (!this.page) throw new Error('page chua mo')

    // Cho page on dinh
    await this.page.waitForLoadState('domcontentloaded').catch(() => {})

    const url = this.page.url()
    if (!url.includes('accept-tos')) {
      this.log('info', 'Khong co TOS, bo qua')
      return
    }

    this.log('info', 'Phat hien /accept-tos, xu ly...')

    // 2 checkbox (dung button role=checkbox thay vi input an)
    // Click vao button[role="checkbox"] — checkbox thuc la input[type=hidden]
    const checkboxes = this.page.locator('button[role="checkbox"]')
    const count = await checkboxes.count()

    for (let i = 0; i < count; i++) {
      const cb    = checkboxes.nth(i)
      const state = await cb.getAttribute('aria-checked')
      if (state !== 'true') {
        await cb.click()
        await this.page.waitForTimeout(DOM_STABLE_MS)
      }
    }
    this.log('info', `Da check ${count} checkboxes`)

    // Click Continue
    await this.page.click(S.tosContinue)
    await this.page.waitForTimeout(DOM_STABLE_MS)
    this.log('info', 'Da click Continue tren TOS')
  }

  // ---- Step 4: Verify dang nhap tren grok.com/imagine ----------------------
  private async step4_verifyGrok(): Promise<void> {
    if (!this.page) throw new Error('page chua mo')

    const url = this.page.url()
    if (!url.includes('grok.com')) {
      this.log('info', 'Chua o grok.com -> dieu huong sang grok.com/imagine')
      await this.page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded' })
      await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    }

    // Doi toi da 25s cho nut profile trong sidebar footer (logged-in state)
    try {
      await this.page.waitForSelector(S.grokLoggedInFooter, { timeout: 25000 })
    } catch {
      throw new Error('Dang nhap Grok that bai — kiem tra lai email/password')
    }

    this.log('info', 'Dang nhap Grok thanh cong')

    // Chi giu lai 1 tab (grok.com/imagine), dong cac tab khac
    await this.closeExtraTabs()
  }

  /** Dong tat ca tab ngoai tru tab dang o grok.com/imagine. */
  private async closeExtraTabs(): Promise<void> {
    if (!this.ctx) return
    const pages = this.ctx.pages()
    const grokUrl = 'grok.com/imagine'
    let keepPage: Page | null = null

    for (const p of pages) {
      try {
        if (p.url().includes(grokUrl)) {
          keepPage = p
          break
        }
      } catch { /* page may be closed */ }
    }

    for (const p of pages) {
      try {
        if (p !== keepPage) await p.close()
      } catch { /* ignore */ }
    }

    if (keepPage) this.page = keepPage
  }

  // ---- Helpers --------------------------------------------------------------
  private emit(type: string, payload: Record<string, any>) {
    this.onEvent(type as any, { ...payload, profileId: this.profileId } as any)
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString()
    console.log(`[${ts}][${this.profileId}][${level.toUpperCase().slice(0, 3)}] ${message}`)
    this.onLog?.(level, message)
    this.onEvent('log' as any, { level, message, timestamp: ts } as any)
  }
}