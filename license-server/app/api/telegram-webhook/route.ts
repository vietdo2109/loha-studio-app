/**
 * Telegram webhook — /start, /key (có models), /addmodels.
 * Deploy Vercel; `npm run set-webhook` → BASE_URL/api/telegram-webhook
 */

import { NextRequest, NextResponse } from 'next/server'
import { createLicenseKeys } from '@/lib/createKey'
import { mergeLicenseFeaturesByPhone } from '@/lib/mergeLicenseFeaturesByPhone'
import { formatModelsLine, parseDefaultModelsFromEnv, parseModelTokens } from '@/lib/telegramModels'
import { normalizePhoneTag } from '@/lib/license'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n) && n > 0)

function isAllowed(userId: number): boolean {
  if (ALLOWED_IDS.length === 0) return true
  return ALLOWED_IDS.includes(userId)
}

function formatExpiry(ms: number): string {
  return new Date(ms).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

async function sendTelegram(chatId: number, text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<void> {
  if (!BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  })
}

async function handleUpdate(update: any): Promise<void> {
  const msg = update?.message
  if (!msg?.chat?.id || !msg?.text) return

  const chatId = msg.chat.id
  const userId = msg.from?.id
  const text = msg.text.trim()

  if (userId !== undefined && !isAllowed(userId)) {
    await sendTelegram(chatId, '⛔ Bạn không có quyền sử dụng bot này.')
    return
  }

  if (text === '/start') {
    const def = parseDefaultModelsFromEnv()
    const help =
      `Chào! Tôi giúp tạo key kích hoạt.\n\n` +
      `*Tạo key mới:*\n` +
      `\`/key <SĐT> <số ngày> [veo] [grok] [sora]\`\n\n` +
      `*Mở thêm model* cho key đã có (theo SĐT):\n` +
      `\`/addmodels <SĐT> veo grok sora\`\n\n` +
      `Nếu không ghi models khi tạo key → mặc định: \`${formatModelsLine(def)}\` (\`DEFAULT_MODELS\`)\n\n` +
      `*Ví dụ:*\n` +
      `\`/key 0399692275 30\`\n` +
      `\`/key 0912345678 7 veo grok sora\`\n` +
      `\`/addmodels 0912345678 sora\`\n\n` +
      `SĐT: 6–15 chữ số · Ngày: 1–3650`
    await sendTelegram(chatId, help)
    return
  }

  const addMatch = text.match(/^\/addmodels\s+(\S+)\s+(.+)$/s)
  if (addMatch) {
    const phoneNorm = normalizePhoneTag(addMatch[1] ?? '')
    if (phoneNorm.length < 6 || phoneNorm.length > 15) {
      await sendTelegram(chatId, '❌ Số điện thoại phải từ 6–15 chữ số.')
      return
    }
    const tokens = (addMatch[2] ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const result = await mergeLicenseFeaturesByPhone(phoneNorm, tokens)
    if (!result.ok) {
      if (result.reason === 'NO_MODELS') {
        await sendTelegram(chatId, '❌ Ghi ít nhất một model: `veo`, `grok`, `sora`')
        return
      }
      if (result.reason === 'LICENSE_NOT_FOUND') {
        await sendTelegram(chatId, '❌ Không tìm thấy license với SĐT này.')
        return
      }
      await sendTelegram(chatId, '❌ Số điện thoại không hợp lệ.')
      return
    }
    const L = result.license
    const revNote = L.revoked ? '\n⚠️ License đang **revoked**.' : ''
    const reply =
      `✅ **Đã bật thêm model**\n\n` +
      `📱 SĐT: \`${phoneNorm}\`\n` +
      `🎛 Hiện tại: **${formatModelsLine(L)}**${revNote}`
    await sendTelegram(chatId, reply)
    return
  }

  if (text.match(/^\/addmodels\s*$/)) {
    await sendTelegram(
      chatId,
      'Cú pháp: /addmodels <SĐT> <veo|grok|sora...>\nVí dụ: /addmodels 0912345678 sora'
    )
    return
  }

  if (text.match(/^\/addmodels\s+\S+\s*$/)) {
    await sendTelegram(chatId, '❌ Thiếu model. Ví dụ: /addmodels 0912345678 sora')
    return
  }

  const keyMatch = text.match(/^\/key\s+(\S+)\s+(\d+)(?:\s+(.+))?$/s)
  if (keyMatch) {
    const phone = keyMatch[1] ?? ''
    const days = parseInt(keyMatch[2] ?? '0', 10)
    const modelsRest = (keyMatch[3] ?? '').trim()
    const phoneNorm = normalizePhoneTag(phone)
    if (phoneNorm.length < 6 || phoneNorm.length > 15) {
      await sendTelegram(chatId, '❌ Số điện thoại phải từ 6–15 chữ số.')
      return
    }
    if (days < 1 || days > 3650) {
      await sendTelegram(chatId, '❌ Số ngày phải từ 1–3650.')
      return
    }

    let features = parseDefaultModelsFromEnv()
    if (modelsRest.length > 0) {
      const tokens = modelsRest.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      features = parseModelTokens(tokens)
    }
    if (!features.veoActive && !features.grokActive && !features.soraActive) {
      await sendTelegram(
        chatId,
        '❌ Phải bật ít nhất một model hoặc sửa `DEFAULT_MODELS` trên Vercel.'
      )
      return
    }

    await sendTelegram(
      chatId,
      `⏳ Đang tạo key cho ${phoneNorm} (${days} ngày) — ${formatModelsLine(features)}...`
    )

    try {
      const generated = await createLicenseKeys({
        phoneTag: phoneNorm,
        count: 1,
        durationDays: days,
        role: 'user',
        createdBy: 'telegram-bot',
        veoActive: features.veoActive,
        grokActive: features.grokActive,
        soraActive: features.soraActive,
      })
      if (generated.length === 0) {
        await sendTelegram(chatId, '❌ Không tạo được key.')
        return
      }
      const { key, expiresAt } = generated[0]
      const expires = formatExpiry(expiresAt)
      const reply =
        `✅ **Key đã tạo:**\n\n` +
        `\`\`\`\n${key}\n\`\`\`\n\n` +
        `📱 SĐT: ${phoneNorm}\n` +
        `📅 Hết hạn: ${expires}\n` +
        `🎛 Models: **${formatModelsLine(features)}**`
      await sendTelegram(chatId, reply)
    } catch (e: any) {
      const err = e?.message || String(e)
      await sendTelegram(chatId, `❌ Lỗi: ${err}`)
    }
    return
  }

  if (text === '/key' || text.match(/^\/key\s*$/)) {
    await sendTelegram(
      chatId,
      'Cú pháp: /key <SĐT> <số ngày> [veo] [grok] [sora]\nVí dụ: /key 0399692275 30 veo grok'
    )
    return
  }
}

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ ok: false, reason: 'Bot not configured' }, { status: 503 })
  }
  try {
    const update = await req.json()
    await handleUpdate(update)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[telegram-webhook]', e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'telegram-webhook',
    configured: !!BOT_TOKEN,
  })
}
