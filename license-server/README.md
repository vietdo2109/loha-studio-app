# Loha License Server (Next.js + Vercel)

This app provides:
- License activation API for Electron clients
- License status API for periodic re-validation
- Admin web page to create/revoke keys and **toggle per-key AI product access** (`veo_active`, `grok_active`, `sora_active`)

**Legacy keys:** DB migration sets `veo_active` and `grok_active` to **true** by default so existing customers keep access (Veo3 is guaranteed for old rows unless you turn it off in admin).

## 1) Configure

Set env vars:

- `POSTGRES_URL` (Vercel Postgres connection string)
- `ADMIN_API_KEY` (secret used by admin page/API)
- **Telegram bot (optional):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_IDS` (optional), `BASE_URL` (public site URL), `DEFAULT_MODELS` (optional, mặc định `veo,grok` — dùng khi lệnh `/key` không kèm `veo`/`grok`/`sora`). Bot: **`POST /api/telegram-webhook`** — lệnh `/key` (có chọn model), `/addmodels` (bật thêm model theo SĐT).

Sau mỗi lần deploy, trong `license-server`:

```bash
npm run set-webhook
```

Script gọi Telegram `setWebhook` với URL `BASE_URL/api/telegram-webhook` (đọc `.env.local`).

Copy `.env.example` to `.env.local` in local dev.

## 2) Run local

```bash
cd license-server
npm install
npm run dev
```

Open:
- `http://localhost:3000/admin` to manage keys

## 3) API contracts

### `POST /api/license/activate`

Body:
```json
{
  "key": "LOHA-XXXXX-XXXXX-XXXXX",
  "deviceId": "device-hash",
  "appVersion": "0.1.0"
}
```

Success:
```json
{
  "ok": true,
  "token": "session-token",
  "license": {
    "id": "uuid",
    "role": "user",
    "expiresAt": 1770000000000,
    "veoActive": true,
    "grokActive": true,
    "soraActive": false
  }
}
```

### `GET /api/license/status`

Headers:
- `Authorization: Bearer <token>`
- `x-device-id: <device-id>`

Success:
```json
{
  "ok": true,
  "active": true,
  "license": {
    "id": "uuid",
    "role": "user",
    "expiresAt": 1770000000000,
    "veoActive": true,
    "grokActive": true,
    "soraActive": false
  }
}
```

### `POST /api/admin/keys/update-features`

Admin-only. Body: `{ "id": "<license uuid>", "veoActive"?: boolean, "grokActive"?: boolean, "soraActive"?: boolean }` — only include fields you want to change.

### `POST /api/admin/keys/merge-features-by-phone`

Admin-only. Bật **thêm** model cho license gắn SĐT (không tắt model đang mở). Chọn bản ghi mới nhất, ưu tiên chưa `revoked`.

Body:
```json
{
  "phoneTag": "0912345678",
  "enable": ["veo", "sora"]
}
```

`enable` có thể là mảng hoặc chuỗi `"veo, sora"`.

## 4) Deploy on Vercel

1. Import `license-server` as a Vercel project.
2. Attach Vercel Postgres.
3. Add env vars:
   - `POSTGRES_URL`
   - `ADMIN_API_KEY`
4. Deploy.

Use deployed base URL in Electron app:

- `LICENSE_API_BASE_URL=https://<your-license-domain>`
- `LICENSE_ADMIN_URL=https://<your-license-domain>/admin`
