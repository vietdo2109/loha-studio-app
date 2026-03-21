import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import crypto from 'crypto'
import { ensureSchema } from '@/lib/db'
import { hashKey, makeRawKey, normalizePhoneTag, nowMs, previewKey, requireAdminKey } from '@/lib/license'

export async function POST(req: NextRequest) {
  await ensureSchema()
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const count = Math.min(Math.max(1, Number(body?.count ?? 1)), 100)
  const durationDays = Math.min(Math.max(1, Number(body?.durationDays ?? 2)), 3650)
  const role = String(body?.role || 'user') === 'admin' ? 'admin' : 'user'
  const note = String(body?.note || '')
  const phoneTag = normalizePhoneTag(body?.phoneTag || '')
  if (phoneTag.length < 6 || phoneTag.length > 15) {
    return NextResponse.json({ ok: false, reason: 'PHONE_TAG_INVALID' }, { status: 400 })
  }
  const now = nowMs()
  const expiresAt = now + durationDays * 24 * 60 * 60 * 1000
  const createdBy = String(body?.createdBy || 'admin')
  /** Defaults: Veo + Grok on, Sora off (admin can override per key) */
  const grokActive = typeof body?.grokActive === 'boolean' ? body.grokActive : true
  const veoActive = typeof body?.veoActive === 'boolean' ? body.veoActive : true
  const soraActive = typeof body?.soraActive === 'boolean' ? body.soraActive : false

  const generated: Array<{ id: string; key: string; role: 'user' | 'admin'; expiresAt: number }> = []
  for (let i = 0; i < count; i++) {
    const key = makeRawKey(phoneTag)
    const keyHash = hashKey(key)
    const id = crypto.randomUUID()
    await sql`
      INSERT INTO licenses (
        id, key_hash, key_preview, key_phone_tag, role, expires_at, revoked, created_at, created_by, note,
        grok_active, veo_active, sora_active
      )
      VALUES (
        ${id}, ${keyHash}, ${previewKey(key)}, ${phoneTag}, ${role}, ${expiresAt}, FALSE, ${now}, ${createdBy}, ${note},
        ${grokActive}, ${veoActive}, ${soraActive}
      );
    `
    generated.push({ id, key, role: role as 'user' | 'admin', expiresAt })
  }

  return NextResponse.json({ ok: true, generated })
}
