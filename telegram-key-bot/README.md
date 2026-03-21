# Telegram Key Bot

Bot giúp sales tạo key kích hoạt nhanh qua Telegram, không cần admin vào web.

## Luồng

1. Sales nhận SĐT khách từ chat
2. Sales gửi `/key <số điện thoại> <số ngày>` cho bot
3. Bot gọi admin API → tạo key
4. Bot trả key về cho sales
5. Sales gửi key cho khách

### Mở thêm model cho key đã có (theo SĐT)

1. Sales gửi `/addmodels <SĐT> <veo|grok|sora...>` — **bật thêm** model, không tắt model đang mở.
2. Bot gọi `POST /api/admin/keys/merge-features-by-phone` trên license-server (cần deploy bản có route này).

Ví dụ: `/addmodels 0912345678 sora` — bật thêm Sora cho license gắn SĐT đó (chọn bản ghi mới nhất, ưu tiên chưa revoke).

## Cài đặt

### 1. Tạo bot trên Telegram

- Mở [@BotFather](https://t.me/BotFather)
- Gửi `/newbot` → đặt tên → nhận `TELEGRAM_BOT_TOKEN`

### 2. Cấu hình

```bash
cd telegram-key-bot
cp .env.example .env
# Sửa .env:
# - TELEGRAM_BOT_TOKEN
# - ADMIN_API_KEY (giống license-server)
# - LICENSE_API_BASE_URL (vd: https://lohastudioadmin.vercel.app)
# - TELEGRAM_ALLOWED_IDS (tùy chọn, ID Telegram của sales, cách nhau dấu phẩy)
```

Lấy Telegram user ID: chat với [@userinfobot](https://t.me/userinfobot).

### 3. Chạy

```bash
npm install
npm run build
npm start
```

Hoặc dev:

```bash
npm run dev
```

## Cú pháp

```
/key <số điện thoại> <số ngày> [veo] [grok] [sora]
```

- **Models** (tuỳ chọn): chỉ bật đúng sản phẩm được gõ (`veo` = Veo3/Flow, `grok` = Grok Imagine, `sora` = Sora). Cách nhau bằng **dấu cách** hoặc **phẩy**.
- Nếu **không ghi** models → bot dùng biến môi trường **`DEFAULT_MODELS`** (mặc định `veo,grok` = Veo + Grok, tắt Sora — giống API admin).

Ví dụ:

- `/key 0399692275 30` — key 30 ngày, models theo `DEFAULT_MODELS` (mặc định Veo + Grok)
- `/key 0912345678 7 veo grok sora` — bật cả ba
- `/key 0912345678 30 grok` — chỉ Grok

API server (`POST /api/admin/keys/create`) đã hỗ trợ `veoActive`, `grokActive`, `soraActive`; bot gửi đúng các field này.

### `/addmodels`

```
/addmodels <số điện thoại> <veo> [grok] [sora]
```

- **Chỉ bật thêm** (merge): model đã bật vẫn giữ.
- Nếu có nhiều license cùng SĐT: cập nhật bản **mới nhất**, ưu tiên **chưa revoked**.

## Bảo mật

- `TELEGRAM_ALLOWED_IDS`: Chỉ user ID trong danh sách mới dùng được bot. Để trống = cho phép tất cả.
- `ADMIN_API_KEY`: Giữ bí mật, không commit vào git.

## Deploy

Có thể chạy trên VPS, Railway, Render, hoặc bất kỳ server Node.js nào. Cần biến môi trường như trên.
