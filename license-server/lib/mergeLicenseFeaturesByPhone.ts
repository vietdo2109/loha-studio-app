/**
 * Bật thêm model theo SĐT (merge OR). Dùng chung cho admin API và Telegram webhook.
 */

import { sql } from '@vercel/postgres'
import { ensureSchema } from '@/lib/db'
import { normalizePhoneTag } from '@/lib/license'

export type MergedLicense = {
  id: string
  phoneTag: string
  veoActive: boolean
  grokActive: boolean
  soraActive: boolean
  revoked: boolean
}

export type MergeResult =
  | { ok: true; license: MergedLicense }
  | { ok: false; reason: 'PHONE_TAG_INVALID' | 'NO_MODELS' | 'LICENSE_NOT_FOUND' }

/** enable: danh sách token veo, grok, sora (hoặc veo3 → veo) */
export async function mergeLicenseFeaturesByPhone(
  rawPhone: string,
  enableTokens: string[]
): Promise<MergeResult> {
  await ensureSchema()
  const phoneTag = normalizePhoneTag(rawPhone)
  if (phoneTag.length < 6 || phoneTag.length > 15) {
    return { ok: false, reason: 'PHONE_TAG_INVALID' }
  }

  let enableVeo = false
  let enableGrok = false
  let enableSora = false
  for (const t of enableTokens) {
    const n = String(t).toLowerCase().trim()
    if (n === 'veo' || n === 'veo3') enableVeo = true
    else if (n === 'grok') enableGrok = true
    else if (n === 'sora') enableSora = true
  }
  if (!enableVeo && !enableGrok && !enableSora) {
    return { ok: false, reason: 'NO_MODELS' }
  }

  const found = await sql`
    SELECT id, grok_active, veo_active, sora_active, revoked
    FROM licenses
    WHERE key_phone_tag = ${phoneTag}
    ORDER BY revoked ASC, created_at DESC
    LIMIT 1;
  `
  if (found.rowCount !== 1) {
    return { ok: false, reason: 'LICENSE_NOT_FOUND' }
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

  return {
    ok: true,
    license: {
      id,
      phoneTag,
      veoActive,
      grokActive,
      soraActive,
      revoked: Boolean(row.revoked),
    },
  }
}
