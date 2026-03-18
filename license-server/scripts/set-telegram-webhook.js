#!/usr/bin/env node
/**
 * Set Telegram webhook URL. Run once after deploy.
 * Usage: TELEGRAM_BOT_TOKEN=xxx node scripts/set-telegram-webhook.js
 * Or: TELEGRAM_BOT_TOKEN=xxx BASE_URL=https://lohastudioadmin.vercel.app node scripts/set-telegram-webhook.js
 */

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
