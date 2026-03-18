/**
 * Shared logic for creating license keys.
 * Used by admin API and Telegram webhook.
 */

import crypto from 'crypto'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { hashKey, makeRawKey, normalizePhoneTag, nowMs, previewKey } from '@/lib/license'

export interface CreateKeyOptions {
  phoneTag: string
  count?: number
  durationDays?: number
  role?: 'user' | 'admin'
  createdBy?: string
  note?: string
}

export interface CreatedKey {
  id: string
  key: string
  role: 'user' | 'admin'
  expiresAt: number
}

export async function createLicenseKeys(opts: CreateKeyOptions): Promise<CreatedKey[]> {
  await ensureSchema()
  const phoneNorm = normalizePhoneTag(opts.phoneTag)
  if (phoneNorm.length < 6 || phoneNorm.length > 15) {
    throw new Error('PHONE_TAG_INVALID')
  }
  const count = Math.min(Math.max(1, opts.count ?? 1), 100)
  const durationDays = Math.min(Math.max(1, opts.durationDays ?? 2), 3650)
  const role = opts.role === 'admin' ? 'admin' : 'user'
  const createdBy = opts.createdBy ?? 'admin'
  const note = opts.note ?? ''
  const now = nowMs()
  const expiresAt = now + durationDays * 24 * 60 * 60 * 1000

  const generated: CreatedKey[] = []
  for (let i = 0; i < count; i++) {
    const key = makeRawKey(phoneNorm)
    const keyHash = hashKey(key)
    const id = crypto.randomUUID()
    await sql`
      INSERT INTO licenses (id, key_hash, key_preview, key_phone_tag, role, expires_at, revoked, created_at, created_by, note)
      VALUES (${id}, ${keyHash}, ${previewKey(key)}, ${phoneNorm}, ${role}, ${expiresAt}, FALSE, ${now}, ${createdBy}, ${note});
    `
    generated.push({ id, key, role, expiresAt })
  }
  return generated
}
