/**
 * FLOW AUTOMATION - MailTmClient
 * File: src/automation/MailTmClient.ts
 *
 * Wrapper cho mail.tm free API - tao mailbox va doc email qua HTTP thuan.
 * Khong can mo browser tab, khong bi rate limit nhu temp-mail.org.
 *
 * API docs: https://api.mail.tm
 *
 * Flow:
 *   1. GET  /domains       - lay domain kha dung (vd: "@dcctb.com")
 *   2. POST /accounts      - tao mailbox voi email + password
 *   3. POST /token         - lay JWT token
 *   4. GET  /messages      - poll inbox cho den khi co email tu xAI
 *   5. GET  /messages/{id} - doc noi dung, extract code
 */

// ---- Types ------------------------------------------------------------------

interface MailTmDomain {
  id:        string
  domain:    string
  isActive:  boolean
  isPrivate: boolean
}

interface MailTmAccount {
  id:         string
  address:    string
  isDisabled: boolean
  isDeleted:  boolean
}

interface MailTmMessage {
  id:        string
  from:      { address: string; name: string }
  to:        { address: string; name: string }[]
  subject:   string
  intro:     string
  seen:      boolean
  createdAt: string
}

interface MailTmMessageDetail extends MailTmMessage {
  text: string
  html: string[]
}

// ---- MailTmClient -----------------------------------------------------------

const BASE_URL = 'https://api.mail.tm'

export interface MailTmMailbox {
  email:    string
  password: string
  token?:   string
}

export class MailTmClient {
  private mailbox: MailTmMailbox
  private token:   string | null = null

  constructor(mailbox: MailTmMailbox) {
    this.mailbox = mailbox
    this.token   = mailbox.token ?? null
  }

  // ---- Static: tao mailbox moi ----------------------------------------------
  static async createMailbox(): Promise<MailTmMailbox> {
    // Lay domain kha dung
    // API co the tra ve array hoac { hydra:member: [] } tuy phien ban
    const raw = await MailTmClient.fetchJson<any>('GET', '/domains?page=1')
    const list: MailTmDomain[] = Array.isArray(raw)
      ? raw
      : (raw['hydra:member'] ?? raw['member'] ?? [])

    if (!list || list.length === 0) {
      throw new Error(`mail.tm: khong co domain. Raw response: ${JSON.stringify(raw).slice(0, 200)}`)
    }

    const activeDomains = list.filter(
      (d: MailTmDomain) => d.isActive && !d.isPrivate
    )
    if (activeDomains.length === 0) {
      throw new Error('mail.tm: khong co domain kha dung')
    }

    const domain   = activeDomains[0].domain
    const username = MailTmClient.randomUsername()
    const email    = `${username}@${domain}`
    const password = MailTmClient.randomPassword()

    // Tao account
    await MailTmClient.fetchJson<MailTmAccount>(
      'POST', '/accounts',
      { address: email, password }
    )

    return { email, password }
  }

  // ---- Lay JWT token --------------------------------------------------------
  async authenticate(): Promise<string> {
    const res = await MailTmClient.fetchJson<{ token: string }>(
      'POST', '/token',
      { address: this.mailbox.email, password: this.mailbox.password }
    )
    this.token = res.token
    return res.token
  }

  // ---- Poll inbox cho den khi co email xAI ----------------------------------
  async waitForXaiCode(timeoutMs = 2 * 60 * 1000): Promise<string> {
    if (!this.token) await this.authenticate()

    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      await MailTmClient.sleep(4000)

      const rawMsg = await this.fetchWithAuth<any>('GET', '/messages?page=1')
      const list: MailTmMessage[] = Array.isArray(rawMsg)
        ? rawMsg
        : (rawMsg['hydra:member'] ?? rawMsg['member'] ?? [])

      // Tim email tu xAI
      const xaiMail = list.find((m: MailTmMessage) =>
        m.from.address.includes('x.ai') ||
        m.from.address.includes('xai')  ||
        m.subject.toLowerCase().includes('confirmation') ||
        m.subject.toLowerCase().includes('validate') ||
        m.subject.toLowerCase().includes('verify')
      )

      if (!xaiMail) continue

      // Doc noi dung day du
      const detail = await this.fetchWithAuth<MailTmMessageDetail>(
        'GET', `/messages/${xaiMail.id}`
      )

      const rawText = detail.text ?? (detail.html ?? []).join(' ')
      const code    = MailTmClient.extractXaiCode(rawText)

      if (code) return code

      console.log('[mail.tm] Email found but no code extracted, retrying...')
    }

    throw new Error('TIMEOUT: Khong nhan duoc xAI code sau 2 phut')
  }

  // ---- Extract xAI verification code ----------------------------------------
  // Format chinh: "XOY-OXL" (3 uppercase alphanumeric - 3 uppercase alphanumeric)
  static extractXaiCode(text: string): string | null {
    const main = text.match(/\b([A-Z0-9]{3}-[A-Z0-9]{3})\b/)
    if (main) return main[1]

    // Fallback: 6 ki tu lien (neu format thay doi)
    const sixChars = text.match(/\b([A-Z0-9]{6})\b/)
    if (sixChars) return sixChars[1]

    return null
  }

  // ---- HTTP helpers ---------------------------------------------------------

  private async fetchWithAuth<T>(method: string, path: string, body?: object): Promise<T> {
    if (!this.token) await this.authenticate()
    return MailTmClient.fetchJson<T>(method, path, body, this.token!)
  }

  static async fetchJson<T>(
    method:  string,
    path:    string,
    body?:   object,
    token?:  string
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`mail.tm API ${res.status}: ${errText.slice(0, 300)}`)
    }

    return res.json() as Promise<T>
  }

  // ---- Utils ----------------------------------------------------------------

  static randomUsername(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const len   = 8 + Math.floor(Math.random() * 5)
    return Array.from({ length: len }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('')
  }

  static randomPassword(): string {
    return `Tmp${Math.random().toString(36).slice(2, 10)}!`
  }

  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}