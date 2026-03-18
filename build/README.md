# Build assets

Place your app icons here (optional):

- **icon.ico** — Windows (exe + installer). Recommended: 256x256 or multi-size .ico.
- **icon.icns** — macOS (dmg). Optional if you only build for Windows.

If these files are missing, the build still runs and uses the default Electron icon.

## Branded build (tên + logo khác, logic giữ nguyên)

Để tạo bộ cài với tên và logo khác:

1. Đặt file icon vào `build/` (vd: `icon-other.ico`)
2. Chạy build với biến môi trường:

   **PowerShell:**
   ```powershell
   $env:BUILD_PRODUCT_NAME="Tên App Mới"
   $env:BUILD_APP_ID="com.tenapp.app"
   $env:BUILD_ICON="icon-other.ico"
   npm run build
   ```

   **Cmd:**
   ```cmd
   set BUILD_PRODUCT_NAME=Tên App Mới
   set BUILD_APP_ID=com.tenapp.app
   set BUILD_ICON=icon-other.ico
   npm run build
   ```

- `BUILD_PRODUCT_NAME` — Tên hiển thị (cửa sổ, Start Menu, shortcut)
- `BUILD_APP_ID` — Định danh app (vd: `com.flowautomation.app`)
- `BUILD_ICON` — Tên file icon trong `build/` (vd: `icon-other.ico`)
