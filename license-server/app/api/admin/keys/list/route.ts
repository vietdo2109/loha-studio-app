import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { requireAdminKey } from '@/lib/license'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1))
  const pageSizeRaw = Number(req.nextUrl.searchParams.get('pageSize') || 20)
  const pageSize = Math.min(100, Math.max(5, pageSizeRaw))
  const offset = (page - 1) * pageSize
  const like = `%${q}%`

  const countRes = q
    ? await sql`
        SELECT COUNT(*)::int AS total
        FROM licenses
        WHERE key_preview ILIKE ${like}
           OR COALESCE(key_phone_tag, '') ILIKE ${like}
           OR COALESCE(note, '') ILIKE ${like};
      `
    : await sql`SELECT COUNT(*)::int AS total FROM licenses;`
  const total = Number((countRes.rows[0] as any)?.total || 0)

  const rows = q
    ? await sql`
        SELECT id, key_preview, key_phone_tag, role, expires_at, revoked, created_at, created_by, note, bound_device_id, activated_at, last_seen_at,
               grok_active, veo_active, sora_active
        FROM licenses
        WHERE key_preview ILIKE ${like}
           OR COALESCE(key_phone_tag, '') ILIKE ${like}
           OR COALESCE(note, '') ILIKE ${like}
        ORDER BY created_at DESC
        LIMIT ${pageSize}
        OFFSET ${offset};
      `
    : await sql`
        SELECT id, key_preview, key_phone_tag, role, expires_at, revoked, created_at, created_by, note, bound_device_id, activated_at, last_seen_at,
               grok_active, veo_active, sora_active
        FROM licenses
        ORDER BY created_at DESC
        LIMIT ${pageSize}
        OFFSET ${offset};
      `
  return NextResponse.json({ ok: true, items: rows.rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
}
