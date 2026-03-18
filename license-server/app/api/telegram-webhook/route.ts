/**
 * Telegram webhook endpoint.
 * Receives updates from Telegram and handles /key command for sales.
 * Deploy on Vercel alongside the license server.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createLicenseKeys } from '@/lib/createKey'
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

  // /start
  if (text === '/start') {
    const help =
      `Chào! Tôi giúp tạo key kích hoạt.\n\n` +
      `Cú pháp:\n` +
      `\`/key <số điện thoại> <số ngày>\`\n\n` +
      `Ví dụ:\n` +
      `\`/key 0399692275 30\`\n` +
      `\`/key 0912345678 7\`\n\n` +
      `Số điện thoại: 6–15 chữ số (không dấu gạch/cách)\n` +
      `Số ngày: 1–3650`
    await sendTelegram(chatId, help)
    return
  }

  // /key <phone> <days>
  const keyMatch = text.match(/^\/key\s+(\S+)\s+(\d+)$/)
  if (keyMatch) {
    const phone = keyMatch[1]
    const days = parseInt(keyMatch[2], 10)
    const phoneNorm = normalizePhoneTag(phone)
    if (phoneNorm.length < 6 || phoneNorm.length > 15) {
      await sendTelegram(chatId, '❌ Số điện thoại phải từ 6–15 chữ số.')
      return
    }
    if (days < 1 || days > 3650) {
      await sendTelegram(chatId, '❌ Số ngày phải từ 1–3650.')
      return
    }

    await sendTelegram(chatId, `⏳ Đang tạo key cho ${phoneNorm} (${days} ngày)...`)

    try {
      const generated = await createLicenseKeys({
        phoneTag: phoneNorm,
        count: 1,
        durationDays: days,
        role: 'user',
        createdBy: 'telegram-bot',
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
        `📅 Hết hạn: ${expires}`
      await sendTelegram(chatId, reply)
    } catch (e: any) {
      const err = e?.message || String(e)
      await sendTelegram(chatId, `❌ Lỗi: ${err}`)
    }
    return
  }

  // /key without args
  if (text === '/key' || text.match(/^\/key\s*$/)) {
    await sendTelegram(chatId, 'Cú pháp: /key <số điện thoại> <số ngày>\nVí dụ: /key 0399692275 30')
    return
  }
}

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ ok: false, reason: 'Bot not configured' }, { status: 503 })
  }
  try {
    const update = await req.json()
    // Return 200 immediately; Telegram expects fast response
    await handleUpdate(update)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[telegram-webhook]', e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// GET for health check / webhook verification
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'telegram-webhook',
    configured: !!BOT_TOKEN,
  })
}
