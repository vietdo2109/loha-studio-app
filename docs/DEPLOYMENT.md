# Quy trình deploy — Loha Studio (tool, admin, Telegram bot)

Tài liệu ngắn để **tránh nhầm repo / nhầm cách chạy bot**. Đưa file này (hoặc đoạn tóm tắt) cho AI khi cần sửa deploy.

---

## 1. Ba “mảnh” và GitHub tương ứng

| Mảnh | Repo GitHub | Ghi chú |
|------|-------------|---------|
| **App Electron (tool)** | `vietdo2109/loha-studio-app` | Monorepo: `src/`, build release, updater. |
| **Admin web + License API** | `vietdo2109/loha_studio_admin` | Next.js deploy **Vercel** — **đây mới là nơi production của license server.** |
| **Telegram bot (production)** | *Cùng code trong `loha_studio_admin`* | Không chạy bot bằng `telegram-key-bot` polling trên cùng token với webhook. |

Trong monorepo `loha-studio-app` có thư mục `license-server/` để dev local / tham chiếu; **deploy thật** cần đưa code lên **`loha_studio_admin`** (không chỉ push `main` monorepo nếu mục tiêu là Vercel admin).

---

## 2. Admin web + License API (`loha_studio_admin`)

- **Deploy:** Vercel (import project trỏ tới repo `loha_studio_admin`).
- **Env trên Vercel (tối thiểu):**
  - `POSTGRES_URL` — Postgres (Vercel Postgres hoặc tương đương)
  - `ADMIN_API_KEY` — dùng cho trang `/admin` và header `x-admin-key` của API admin
- **Telegram (nếu dùng bot webhook):**
  - `TELEGRAM_BOT_TOKEN`
  - `BASE_URL` — URL public của site (vd `https://lohastudioadmin.vercel.app`), **không** chỉ domain rồi thiếu path
  - `TELEGRAM_ALLOWED_IDS` — tùy chọn; để trống = mọi user
  - `DEFAULT_MODELS` — tùy chọn (vd `veo,grok`) cho lệnh `/key` khi không ghi model

**Sau mỗi lần đổi domain hoặc lần đầu cấu hình bot:** trong clone `license-server` (hoặc repo admin), có file `.env.local` đủ biến trên, chạy:

```bash
cd license-server   # hoặc root repo admin
npm run set-webhook
```

Script đặt webhook Telegram = `BASE_URL` + `/api/telegram-webhook` (HTTPS, **có path**).

- Nếu cần tắt webhook (ví dụ thử polling local): `npm run delete-webhook` (cùng `TELEGRAM_BOT_TOKEN`).

---

## 3. Telegram bot — điểm hay nhầm

| Cách | Ở đâu | Khi nào dùng |
|------|--------|----------------|
| **Webhook (chuẩn production)** | `loha_studio_admin` → route `POST /api/telegram-webhook` | Bot thật cho sales; **một token bot chỉ gắn một webhook.** |
| **Polling** | Folder `telegram-key-bot/` trong monorepo | Chỉ dev/thử; **tắt webhook** trước hoặc dùng **bot token khác** — không dùng chung token với Vercel. |

Lệnh bot trên production (trong code webhook): `/start`, `/key … [veo|grok|sora]`, `/addmodels …`.

---

## 4. Đồng bộ code `license-server` → `loha_studio_admin`

Monorepo remote thường có:

- `origin` → `loha-studio-app`
- `admin` → `loha_studio_admin`

**Cách làm thực tế đã dùng:** tạo **git worktree** nhánh `admin/main`, **copy** (hoặc rsync/robocopy) nội dung `license-server/*` vào root worktree (repo admin là flat, không có thư mục `license-server/`), rồi `git commit` + `git push admin HEAD:main`.

**Lư ý:** Push lên `origin main` của monorepo **không** tự deploy `loha_studio_admin` — phải push riêng repo admin.

---

## 5. Tool Electron (app)

- Build / release từ repo **`loha-studio-app`** (nhánh `main`, tag release, CI nếu có).
- App gọi license server theo URL bạn cấu hình (thường trùng domain Vercel của admin).

---

## 6. Checklist nhanh sau khi sửa license / bot

1. Code đã có trên **`loha_studio_admin`** và Vercel **deploy xong**.
2. Env Vercel đủ (`POSTGRES_URL`, `ADMIN_API_KEY`, và các biến Telegram nếu dùng bot).
3. Chạy `npm run set-webhook` nếu đổi `BASE_URL` hoặc mới bật bot.
4. Thử `/start` trên Telegram — không chạy đồng thời **polling** `telegram-key-bot` cùng token với webhook.

---

## 7. Cho AI / người mới (copy-paste)

> License production: repo **`vietdo2109/loha_studio_admin`**, Vercel.  
> Telegram bot: **webhook** tại `{BASE_URL}/api/telegram-webhook`, không dùng chỉ `BASE_URL` không path.  
> Đồng bộ code từ monorepo: copy `license-server/` vào admin repo rồi push `main` admin — không nhầm với chỉ push `loha-studio-app`.

---

*Cập nhật: có thể chỉnh file này khi quy trình thay đổi.*
