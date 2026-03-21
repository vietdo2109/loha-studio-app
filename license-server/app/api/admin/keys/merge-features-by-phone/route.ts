import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { normalizePhoneTag, requireAdminKey } from '@/lib/license'

/**
 * POST body: { phoneTag: string, enable: ("veo"|"grok"|"sora")[] }
 * Bật thêm model (OR) — không tắt model đang bật.
 * Chọn license: cùng key_phone_tag, ưu tiên chưa revoke, mới nhất.
 */
export async function POST(req: NextRequest) {
  await ensureSchema()
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const phoneTag = normalizePhoneTag(String(body?.phoneTag || ''))
  if (phoneTag.length < 6 || phoneTag.length > 15) {
    return NextResponse.json({ ok: false, reason: 'PHONE_TAG_INVALID' }, { status: 400 })
  }

  const rawEnable = body?.enable
  const list: string[] = Array.isArray(rawEnable)
    ? rawEnable.map((s: unknown) => String(s).toLowerCase().trim()).filter(Boolean)
    : typeof rawEnable === 'string'
      ? String(rawEnable)
          .split(/[,\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []

  let enableVeo = false
  let enableGrok = false
  let enableSora = false
  for (const t of list) {
    if (t === 'veo' || t === 'veo3') enableVeo = true
    else if (t === 'grok') enableGrok = true
    else if (t === 'sora') enableSora = true
  }
  if (!enableVeo && !enableGrok && !enableSora) {
    return NextResponse.json({ ok: false, reason: 'NO_MODELS' }, { status: 400 })
  }

  const found = await sql`
    SELECT id, grok_active, veo_active, sora_active, revoked
    FROM licenses
    WHERE key_phone_tag = ${phoneTag}
    ORDER BY revoked ASC, created_at DESC
    LIMIT 1;
  `
  if (found.rowCount !== 1) {
    return NextResponse.json({ ok: false, reason: 'LICENSE_NOT_FOUND' }, { status: 404 })
  }

  const row = found.rows[0] as any
  const id = row.id as string
  const veoActive = Boolean(row.veo_active) || enableVeo
  const grokActive = Boolean(row.grok_active) || enableGrok
  const soraActive = Boolean(row.sora_active) || enableSora

  await sql`
    UPDATE licenses
    SET veo_active = ${veoActive},
        grok_active = ${grokActive},
        sora_active = ${soraActive}
    WHERE id = ${id};
  `

  return NextResponse.json({
    ok: true,
    license: {
      id,
      phoneTag,
      veoActive,
      grokActive,
      soraActive,
      revoked: Boolean(row.revoked),
    },
  })
}
