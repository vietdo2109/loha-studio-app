/**
 * Xóa webhook Telegram → bot có thể nhận update lại qua getUpdates (polling).
 * Chạy sau khi lỡ set-webhook sai URL hoặc muốn chạy telegram-key-bot ở chế độ polling.
 *
 *   npm run delete-webhook
 */

const fs = require('fs')
const path = require('path')

function loadEnvFile(name) {
  const p = path.join(__dirname, '..', name)
  if (!fs.existsSync(p)) return
  const raw = fs.readFileSync(p, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('Thiếu TELEGRAM_BOT_TOKEN')
  process.exit(1)
}

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: false }),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.ok) {
    console.error('deleteWebhook thất bại:', data)
    process.exit(1)
  }
  console.log('OK — đã xóa webhook. Bot chạy polling (getUpdates) sẽ hoạt động lại sau khi restart process bot.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
