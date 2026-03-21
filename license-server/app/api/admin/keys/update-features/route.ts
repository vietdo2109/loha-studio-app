import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { requireAdminKey } from '@/lib/license'

/** PATCH body: { id, grokActive?, veoActive?, soraActive? } — only provided booleans are updated */
export async function POST(req: NextRequest) {
  await ensureSchema()
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '').trim()
  if (!id) return NextResponse.json({ ok: false, reason: 'MISSING_ID' }, { status: 400 })

  const hasGrok = typeof body?.grokActive === 'boolean'
  const hasVeo = typeof body?.veoActive === 'boolean'
  const hasSora = typeof body?.soraActive === 'boolean'
  if (!hasGrok && !hasVeo && !hasSora) {
    return NextResponse.json({ ok: false, reason: 'NO_FIELDS' }, { status: 400 })
  }

  if (hasGrok) {
    await sql`UPDATE licenses SET grok_active = ${Boolean(body.grokActive)} WHERE id = ${id};`
  }
  if (hasVeo) {
    await sql`UPDATE licenses SET veo_active = ${Boolean(body.veoActive)} WHERE id = ${id};`
  }
  if (hasSora) {
    await sql`UPDATE licenses SET sora_active = ${Boolean(body.soraActive)} WHERE id = ${id};`
  }

  const row = await sql`
    SELECT id, grok_active, veo_active, sora_active FROM licenses WHERE id = ${id} LIMIT 1;
  `
  if (row.rowCount !== 1) return NextResponse.json({ ok: false, reason: 'NOT_FOUND' }, { status: 404 })

  const r = row.rows[0] as any
  return NextResponse.json({
    ok: true,
    license: {
      id: r.id as string,
      grokActive: Boolean(r.grok_active),
      veoActive: Boolean(r.veo_active),
      soraActive: Boolean(r.sora_active),
    },
  })
}
