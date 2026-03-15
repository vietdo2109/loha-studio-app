import crypto from 'crypto'

export type LicenseRole = 'user' | 'admin'

export function nowMs(): number {
  return Date.now()
}

export function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex')
}

export function normalizePhoneTag(input: string): string {
  return String(input || '').replace(/\D+/g, '')
}

export function makeRawKey(phoneTag?: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const block = () => Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  const normalized = normalizePhoneTag(phoneTag || '')
  if (normalized.length >= 6 && normalized.length <= 15) {
    return `LOHA-${normalized}-${block()}-${block()}`
  }
  return `LOHA-${block()}-${block()}-${block()}`
}

export function previewKey(rawKey: string): string {
  const k = rawKey.trim()
  if (k.length <= 8) return k
  return `${k.slice(0, 6)}...${k.slice(-4)}`
}

export function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function requireAdminKey(input: string | null): boolean {
  const expected = process.env.ADMIN_API_KEY
  if (!expected) return false
  return input === expected
}
