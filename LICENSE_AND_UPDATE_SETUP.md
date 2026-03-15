# License + Auto Update Setup

## 1) Deploy license server

Project is in `license-server/` (Next.js).

Required env on server:
- `POSTGRES_URL`
- `ADMIN_API_KEY`

Deploy to Vercel, then note:
- API base URL: `https://<your-license-domain>`
- Admin URL: `https://<your-license-domain>/admin`

## 2) Configure Electron app

Set env vars when building/running Electron:

- `LICENSE_API_BASE_URL=https://<your-license-domain>`
- `LICENSE_ADMIN_URL=https://<your-license-domain>/admin`

Activation flow:
- user enters key
- app calls `POST /api/license/activate` with `deviceId`
- app stores token and checks `GET /api/license/status` periodically
- access is blocked when expired/revoked (with offline grace window)

## 3) Auto update (already wired)

Auto updater in app checks periodically when packaged.

Choose one publish channel:

### Generic provider
- Set `AUTO_UPDATE_URL=https://<your-update-host>`
- Upload `latest.yml` + installer artifacts from each build to this URL

### GitHub provider
- Set `GH_OWNER=<owner>`
- Set `GH_REPO=<repo>`
- Publish build artifacts to GitHub Releases

Optional:
- `DISABLE_AUTO_UPDATE=1` to disable updater
- `WIN_SIGN_AND_EDIT=0` only if your machine cannot build signed/editable exe icon

## 4) Admin usage

Open `https://<your-license-domain>/admin`:
- Enter `ADMIN_API_KEY`
- Create trial/user/admin keys with duration
- Revoke keys when needed

In Electron app, admin licenses show `Quản lý` button (opens admin URL).
