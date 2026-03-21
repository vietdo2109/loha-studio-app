#!/usr/bin/env node
/**
 * Đặt webhook Telegram = BASE_URL + /api/telegram-webhook (giống bản chạy ổn trước đây).
 *
 *   npm run set-webhook
 *
 * Biến: TELEGRAM_BOT_TOKEN (bắt buộc), BASE_URL (mặc định https://lohastudioadmin.vercel.app)
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
const baseUrl = (process.env.BASE_URL || 'https://lohastudioadmin.vercel.app').replace(/\/+$/, '')
const webhookUrl = `${baseUrl}/api/telegram-webhook`

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required')
  process.exit(1)
}

fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`)
  .then((r) => r.json())
  .then((data) => {
    if (data.ok) {
      console.log('Webhook set:', webhookUrl)
    } else {
      console.error('Failed:', data)
      process.exit(1)
    }
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
