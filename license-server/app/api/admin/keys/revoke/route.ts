import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { requireAdminKey } from '@/lib/license'

export async function POST(req: NextRequest) {
  await ensureSchema()
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '').trim()
  if (!id) return NextResponse.json({ ok: false, reason: 'MISSING_ID' }, { status: 400 })

  await sql`UPDATE licenses SET revoked = TRUE WHERE id = ${id};`
  return NextResponse.json({ ok: true })
}
