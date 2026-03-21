import { NextRequest, NextResponse } from 'next/server'
import { createLicenseKeys } from '@/lib/createKey'
import { requireAdminKey } from '@/lib/license'

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get('x-admin-key')
  if (!requireAdminKey(adminKey)) return NextResponse.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const count = Math.min(Math.max(1, Number(body?.count ?? 1)), 100)
  const durationDays = Math.min(Math.max(1, Number(body?.durationDays ?? 2)), 3650)
  const role = String(body?.role || 'user') === 'admin' ? 'admin' : 'user'
  const note = String(body?.note || '')
  const phoneTag = String(body?.phoneTag || '')
  const createdBy = String(body?.createdBy || 'admin')
  const grokActive = typeof body?.grokActive === 'boolean' ? body.grokActive : true
  const veoActive = typeof body?.veoActive === 'boolean' ? body.veoActive : true
  const soraActive = typeof body?.soraActive === 'boolean' ? body.soraActive : false

  try {
    const generated = await createLicenseKeys({
      phoneTag,
      count,
      durationDays,
      role,
      createdBy,
      note,
      grokActive,
      veoActive,
      soraActive,
    })
    return NextResponse.json({ ok: true, generated })
  } catch (e: any) {
    const msg = e?.message || String(e)
    if (msg === 'PHONE_TAG_INVALID') {
      return NextResponse.json({ ok: false, reason: 'PHONE_TAG_INVALID' }, { status: 400 })
    }
    throw e
  }
}
