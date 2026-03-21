/**
 * GROK.COM/IMAGINE — DOM SELECTORS
 * Confirmed từ DOM inspect thực tế (02/2025)
 *
 * ⚠️  Tất cả popover (settings, attach) render trực tiếp dưới <body>
 *     dưới dạng [data-radix-popper-content-wrapper] — KHÔNG nằm trong
 *     .query-bar hay sidebar. Cần click trigger trước rồi mới query.
 *
 * Update file này nếu Grok thay đổi UI. Không hardcode selector ở nơi khác.
 */

export const SELECTORS = {

  // ─── AUTH ────────────────────────────────────────────────────────────
  // Anchor [data-sidebar="sidebar"] đảm bảo không nhầm với prompt bar
  auth: {
    avatarBtn:      '[data-sidebar="sidebar"] button[aria-haspopup="menu"]',
    avatarInitials: '[data-sidebar="sidebar"] span.bg-surface-l4',
  },

  // ─── PROMPT BAR ──────────────────────────────────────────────────────
  prompt: {
    // Ô nhập prompt — contenteditable div (KHÔNG phải <textarea>)
    // Dùng page.click() rồi page.keyboard.type() để nhập text
    input:        'div.tiptap.ProseMirror[contenteditable="true"]',

    // Nút đính kèm ảnh — click sẽ mở attachPopover
    attachBtn:    'button[aria-label="Attach"]',

    // Nút Settings — click sẽ mở settingsPopover (Image/Video/ratio/resolution)
    settingsBtn:  'button[aria-label="Settings"]',

    // Label mode hiện tại trong settings button: "Image" hoặc "Video"
    settingsLabel: 'button[aria-label="Settings"] span.text-sm.font-medium',

    // Nút Submit — disabled khi chưa có prompt, enabled sau khi nhập
    submitBtn:    'button[aria-label="Submit"][type="submit"]',
  },

  /**
   * Prompt bar inline (03/2026) — không còn nút Settings; có radiogroup Generation mode,
   * Aspect Ratio (menu), và khi Video: Video resolution + Video duration.
   * @see html_inpects/grok_03212026/prompt_bar_*.html
   */
  inlinePromptBar: {
    queryBar:              '.query-bar',
    generationModeGroup:   '[role="radiogroup"][aria-label="Generation mode"]',
    aspectRatioBtn:        'button[aria-label="Aspect Ratio"]',
    videoResolutionGroup:  '[role="radiogroup"][aria-label="Video resolution"]',
    videoDurationGroup:    '[role="radiogroup"][aria-label="Video duration"]',
  },

  // ─── SETTINGS POPOVER ────────────────────────────────────────────────
  // Render dưới <body> sau khi click settingsBtn
  // Dùng [data-radix-menu-content] để target chính xác (tránh nhầm attachPopover)
  settingsPopover: {
    // Container chung — xuất hiện sau click Settings
    container: '[data-radix-menu-content][aria-labelledby]',

    // Mode selector — dùng role="menuitemradio" + aria-checked để detect active
    imageModeBtn: '[role="menuitemradio"]:has(span.font-medium:text-is("Image"))',
    videoModeBtn: '[role="menuitemradio"]:has(span.font-medium:text-is("Video"))',

    // Detect mode đang active: aria-checked="true"
    activeModeBtn: '[role="menuitemradio"][aria-checked="true"]',

    // Aspect Ratio — dùng aria-label trực tiếp, không phụ thuộc vào class
    // Image mode:  2:3 | 3:2 | 1:1 | 9:16 | 16:9
    // Video mode:  2:3 | 3:2 | 1:1 | 9:16 | 16:9
    ratioBtn: (ratio: '2:3' | '3:2' | '1:1' | '9:16' | '16:9') =>
      `button[aria-label="${ratio}"]`,

    // Detect ratio đang active: span có class text-primary + font-semibold
    // (ratio được chọn có span.text-primary, các ratio khác có span.text-secondary)
    activeRatioLabel: 'button[type="button"] span.text-primary.font-semibold',

    // Resolution — CHỈ có khi Video mode được chọn
    // aria-label="480p" hoặc "720p"
    resolutionBtn: (res: '480p' | '720p') => `button[aria-label="${res}"]`,

    // Detect resolution active: button có class font-semibold (active) vs font-medium (inactive)
    activeResolutionBtn: 'button[aria-label="480p"].font-semibold, button[aria-label="720p"].font-semibold',

    // Duration — TODO: chưa có DOM, cần inspect thêm khi Video mode active
    durationBtn: null,
  },

  // ─── ATTACH POPOVER ──────────────────────────────────────────────────
  // Render dưới <body> sau khi click attachBtn
  // Có 2 options: Edit Images | Animate Image
  attachPopover: {
    container: '[data-radix-menu-content]',

    // Option 1: Chỉnh sửa/kết hợp ảnh (tối đa 3 ảnh)
    editImagesItem:   '[data-radix-collection-item]:has(span:text-is("Edit Images"))',

    // Option 2: Biến ảnh thành video
    animateImageItem: '[data-radix-collection-item]:has(span:text-is("Animate Image"))',
  },

  // ─── GENERATING STATE ────────────────────────────────────────────────
  // Render trong <main> khi đang generate
  generating: {
    // Badge hiển thị "Generating X%" — dùng để detect đang chạy
    badge:          'span.animate-pulse:text-is("Generating")',

    // Phần trăm tiến trình — text content là "27%" etc.
    progressText:   'span.tabular-nums.animate-pulse',

    // Nút Cancel trong badge
    cancelBtn:      'button[type="button"]:text-is("Cancel")',

    // Thumbnail đang generate (chưa xong) — có overlay với % text
    generatingThumb: 'div.absolute.inset-0.bg-black\\/60',
  },

  // ─── UPLOAD (hidden file input) ──────────────────────────────────────
  // prompt_bar_after_upload_image.html: input inside form — scope .query-bar để không trúng input khác trên trang
  upload: {
    fileInput:        'input[type="file"][accept*="image"]',
    fileInputQueryBar: '.query-bar input[type="file"][accept*="image"]',
  },

  // ─── SETTINGS POPOVER when image uploaded (Flow B/C) ───────────────────
  // settings_menu.html: only "Edit Image" and "Make Video" items
  settingsPopoverImageMode: {
    container:     '[data-radix-menu-content][role="menu"]',
    makeVideoFromImageModeBtn: '[data-radix-collection-item]:has-text("Make Video")',
    makeImageFromImageModeBtn: '[data-radix-collection-item]:has-text("Edit Image")',
  },

  // ─── SUBMIT khi có ảnh (Flow B) ──────────────────────────────────────
  promptWithImage: {
    makeVideoBtn: 'button[aria-label="Make video"]',
  },

  // ─── OUTPUT (image_generating.html, more_options_menu.html) ────────────
  output: {
    downloadBtn:     'button[aria-label="Download"]',
    outputThumb:     'img[src*="assets.grok.com"][alt*="Thumbnail"]',
    unsaveBtn:       'button[aria-label="Unsave"]',
    saveBtn:         'button[aria-label="Save"]',
    composePostBtn:  'button[aria-label="Compose Post"]',
    createShareBtn:  'button[aria-label="Create share link"]',
    moreOptionsBtn:  'button[aria-label="More options"]',
    upscaleMenuItem: '[data-radix-collection-item]:has-text("Upscale video")',
  },

} as const

// ─── TYPES ───────────────────────────────────────────────────────────────
export type AspectRatio = '2:3' | '3:2' | '1:1' | '9:16' | '16:9'
export type Resolution  = '480p' | '720p'
export type OutputMode  = 'Image' | 'Video'