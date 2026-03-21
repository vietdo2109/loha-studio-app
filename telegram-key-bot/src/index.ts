/**
 * Telegram bot for sales to generate license keys.
 * Usage: /key <phone> <days> [models...]
 *        /addmodels <phone> <models...> — bật thêm model cho key đã có (theo SĐT)
 * Models: veo, grok, sora (space or comma). If omitted on /key, uses DEFAULT_MODELS env (default: veo,grok).
 */

import TelegramBot from 'node-telegram-bot-api'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ADMIN_API_KEY = process.env.ADMIN_API_KEY
const API_BASE = (process.env.LICENSE_API_BASE_URL || 'https://lohastudioadmin.vercel.app').replace(/\/+$/, '')
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n) && n > 0)

/** Default models when /key không kèm veo/grok/sora — ví dụ DEFAULT_MODELS=veo,grok */
function parseDefaultModelsFromEnv(): { veoActive: boolean; grokActive: boolean; soraActive: boolean } {
  const raw = (process.env.DEFAULT_MODELS ?? 'veo,grok').trim().toLowerCase()
  if (!raw) return { veoActive: true, grokActive: true, soraActive: false }
  const tokens = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  return parseModelTokens(tokens)
}

function parseModelTokens(tokens: string[]): { veoActive: boolean; grokActive: boolean; soraActive: boolean } {
  let veoActive = false
  let grokActive = false
  let soraActive = false
  for (const t of tokens) {
    const n = t.toLowerCase()
    if (n === 'veo' || n === 'veo3') veoActive = true
    else if (n === 'grok') grokActive = true
    else if (n === 'sora') soraActive = true
  }
  return { veoActive, grokActive, soraActive }
}

function formatModelsLine(f: { veoActive: boolean; grokActive: boolean; soraActive: boolean }): string {
  const parts: string[] = []
  if (f.veoActive) parts.push('Veo3')
  if (f.grokActive) parts.push('Grok')
  if (f.soraActive) parts.push('Sora')
  return parts.length ? parts.join(', ') : '(không có — cần bật ít nhất 1 model)'
}

function isAllowed(userId: number): boolean {
  /** Không cấu hình TELEGRAM_ALLOWED_IDS = cho phép mọi user (khớp README; production nên whitelist) */
  if (ALLOWED_IDS.length === 0) return true
  return ALLOWED_IDS.includes(userId)
}

function normalizePhone(input: string): string {
  return String(input || '').replace(/\D+/g, '')
}

async function generateKey(
  phoneTag: string,
  durationDays: number,
  features: { veoActive: boolean; grokActive: boolean; soraActive: boolean }
): Promise<{ key: string; expiresAt: number; features: typeof features } | { error: string }> {
  if (!ADMIN_API_KEY) return { error: 'ADMIN_API_KEY not configured' }
  const url = `${API_BASE}/api/admin/keys/create`
  const body = {
    phoneTag: normalizePhone(phoneTag),
    count: 1,
    durationDays: Math.min(Math.max(1, durationDays), 3650),
    role: 'user',
    createdBy: 'telegram-bot',
    veoActive: features.veoActive,
    grokActive: features.grokActive,
    soraActive: features.soraActive,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_API_KEY,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({} as any))
  if (!res.ok) {
    const reason = data?.reason || res.statusText || 'Unknown error'
    return { error: `API error: ${reason}` }
  }
  if (!data?.ok || !Array.isArray(data?.generated) || data.generated.length === 0) {
    return { error: 'API returned no key' }
  }
  const first = data.generated[0]
  return { key: first.key as string, expiresAt: first.expiresAt as number, features }
}

async function mergeModelsByPhone(
  phoneTag: string,
  enableTokens: string[]
): Promise<
  | { license: { id: string; veoActive: boolean; grokActive: boolean; soraActive: boolean; revoked: boolean } }
  | { error: string }
> {
  if (!ADMIN_API_KEY) return { error: 'ADMIN_API_KEY not configured' }
  const url = `${API_BASE}/api/admin/keys/merge-features-by-phone`
  const body = {
    phoneTag: normalizePhone(phoneTag),
    enable: enableTokens,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_API_KEY,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({} as any))
  if (!res.ok) {
    const reason = data?.reason || res.statusText || 'Unknown error'
    return { error: `API error: ${reason}` }
  }
  if (!data?.ok || !data?.license) {
    return { error: 'API returned no license' }
  }
  return { license: data.license }
}

function formatExpiry(ms: number): string {
  return new Date(ms).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function main() {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is required. Set it in .env')
    process.exit(1)
  }
  if (!ADMIN_API_KEY) {
    console.error('ADMIN_API_KEY is required. Set it in .env')
    process.exit(1)
  }

  const bot = new TelegramBot(BOT_TOKEN, { polling: true })

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id
    const def = parseDefaultModelsFromEnv()
    const help =
      `Chào! Tôi giúp tạo key kích hoạt.\n\n` +
      `*Tạo key mới:*\n` +
      `\`/key <SĐT> <số ngày> [veo] [grok] [sora]\`\n\n` +
      `*Mở thêm model cho key đã có* (theo SĐT, không tắt model đang bật):\n` +
      `\`/addmodels <SĐT> veo grok sora\`\n\n` +
      `*Models* (tuỳ chọn trên /key): gõ tên cách nhau bằng dấu cách hoặc phẩy — chỉ bật đúng model đó.\n` +
      `Nếu *không ghi* models trên /key → dùng mặc định: \`${formatModelsLine(def)}\`\n` +
      `(\`DEFAULT_MODELS\`, mặc định \`veo,grok\`)\n\n` +
      `*Ví dụ:*\n` +
      `\`/key 0399692275 30\` — ${formatModelsLine(def)}\n` +
      `\`/key 0912345678 7 veo grok sora\` — cả 3\n` +
      `\`/addmodels 0912345678 sora\` — bật thêm Sora\n\n` +
      `SĐT: 6–15 chữ số · Ngày: 1–3650`
    bot.sendMessage(chatId, help, { parse_mode: 'Markdown' })
  })

  /** /key phone days [optional model tokens...] */
  bot.onText(/^\/key\s+(\S+)\s+(\d+)(?:\s+(.+))?$/s, async (msg, match) => {
    const chatId = msg.chat.id
    const userId = msg.from?.id
    if (userId !== undefined && !isAllowed(userId)) {
      await bot.sendMessage(chatId, '⛔ Bạn không có quyền sử dụng bot này.')
      return
    }
    const phone = match?.[1] ?? ''
    const days = parseInt(match?.[2] ?? '0', 10)
    const phoneNorm = normalizePhone(phone)
    if (phoneNorm.length < 6 || phoneNorm.length > 15) {
      await bot.sendMessage(chatId, '❌ Số điện thoại phải từ 6–15 chữ số.')
      return
    }
    if (days < 1 || days > 3650) {
      await bot.sendMessage(chatId, '❌ Số ngày phải từ 1–3650.')
      return
    }

    const modelsRest = (match?.[3] ?? '').trim()
    let features = parseDefaultModelsFromEnv()
    if (modelsRest.length > 0) {
      const tokens = modelsRest.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean)
      features = parseModelTokens(tokens)
    }
    if (!features.veoActive && !features.grokActive && !features.soraActive) {
      await bot.sendMessage(
        chatId,
        '❌ Phải bật ít nhất một model: `veo`, `grok`, `sora` (hoặc sửa DEFAULT_MODELS trên server bot).',
        { parse_mode: 'Markdown' }
      )
      return
    }

    await bot.sendMessage(
      chatId,
      `⏳ Đang tạo key cho ${phoneNorm} (${days} ngày) — ${formatModelsLine(features)}...`
    )

    const result = await generateKey(phoneNorm, days, features)
    if ('error' in result) {
      await bot.sendMessage(chatId, `❌ Lỗi: ${result.error}`)
      return
    }

    const expires = formatExpiry(result.expiresAt)
    const text =
      `✅ **Key đã tạo:**\n\n` +
      `\`\`\`\n${result.key}\n\`\`\`\n\n` +
      `📱 SĐT: ${phoneNorm}\n` +
      `📅 Hết hạn: ${expires}\n` +
      `🎛 Models: **${formatModelsLine(result.features)}**`
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  })

  /** /addmodels phone veo grok sora — merge bật thêm model (API merge-features-by-phone) */
  bot.onText(/^\/addmodels\s+(\S+)\s+(.+)$/s, async (msg, match) => {
    const chatId = msg.chat.id
    const userId = msg.from?.id
    if (userId !== undefined && !isAllowed(userId)) {
      await bot.sendMessage(chatId, '⛔ Bạn không có quyền sử dụng bot này.')
      return
    }
    const phone = match?.[1] ?? ''
    const modelsRest = (match?.[2] ?? '').trim()
    const phoneNorm = normalizePhone(phone)
    if (phoneNorm.length < 6 || phoneNorm.length > 15) {
      await bot.sendMessage(chatId, '❌ Số điện thoại phải từ 6–15 chữ số.')
      return
    }
    const tokens = modelsRest.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean)
    const toEnable = parseModelTokens(tokens)
    if (!toEnable.veoActive && !toEnable.grokActive && !toEnable.soraActive) {
      await bot.sendMessage(
        chatId,
        '❌ Ghi ít nhất một model cần *mở thêm*: `veo`, `grok`, `sora`',
        { parse_mode: 'Markdown' }
      )
      return
    }
    const enableList: string[] = []
    if (toEnable.veoActive) enableList.push('veo')
    if (toEnable.grokActive) enableList.push('grok')
    if (toEnable.soraActive) enableList.push('sora')

    await bot.sendMessage(
      chatId,
      `⏳ Đang bật thêm model cho SĐT ${phoneNorm}: ${enableList.join(', ')}...`
    )

    const result = await mergeModelsByPhone(phoneNorm, enableList)
    if ('error' in result) {
      await bot.sendMessage(chatId, `❌ Lỗi: ${result.error}`)
      return
    }
    const L = result.license
    const revNote = L.revoked ? '\n⚠️ License này đang **revoked** (vẫn cập nhật cờ model).' : ''
    const text =
      `✅ **Đã cập nhật models** (bật thêm, giữ nguyên phần đã mở trước đó)\n\n` +
      `📱 SĐT: \`${phoneNorm}\`\n` +
      `🆔 ID: \`${L.id}\`\n` +
      `🎛 Hiện tại: **${formatModelsLine(L)}**${revNote}`
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  })

  bot.onText(/^\/addmodels\s*$/, (msg) => {
    const chatId = msg.chat.id
    bot.sendMessage(
      chatId,
      'Cú pháp: /addmodels <SĐT> <veo|grok|sora...>\nVí dụ: /addmodels 0912345678 sora\nHoặc: /addmodels 0399692275 veo grok',
      { parse_mode: 'Markdown' }
    )
  })

  bot.onText(/^\/addmodels\s+\S+\s*$/, (msg) => {
    const chatId = msg.chat.id
    bot.sendMessage(
      chatId,
      '❌ Thiếu danh sách model. Ví dụ: /addmodels 0912345678 sora',
      { parse_mode: 'Markdown' }
    )
  })

  bot.onText(/\/key\s*$/, (msg) => {
    const chatId = msg.chat.id
    bot.sendMessage(
      chatId,
      'Cú pháp: /key <SĐT> <số ngày> [veo] [grok] [sora]\nVí dụ: /key 0399692275 30\nHoặc: /key 0399692275 30 veo grok sora',
      { parse_mode: 'Markdown' }
    )
  })

  bot.on('message', (msg) => {
    const text = msg.text || ''
    if (text.startsWith('/key') && !text.match(/^\/key\s+\S+\s+\d+/)) {
      return // handled by /key without args or wrong format
    }
    if (text.startsWith('/addmodels') && !text.match(/^\/addmodels\s+\S+\s+\S/)) {
      return
    }
    if (text.startsWith('/')) return
    // Ignore non-command messages
  })

  console.log('Telegram key bot started. Polling...')
}

main()
