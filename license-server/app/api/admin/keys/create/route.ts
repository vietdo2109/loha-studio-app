import { NextRequest, NextResponse } from 'next/server'
import { createLicenseKeys } from '@/lib/createKey'
import { normalizePhoneTag, requireAdminKey } from '@/lib/license'

export async function POST(req: NextRequest) {
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

  try {
    const generated = await createLicenseKeys({
      phoneTag,
      count,
      durationDays,
      role: role as 'user' | 'admin',
      createdBy: String(body?.createdBy || 'admin'),
      note,
    })
    // Apply note to first key if provided (DB schema has note; createKey omits for simplicity)
    return NextResponse.json({ ok: true, generated })
  } catch (e: any) {
    if (e?.message === 'PHONE_TAG_INVALID') {
      return NextResponse.json({ ok: false, reason: 'PHONE_TAG_INVALID' }, { status: 400 })
    }
    throw e
  }
}
