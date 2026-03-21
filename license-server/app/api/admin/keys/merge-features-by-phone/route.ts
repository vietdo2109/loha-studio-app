import { NextRequest, NextResponse } from 'next/server'
import { mergeLicenseFeaturesByPhone } from '@/lib/mergeLicenseFeaturesByPhone'
import { requireAdminKey } from '@/lib/license'

/**
 * POST body: { phoneTag: string, enable: ("veo"|"grok"|"sora")[] }
 * Bật thêm model (OR) — không tắt model đang bật.
 */
export async function POST(req: NextRequest) {
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const phoneRaw = String(body?.phoneTag || '')

  const rawEnable = body?.enable
  const list: string[] = Array.isArray(rawEnable)
    ? rawEnable.map((s: unknown) => String(s).toLowerCase().trim()).filter(Boolean)
    : typeof rawEnable === 'string'
      ? String(rawEnable)
          .split(/[,\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []

  const result = await mergeLicenseFeaturesByPhone(phoneRaw, list)
  if (!result.ok) {
    const status =
      result.reason === 'PHONE_TAG_INVALID' ? 400 : result.reason === 'NO_MODELS' ? 400 : 404
    return NextResponse.json({ ok: false, reason: result.reason }, { status })
  }

  return NextResponse.json({ ok: true, license: result.license })
}
