# Changelog

## [1.2.9] - 2026-04-01

### Added (Veo3)

- **Veo 3.1 - Lite**: model mới trên Google Flow (khớp menu `Veo 3.1 - Lite`).
- **Giới hạn video mỗi phiên (batch)**: tùy chọn trong modal dự án — sau khi tạo/tải đủ số video trong một phiên, tool mở phiên Flow mới và tiếp tục hàng đợi (giảm tải 403/reCAPTCHA). Ngưỡng tính theo **số video** (số prompt × multiplier), chia theo **group** (ảnh/kịch bản).

### Changed / Removed

- Gỡ automation **profile warming** (`profileWarming.ts`).
- **Modal profile Veo3**: quản lý profile gọn hơn (mở theo số / theo lựa chọn, xóa profile, cập nhật trạng thái đăng nhập).

## [1.2.1] - 2026-03-10

### Fixed (Veo3 / app shell)

- **Hàng đợi (Queue)**: Sửa layout flex để danh sách job **cuộn đúng** khi có nhiều tác vụ; thanh cuộn dễ nhìn hơn trên Windows.
- **Flow (Chrome)**: Trước mỗi bước tự động, tool **xóa vùng chọn văn bản** và **đóng an toàn** hộp thoại xác nhận xóa nếu vô tình mở (nhiều profile / thao tác chồng) — giảm tình trạng treo hoặc thao tác sai do modal hoặc “bôi xanh” trên trang.

## [1.2.0] - 2026-03-10

### Added (Grok Imagine)

- **Inline prompt bar** (03/2026 UI): Generation mode Image/Video, Aspect Ratio menu, Video resolution & duration — automation in `inlinePromptBar.ts`; legacy Settings popover kept as fallback.
- **Kịch bản (scripts)**: Giống Veo3 — 1 kịch bản + nhiều ảnh, mỗi ảnh chạy hết prompt; `imageIndex` trên job; nút **Thêm/sửa kịch bản** trên màn Grok.
- **Grok profiles**: Modal quản lý Chrome profiles (mở/đóng, đăng nhập grok.com/imagine).
- Selector **`.query-bar`** cho upload ảnh; reload trang Imagine trước mỗi job khi đã mở tab (tránh state/preview lệch giữa nhiều profile).

### Changed (Grok UI)

- **Loại output** chỉ còn **Image / Video**; `deriveGrokProjectMode()` suy ra mode (prompt / animate / edit) từ output + folder ảnh — bỏ dropdown Mode riêng.
- **Folder ảnh**: cùng pattern Input + **Chọn** (Folder) như thư mục tải về.
- **Prompt**: nhập nhanh bằng `fill` / `insertText` thay vì gõ từng ký tự.
- Queue **run-queue**: mutex `shift()` cho job; `duration` cho image-to-video.

### Changed (Veo3 UI only)

- Modal dự án Veo3: chọn kịch bản bằng **dropdown** thay cho radio.

### Fixed

- **Grok** `flowA_configureSettings`: ưu tiên thanh inline trước Settings cũ.
- **Grok** `runFlowC`: nhánh inline (Image + ratio trước upload, bỏ menu Edit Image cũ khi có thanh inline).

## [1.1.2] - 2026-03-20

### Fixed

- **Veo3 / Flow**: Failed-generation detection and retry for updated DOM (including policy/safety copy), stricter completed-video vs failed classification, retry only marked after a successful click, and broader retry-button matching.
- **TypeScript**: `page.on('request'|'response')` listeners typed with Patchright `Request` / `Response` (fixes overload errors).

## [1.1.1] - 2026-03-19

### Changed

- Image mode (Hình ảnh) hidden in this release (SHOW_IMAGE_MODE=false)

## [1.1.0] - 2026-03-19

### Added

- **Download resolution** (Veo3): Choose 720p, 1080p, or 4k for video downloads
  - 720p: Download immediately (no upscale)
  - 1080p/4k: Upscale then download
- **Image generation mode** (Veo3): New "Hình ảnh" flow
  - Loại tạo: Video / Hình ảnh
  - Image models: Nano Banana Pro, Nano Banana 2, Imagen 4
  - Image resolution: 1k, 2k, 4k
  - Upload folder: sample.png or sample.jpg (reference image)

### Fixed

- Queue panel scroll when many jobs

### Changed

- Video mode settings (Ingredients/Frames) hidden when Image mode selected
