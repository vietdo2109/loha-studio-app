import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { nowMs } from '@/lib/license'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const deviceId = (req.headers.get('x-device-id') || '').trim()
  if (!token) return NextResponse.json({ ok: false, reason: 'MISSING_TOKEN' }, { status: 401 })

  const found = await sql`
    SELECT id, role, expires_at, revoked, bound_device_id
    FROM licenses
    WHERE activation_token = ${token}
    LIMIT 1;
  `
  if (found.rowCount !== 1) return NextResponse.json({ ok: false, active: false, reason: 'TOKEN_NOT_FOUND' }, { status: 401 })

  const row = found.rows[0] as any
  const now = nowMs()
  if (row.revoked) return NextResponse.json({ ok: true, active: false, reason: 'REVOKED' })
  if (Number(row.expires_at) <= now) return NextResponse.json({ ok: true, active: false, reason: 'EXPIRED' })
  if (deviceId && row.bound_device_id && row.bound_device_id !== deviceId) {
    return NextResponse.json({ ok: true, active: false, reason: 'DEVICE_MISMATCH' })
  }

  await sql`UPDATE licenses SET last_seen_at = ${now} WHERE id = ${row.id};`

  return NextResponse.json({
    ok: true,
    active: true,
    license: {
      id: row.id as string,
      role: (row.role || 'user') as 'user' | 'admin',
      expiresAt: Number(row.expires_at),
    },
  })
}
