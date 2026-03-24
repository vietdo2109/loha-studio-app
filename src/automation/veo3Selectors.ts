/**
 * Google Flow (Veo3) — DOM selectors
 * From src/html_inpects/veo3_03072026/
 *
 * Flow URL: https://labs.google/fx/vi/tools/flow
 * Project URL: https://labs.google/fx/vi/tools/flow/project/<uuid>
 */

export const VEO3_SELECTORS = {
  // ─── New project — use add_2 icon first (unique on project list); class matches 6 on landing so run job only when logged in ─
  newProjectBtn: 'button:has(i:text-is("add_2")), button.sc-16c4830a-1.jsIRVP, button.sc-16c4830a-1',

  // ─── Prompt bar container (works for initial + video mode states) ─
  promptBar: '#__next div:has([role="textbox"][data-slate-editor="true"]):has(button:has(i:text-is("arrow_forward")))',
  // Slate editor — contenteditable prompt input
  promptInput: '[role="textbox"][data-slate-editor="true"]',
  // Submit button (arrow_forward / hidden text "Tạo")
  submitBtn: 'button:has(i:text-is("arrow_forward")), button:has(span:text-is("Tạo"))',

  // ─── Settings / mode (inside prompt bar) — button showing current mode ─
  settingsModeBtn: '#__next button[type="button"][aria-haspopup="menu"]:has-text("Video"), #__next button[type="button"][aria-haspopup="menu"]:has-text("Image"), #__next button[type="button"][aria-haspopup="menu"]:has-text("Nano Banana")',
  // Settings menu (settings_menu.html) — Image / Video tabs
  settingsMenuVideoTab: 'button[role="tab"]:has-text("Video")',
  settingsMenuImageTab: 'button[role="tab"]:has-text("Image")',
  /** Image tab (Vietnamese locale). */
  settingsMenuImageTabHinhAnh: 'button[role="tab"]:has-text("Hình ảnh")',
  // Aspect: 16:9 (landscape) / 9:16 (portrait) — UI may also use "Ngang"/"Dọc"
  settingsMenuLandscape: 'button[role="tab"]:has-text("16:9")',
  settingsMenuPortrait: 'button[role="tab"]:has-text("9:16")',
  // Multiplier x1, x2, x3, x4
  settingsMenuMultiplier: (n: 1 | 2 | 3 | 4) => `button[role="tab"]:has-text("x${n}")`,
  // Model selector in settings menu (opens model options submenu)
  settingsModelSelectorBtn: '[data-radix-menu-content][role="menu"] > button[type="button"][aria-haspopup="menu"]',
  // Model option in opened models submenu (menuitem list)
  settingsModelMenuItemBtn: (label: string) => `[data-radix-menu-content][role="menu"] [role="menuitem"] button:has(span:text-is("${label}"))`,

  // ─── Content upload buttons in composer (Frames slots + Ingredients button) ─
  openContentDialogBtn: '#__next div[type="button"][aria-haspopup="dialog"]:has-text("Bắt đầu"), #__next div[type="button"][aria-haspopup="dialog"]:has-text("Kết thúc"), #__next button[type="button"][aria-haspopup="dialog"]',
  // Content upload dialog (content_upload_menu.html) — sort dropdown + "Tìm kiếm các thành phần"; upload_image_sort.html
  // "Đã dùng gần đây" can hide items from ~17th upload — automation must ensure "Mới nhất" before import (see ensureContentUploadDialogSortNewest).
  contentDialogUploadBtn: 'button:has(span:text-is("Tải hình ảnh lên")), button[class*="ewQKQI"]:has(i[font-size="1.25rem"])',
  // Hidden file input — may be inside dialog or body after dialog opens
  contentDialogFileInput: 'input[type="file"][accept*="image"]',

  // ─── Uploaded items (uploaded_items.html) — tiles with data-tile-id ─
  uploadedTile: '[data-tile-id]',
  uploadedTileImage: '[data-tile-id] img[src*="getMediaUrlRedirect"]',

  // ─── Context menu on uploaded image (uploaded_time_menu.html) ─
  contextMenuAddToPrompt: 'button[role="menuitem"]:has-text("Thêm vào câu lệnh")',

  // ─── Video mode prompt bar — Frames: "Bắt đầu" / "Kết thúc" slots ─
  framesStartSlot: '#__next div[type="button"][aria-haspopup="dialog"]:has-text("Bắt đầu")',
  framesEndSlot: '#__next div[type="button"][aria-haspopup="dialog"]:has-text("Kết thúc")',

  // ─── Generating rows (virtuoso list) ─
  generatingRow: '[data-testid="virtuoso-item-list"] [data-index]',
  generatingProgress: '.sc-55ebc859-7.kAxcVK',

  // ─── Generated content list (generated_content_list.html) ─
  // Layout: [newest ... oldest] then uploaded image. E.g. after prompt 2 (x2): 4.mp4 | 3.mp4 | 2.mp4 | 1.mp4 | 1.png
  // So DOM order (left to right): tile 0 = N.mp4, tile 1 = (N-1).mp4, ..., tile (N-1) = 1.mp4.
  generatedListContainer: '[data-testid="virtuoso-item-list"]',
  /** Fallback if testid changes: same list by class (sc-8cc14b4-2 flwBCQ from inspect). */
  generatedListContainerFallback: 'div.sc-8cc14b4-2.flwBCQ',

  /**
   * COMPLETED video tile: only tiles that contain <video src="...getMediaUrlRedirect?name=...">.
   * Used to count "done" videos and to trigger 1080p download. .nth(0) = leftmost = N.mp4, .nth(count-1) = 1.mp4.
   */
  generatedCompletedVideoTile: '[data-tile-id]:has(video[src*="getMediaUrlRedirect"])',

  /**
   * GENERATING tile: has progress % text (e.g. "29%") inside .sc-55ebc859-7 — no <video> yet.
   * DOM difference:
   *   - Generating: [data-tile-id] > ... > a > div.sc-55ebc859-0 > div.sc-55ebc859-2 > div.sc-55ebc859-7 "29%" + videocam icon.
   *   - Completed:   [data-tile-id] > ... > div.sc-c33d76e1-0 > a > button > video[src*="getMediaUrlRedirect"] + play_circle overlay.
   * So we treat "completed" = tile has a video element with media URL; "generating" = tile has progress div, no video.
   */
  generatingTileWithProgress: '[data-tile-id] .sc-55ebc859-7.kAxcVK',

  /**
   * FAILED video tile (Veo3 error, not tool): Flow uses multiple error layouts; the stable signal is
   * the generation retry control (material icon `refresh` / Try again / Thử lại). Exclude completed
   * video tiles so we never match an unrelated refresh elsewhere on the card.
   * Fallback selectors: legacy title nodes + common error copy (see html_inpects).
   */
  generatedFailedVideoTile:
    '[data-tile-id]:has(button:has(i:text-is("refresh"))):not(:has(video[src*="getMediaUrlRedirect"])), ' +
    '[data-tile-id]:has(button[aria-label*="Try again" i]):not(:has(video[src*="getMediaUrlRedirect"])), ' +
    '[data-tile-id]:has(button[aria-label*="Thử lại"]):not(:has(video[src*="getMediaUrlRedirect"])), ' +
    '[data-tile-id]:has(button:has-text("Try again")):not(:has(video[src*="getMediaUrlRedirect"])), ' +
    '[data-tile-id]:has(div.sc-9a984650-1.dEfdsQ), [data-tile-id]:has(div.sc-25d34a31-1), ' +
    '[data-tile-id]:has-text("Không thành công"), [data-tile-id]:has-text("Something went wrong"), ' +
    '[data-tile-id]:has-text("chính sách"), [data-tile-id]:has-text("vi phạm")',
  /** Retry inside a failed tile: refresh icon, a11y label, or legacy action rows. Scoped to the failed tile. */
  generatedFailedRetryBtn:
    'button:has(i:text-is("refresh")), button[aria-label*="Try again" i], button[aria-label*="Thử lại"], ' +
    'button:has-text("Try again"), button:has-text("Thử lại"), div.sc-9a984650-5 button, div.sc-25d34a31-5 button:has(i:text-is("refresh"))',

  // ─── Context menu on generated video (generated_content_download_menu.html): Tải xuống → submenu → 1080p ─
  contextMenuDownload: '[role="menu"] [role="menuitem"]:has-text("Tải xuống"), [role="menu"] div:has-text("Tải xuống")',
  /** 720p (Original Size) — tải ngay, không upscale. */
  contextMenuDownload720p: '[role="menu"]:has(button:has(span:text-is("270p"))) button[role="menuitem"]:has(span:text-is("720p"))',
  /** 1080p in the download submenu. Prefer submenu that has 270p; fallback to any visible menuitem with 1080p. */
  contextMenuDownload1080p: '[role="menu"]:has(button:has(span:text-is("270p"))) button[role="menuitem"]:has(span:text-is("1080p"))',
  /** 4K (Upscaled). */
  contextMenuDownload4k: '[role="menu"]:has(button:has(span:text-is("270p"))) button[role="menuitem"]:has(span:text-is("4K"))',
  /** Image mode download resolution: 1k, 2k, 4k (different from video). */
  contextMenuDownload1k: '[role="menu"] button[role="menuitem"]:has(span:text-is("1k")), [role="menu"] button[role="menuitem"]:has(span:text-is("1K"))',
  contextMenuDownload2k: '[role="menu"] button[role="menuitem"]:has(span:text-is("2k")), [role="menu"] button[role="menuitem"]:has(span:text-is("2K"))',
  contextMenuDownloadImage4k: '[role="menu"] button[role="menuitem"]:has(span:text-is("4k")), [role="menu"] button[role="menuitem"]:has(span:text-is("4K"))',
  /** Fallback: any visible menuitem with span "1080p" (when submenu parent selector fails). */
  contextMenuDownload1080pFallback: 'button[role="menuitem"]:has(span:text-is("1080p"))',
  /** Fallback: menuitem containing text 1080p (for different DOM). */
  contextMenuDownload1080pByText: '[role="menu"] button[role="menuitem"]:has-text("1080p")',

  // ─── Edit page (single video): open by clicking tile link, then use page Download button → 1080p
  /** Link inside a completed video tile that goes to the video's edit page. Only use inside a video tile (e.g. completedVideoTile); image tiles have the same a[href*="/edit/"] format — do not click those. */
  tileEditLink: 'a[href*="/edit/"]',
  /** Edit page: Download button (opens resolution menu). */
  editPageDownloadBtn: 'button[aria-haspopup="menu"]:has(div:text-is("Tải xuống"))',
  /** Edit page: resolution options in the dropdown. */
  editPage720p: '[data-radix-menu-content][role="menu"] button[role="menuitem"]:has(span:text-is("720p"))',
  editPage1080p: '[data-radix-menu-content][role="menu"] button[role="menuitem"]:has(span:text-is("1080p")), button[role="menuitem"]:has(span:text-is("1080p"))',
  editPage4k: '[data-radix-menu-content][role="menu"] button[role="menuitem"]:has(span:text-is("4K"))',
} as const

export const VEO3_FLOW_BASE = 'https://labs.google/fx/vi/tools/flow'
export const VEO3_PROJECT_URL_PATTERN = /\/flow\/project\/[0-9a-f-]+/i
/** Edit page URL (single video): .../project/<id>/edit/<workflowId> */
export const VEO3_EDIT_PAGE_URL_PATTERN = /\/flow\/project\/[0-9a-f-]+\/edit\/[0-9a-f-]+/i
