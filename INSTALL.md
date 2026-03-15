# Loha Studio — Build & Release

## Build (developer)

### Prerequisites

- Node.js 18+
- Chrome installed (used by Patchright for automation)
- (Optional) App icon: place `build/icon.ico` (Windows) and/or `build/icon.icns` (macOS). Build works without them (default Electron icon).

### Commands

```bash
# Install dependencies
npm install

# Build app (Vite + electron-builder)
npm run build
```

### Output

- **Windows**: `release/` folder contains:
  - `Loha Studio Setup x.x.x.exe` — NSIS installer (recommended for end users)
  - `Loha Studio x.x.x.exe` — portable ZIP (unzip and run the .exe)
- **macOS**: `release/*.dmg`

To ship to users: upload the **Setup** installer and/or the **portable ZIP** so they can either install or run without installing.

If the build fails with **"Cannot create symbolic link"** (Windows code-sign tool extraction), enable **Developer Mode** in Windows or run the build as Administrator. You can still run the app from `release/win-unpacked/Loha Studio.exe` for testing.

---

## User guide: Download, install & use

### Download

- Get **Loha Studio Setup x.x.x.exe** (installer) or **Loha Studio x.x.x.exe** inside the ZIP (portable).
- If you only have the ZIP: unzip it, then run `Loha Studio x.x.x.exe`.

### Install (if using Setup)

1. Run `Loha Studio Setup x.x.x.exe`.
2. Choose installation directory if you want (or use default).
3. Finish the wizard. Launch **Loha Studio** from the Start menu or desktop shortcut.

### First run

1. **Credentials file**  
   Create a `.txt` file with one account per line:  
   `email@example.com:password`  
   In the app, open **Tài khoản** → **Chọn file credentials** and select this file.

2. **Projects**  
   - **Dự án**: create projects (name, output folder, mode, prompts).  
   - Add prompts (one per line; separate blocks with a blank line for multiple prompts).  
   - For **Animate image** / **Edit image**, choose a folder of images named `1.png`, `2.png`, … (one per prompt).

3. **Queue**  
   Add projects to the queue (**Thêm vào hàng đợi**), then click **Start**.  
   The app will log in with your accounts and run jobs (video/image generation on Grok). Outputs are saved to the project’s output folder.

### Where are the logs?

- **In the app**: bottom bar → **Mở thư mục log** (opens the log folder).
- **On disk**: The path depends on your OS. Use “Mở thư mục log” to see it. Typically:
  - **Windows**: `%APPDATA%\video-automation-tool\logs\` or `%APPDATA%\Loha Studio\logs\`
  - **macOS**: `~/Library/Application Support/video-automation-tool/logs/` or similar

Log files are named `app-YYYY-MM-DD.log`. If something goes wrong, send the latest log file (and describe what you did) so we can fix it.

### Tips

- Keep Chrome closed or avoid using the same profile while the app is running.
- One run = one session: all queued jobs are processed; then you can queue more and click **Start** again.
- Resolution is fixed at 480p and duration at 6s in this version.
