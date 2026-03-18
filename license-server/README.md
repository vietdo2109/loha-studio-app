# Loha License Server (Next.js + Vercel)

This app provides:
- License activation API for Electron clients
- License status API for periodic re-validation
- Admin web page to create/revoke keys

## 1) Configure

Set env vars:

- `POSTGRES_URL` (Vercel Postgres connection string)
- `ADMIN_API_KEY` (secret used by admin page/API)

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
    "expiresAt": 1770000000000
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
    "expiresAt": 1770000000000
  }
}
```

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
