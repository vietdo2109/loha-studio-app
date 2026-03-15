import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { hashKey, nowMs, randomToken } from '@/lib/license'

export async function POST(req: NextRequest) {
  await ensureSchema()
  const body = await req.json().catch(() => ({} as any))
  const key = String(body?.key || '').trim()
  const deviceId = String(body?.deviceId || '').trim()
  if (!key || !deviceId) {
    return NextResponse.json({ ok: false, reason: 'INVALID_INPUT' }, { status: 400 })
  }

  const keyHash = hashKey(key)
  const found = await sql`
    SELECT id, role, expires_at, revoked, bound_device_id, activated_at
    FROM licenses
    WHERE key_hash = ${keyHash}
    LIMIT 1;
  `
  if (found.rowCount !== 1) {
    return NextResponse.json({ ok: false, reason: 'KEY_NOT_FOUND' }, { status: 404 })
  }
  const row = found.rows[0] as any
  const now = nowMs()
  if (row.revoked) return NextResponse.json({ ok: false, reason: 'KEY_REVOKED' }, { status: 403 })
  if (Number(row.expires_at) <= now) return NextResponse.json({ ok: false, reason: 'KEY_EXPIRED' }, { status: 403 })

  if (row.bound_device_id && row.bound_device_id !== deviceId) {
    return NextResponse.json({ ok: false, reason: 'ALREADY_USED_OTHER_DEVICE' }, { status: 403 })
  }

  const token = randomToken()
  await sql`
    UPDATE licenses
    SET bound_device_id = COALESCE(bound_device_id, ${deviceId}),
        activated_at = COALESCE(activated_at, ${now}),
        activation_token = ${token},
        last_seen_at = ${now}
    WHERE id = ${row.id};
  `

  return NextResponse.json({
    ok: true,
    token,
    license: {
      id: row.id as string,
      role: (row.role || 'user') as 'user' | 'admin',
      expiresAt: Number(row.expires_at),
    },
  })
}
