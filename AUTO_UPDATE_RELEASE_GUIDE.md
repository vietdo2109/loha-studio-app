# Auto Update Release Guide

This project already has `electron-updater` wired in app code.

## What users experience

1. User installs app once.
2. App checks updates automatically (periodic + manual "Check update").
3. When update is downloaded, app shows **Restart to update**.
4. User clicks restart, app installs new version (no reinstall).

## Prerequisites for update publishing

- Increase app `version` in `package.json` for each release.
- Build and publish artifacts (`latest.yml`, installer, zip, blockmaps) to your update channel.

## Option A: GitHub Releases update channel

Set env vars before build:

```powershell
$env:GH_OWNER="your-github-owner"
$env:GH_REPO="your-electron-repo"
```

Build:

```powershell
npm run build
```

Then upload files from `release/` to a GitHub Release of the same version.

### Recommended: automated GitHub Actions release

Use workflow:

- `.github/workflows/release-electron.yml`

Usage steps are documented in:

- `GITHUB_RELEASE_WORKFLOW_STEPS.md`

## Option B: Generic HTTP update channel

Set env var before build:

```powershell
$env:AUTO_UPDATE_URL="https://your-domain.com/updates/"
```

Build:

```powershell
npm run build
```

Upload generated files in `release/` to your update URL.

## Important notes

- App checks updates only on packaged build (`npm run build` output), not plain dev mode.
- Keep old release files available so existing users can update safely.
- If update is downloaded, user can install immediately via **Restart to update** button.
