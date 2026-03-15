# GitHub Actions Release Steps

This project has an automated workflow at:

- `.github/workflows/release-electron.yml`

It builds the Electron installer on Windows and publishes a GitHub Release that `electron-updater` can consume.

## One-time setup

1. Put this code in your Electron app GitHub repository.
2. In GitHub repo:
   - `Settings -> Actions -> General`
   - Ensure Actions are allowed.
3. In `Settings -> Actions -> General -> Workflow permissions`, allow:
   - **Read and write permissions**
4. Keep your app update provider as GitHub (`electron-builder.config.js` already supports this through `GH_OWNER` + `GH_REPO` env from workflow).

## Release a new app version (every time)

1. Update app version in `package.json` (for example `0.1.0` -> `0.1.1`).
2. Commit and push your code to `main`.
3. Create a git tag with prefix `v` (must match workflow trigger), for example:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

4. Open GitHub -> `Actions` -> `Release Electron App` and wait for success.
5. After success, open `Releases` and confirm assets exist (exe, yml, zip/blockmap).

## What users do

1. User installs app once.
2. Later, when you publish new tagged release, app downloads update in background.
3. User clicks **Restart to update** in app.
4. App restarts and updates without full reinstall.

## Troubleshooting

- No workflow run:
  - Check tag format starts with `v` (e.g. `v0.1.2`).
- Update not found in app:
  - Confirm release contains `latest.yml` and installer assets.
  - Confirm installed app version is lower than released version.
- Build icon/sign issues on CI:
  - Workflow sets `WIN_SIGN_AND_EDIT=0` to avoid known Windows signing tool cache errors.
