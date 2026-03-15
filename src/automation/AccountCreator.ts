/**
 * FLOW AUTOMATION - AccountCreator
 * File: src/automation/AccountCreator.ts
 *
 * Tu dong tao 1 Grok account tren 1 Chrome profile trang.
 *
 * Flow:
 *   1. Tao mailbox qua mail.tm API (khong can browser tab)
 *   2. Mo accounts.x.ai/sign-up -> dien email -> submit
 *   3. Poll mail.tm API cho den khi co OTP code
 *   4. Nhap code + name + password -> Complete sign up
 *   5. Mo grok.com/imagine -> verify login -> ready
 */

import { BrowserContext, Page } from 'patchright'
import { WorkerEventHandler } from './types'
import { MailTmClient, MailTmMailbox } from './Mailtmclient'

// ---- Selectors: accounts.x.ai/sign-up --------------------------------------

const SIGNUP_SELECTORS = {
  // Trang 1: chon phuong thuc dang ky
  signUpWithEmailBtn: 'button:has(svg.lucide-mail)',

  // Trang 2: nhap email
  emailInput:    'input[data-testid="email"]',
  emailNextBtn:  'button[type="submit"]',

  // Trang 3: OTP input
  // data-input-otp="true" - tu dong submit khi nhap du 6 ki tu
  codeInput:     'input[data-input-otp="true"]',
  codeSubmitBtn: 'button[type="submit"]',

  // Trang 4: Complete your sign up
  firstNameInput:    'input[data-testid="givenName"]',
  lastNameInput:     'input[data-testid="familyName"]',
  passwordInput:     'input[data-testid="password"]',
  completeSignUpBtn: 'button[type="submit"]:has-text("Complete sign up")',

  // Cloudflare Turnstile - cho solve truoc khi submit
  turnstileResponse: 'input[name="cf-turnstile-response"]',
} as const

// ---- Random name generator --------------------------------------------------

const FIRST_NAMES = [
  'James', 'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'William', 'Sophia',
  'Benjamin', 'Isabella', 'Lucas', 'Mia', 'Henry', 'Charlotte', 'Alexander',
  'Amelia', 'Mason', 'Harper', 'Ethan', 'Evelyn', 'Daniel', 'Luna',
]

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White',
  'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis',
]

function randomName(): { firstName: string; lastName: string } {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const lastName  = LAST_NAMES [Math.floor(Math.random() * LAST_NAMES.length)]
  return { firstName, lastName }
}

const PASSWORD = 'Testpassword1@'

// ---- AccountCreator ---------------------------------------------------------

export interface AccountCreatorResult {
  profileId: string
  success:   boolean
  email?:    string
  error?:    string
}

export class AccountCreator {
  private ctx:        BrowserContext
  private profileId:  string
  private onEvent:    WorkerEventHandler
  private signupPage: Page | null = null

  constructor(ctx: BrowserContext, profileId: string, onEvent: WorkerEventHandler) {
    this.ctx       = ctx
    this.profileId = profileId
    this.onEvent   = onEvent
  }

  // ---- Public entry point ---------------------------------------------------
  async createAccount(): Promise<AccountCreatorResult> {
    this.log('info', 'Bat dau tao tai khoan')

    try {
      // Buoc 1: Tao mailbox qua API - khong can browser
      this.emit('progress', { step: 'Tao email...', percent: 10 })
      const mailbox = await MailTmClient.createMailbox()
      this.log('info', `Email: ${mailbox.email}`)

      // Buoc 2: Mo xAI sign-up, dien email
      this.emit('progress', { step: 'Mo form dang ky...', percent: 25 })
      await this.step2_startSignup(mailbox.email)

      // Buoc 3: Poll mail.tm API cho den khi co OTP
      this.emit('progress', { step: 'Cho ma xac minh...', percent: 45 })
      const client = new MailTmClient(mailbox)
      const code   = await client.waitForXaiCode()
      this.log('info', `OTP: ${code}`)

      // Buoc 4: Nhap code + name + password
      this.emit('progress', { step: 'Hoan tat dang ky...', percent: 65 })
      await this.step4_completeSignup(code)

      // Buoc 5: Mo grok.com/imagine, verify login
      this.emit('progress', { step: 'Xac nhan tai khoan...', percent: 85 })
      await this.step5_verifyAndOpenGrok()

      this.emit('progress', { step: 'San sang!', percent: 100 })
      this.emit('completed', { profileId: this.profileId, email: mailbox.email })
      this.log('info', `Profile ready: ${mailbox.email}`)

      return { profileId: this.profileId, success: true, email: mailbox.email }

    } catch (err: any) {
      const error = err.message ?? String(err)
      this.emit('failed', { profileId: this.profileId, error })
      this.log('error', `That bai: ${error}`)
      return { profileId: this.profileId, success: false, error }
    }
  }

  // ---- Step 2: Mo xAI sign-up va dien email ---------------------------------
  private async step2_startSignup(email: string): Promise<void> {
    this.signupPage = await this.ctx.newPage()
    await this.signupPage.goto('https://accounts.x.ai/sign-up', { waitUntil: 'domcontentloaded' })
    await this.signupPage.waitForLoadState('networkidle', { timeout: 30000 })

    // Trang 1: click "Sign up with email"
    await this.signupPage.waitForSelector(SIGNUP_SELECTORS.signUpWithEmailBtn, { timeout: 10000 })
    await this.signupPage.click(SIGNUP_SELECTORS.signUpWithEmailBtn)
    await this.signupPage.waitForTimeout(800)

    // Trang 2: dien email
    await this.signupPage.waitForSelector(SIGNUP_SELECTORS.emailInput, { timeout: 10000 })
    await this.signupPage.fill(SIGNUP_SELECTORS.emailInput, email)
    await this.signupPage.waitForTimeout(300)
    await this.signupPage.click(SIGNUP_SELECTORS.emailNextBtn)
    this.log('info', 'Da submit email, cho OTP...')
  }

  // ---- Step 4: Nhap OTP + name + password -----------------------------------
  private async step4_completeSignup(code: string): Promise<void> {
    if (!this.signupPage) throw new Error('signupPage chua mo')

    // Trang 3: nhap OTP (bo dau '-': "XOY-OXL" -> "XOYOXL")
    await this.signupPage.waitForSelector(SIGNUP_SELECTORS.codeInput, { timeout: 15000 })
    const codeClean = code.replace('-', '')
    await this.signupPage.fill(SIGNUP_SELECTORS.codeInput, codeClean)
    this.log('info', `Nhap OTP: ${codeClean}`)

    // OTP tu submit khi du 6 ki tu, cho chuyen trang
    await this.signupPage.waitForTimeout(1500)
    try {
      const visible = await this.signupPage.isVisible(SIGNUP_SELECTORS.codeSubmitBtn)
      if (visible) await this.signupPage.click(SIGNUP_SELECTORS.codeSubmitBtn)
    } catch {}

    // Trang 4: Complete your sign up
    await this.signupPage.waitForSelector(SIGNUP_SELECTORS.firstNameInput, { timeout: 15000 })

    const { firstName, lastName } = randomName()
    this.log('info', `Name: ${firstName} ${lastName}`)

    await this.signupPage.fill(SIGNUP_SELECTORS.firstNameInput, firstName)
    await this.signupPage.fill(SIGNUP_SELECTORS.lastNameInput, lastName)
    await this.signupPage.fill(SIGNUP_SELECTORS.passwordInput, PASSWORD)
    await this.signupPage.waitForTimeout(500)

    // Cho Cloudflare Turnstile solve (Patchright + real Chrome tu bypass)
    this.log('info', 'Cho Turnstile...')
    await this.signupPage.waitForFunction(
      (sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null
        return input && input.value && input.value.length > 10
      },
      SIGNUP_SELECTORS.turnstileResponse,
      { timeout: 30000 }
    ).catch(() => {
      this.log('warn', 'Turnstile timeout - thu submit anyway')
    })

    await this.signupPage.click(SIGNUP_SELECTORS.completeSignUpBtn)
    await this.signupPage.waitForTimeout(2000)
    this.log('info', 'Da click Complete sign up')
  }

  // ---- Step 5: Mo grok.com/imagine va verify login --------------------------
  // Session tu xAI sang grok.com can vai giay de propagate — poll retry 30s
  private async step5_verifyAndOpenGrok(): Promise<void> {
    const grokPage = await this.ctx.newPage()

    // Cho session propagate truoc khi navigate
    await grokPage.waitForTimeout(3000)

    await grokPage.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded' })
    await grokPage.waitForLoadState('networkidle', { timeout: 30000 })

    // Poll toi da 45s (session sync co the mat vai giay)
    const maxWait  = 45000
    const interval = 5000
    let elapsed    = 0
    let isLoggedIn = false

    while (elapsed < maxWait) {
      isLoggedIn = await this.checkGrokLogin(grokPage)
      if (isLoggedIn) break

      this.log('info', `Cho session grok sync... ${elapsed / 1000}s`)
      await grokPage.waitForTimeout(interval)
      elapsed += interval

      // Reload de check lai
      if (elapsed < maxWait) {
        await grokPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
        await grokPage.waitForTimeout(1000)
      }
    }

    if (!isLoggedIn) {
      throw new Error('Dang nhap Grok that bai sau sign up — co the sign up that bai tren trang xAI')
    }

    // Dong tab sign-up, giu tab grok
    await this.signupPage?.close()
    this.signupPage = null
    this.log('info', 'Tab grok.com/imagine san sang nhan job')
  }

  private async checkGrokLogin(page: Page): Promise<boolean> {
    try {
      const avatar   = await page.$('[data-sidebar="sidebar"] button[aria-haspopup="menu"]')
      if (avatar) return true
      const initials = await page.$('[data-sidebar="sidebar"] span.bg-surface-l4')
      if (initials) return true
      return false
    } catch {
      return false
    }
  }

  // ---- Helpers --------------------------------------------------------------
  private emit(type: string, payload: Record<string, any>) {
    this.onEvent(type as any, { ...payload, profileId: this.profileId } as any)
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    const ts     = new Date().toLocaleTimeString()
    const prefix = level === 'error' ? 'ERR' : level === 'warn' ? 'WRN' : 'INF'
    console.log(`[${ts}][${this.profileId}][${prefix}] ${message}`)
    this.onEvent('log' as any, { level, message, timestamp: ts } as any)
  }
}