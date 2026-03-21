export type Platform    = "Grok" | "Veo3" | "Sora"
export type Mode        = "prompt_only" | "edit_image" | "animate_image"
export type Ratio       = "2:3" | "3:2" | "1:1" | "9:16" | "16:9"
export type Resolution  = "480p" | "720p"
export type Duration    = "6s" | "10s"
export type MediaType   = "Image" | "Video"
export type JobStatus   = "pending" | "running" | "done" | "failed"

/**
 * Suy ra Mode lưu trong Project từ **Loại output** + có/không folder ảnh (UI không còn chọn Mode riêng).
 * - Không chọn folder ảnh → prompt_only (chỉ prompt → Image hoặc Video tùy mediaType)
 * - Có folder + Video → animate_image
 * - Có folder + Image → edit_image
 */
export function deriveGrokProjectMode(mediaType: MediaType, imageDir: string): Mode {
  const has = imageDir.trim().length > 0
  if (!has) return "prompt_only"
  return mediaType === "Video" ? "animate_image" : "edit_image"
}
export type AcctStatus  = "idle" | "logging_in" | "ready" | "failed" | "running"
export type AppPanel    = "projects" | "guide"

// ─── Grok project (grok.com/imagine) ─────────────────────────────────────────
// mode: suy ra từ mediaType + imageDir (deriveGrokProjectMode), dùng cho queue/build job

export interface Project {
  id:          string
  name:        string
  outputDir:   string
  mode:        Mode
  mediaType:   MediaType
  ratio:       Ratio
  resolution:  Resolution
  duration:    Duration
  prompts:     string[]
  imageDir:    string
  createdAt:   number
  /**
   * Giống Veo3: prompts lấy từ kịch bản đã lưu.
   * Với edit_image / animate_image: 1 kịch bản + nhiều ảnh → mỗi ảnh chạy hết prompt trong kịch bản (imageIndex trên QueueJob).
   */
  useScripts?: boolean
  scriptIds?: string[]
}

export interface QueueJob {
  id:       string
  index:    number
  prompt:   string
  status:   JobStatus
  progress: number
  accountId?: string
  error?:   string
  /** Chế độ kịch bản + nhiều ảnh: ảnh thứ imageIndex trong folder (0-based), giống Veo3 */
  imageIndex?: number
}

export interface QueueProject extends Project {
  jobs:        QueueJob[]
  expanded:    boolean
}

// ─── Veo3 project (Google Flow) ───────────────────────────────────────────────
// Different structure: video mode (Frames vs Ingredients), aspect, multiplier; no Grok modes
// Image naming for Frames: 1a/1b = video 1 start/end; 2a = video 2 start only; single-video: 1.png, 2.png

export type Veo3VideoMode = 'frames' | 'ingredients'
/** Video = tạo video. Image = tạo hình ảnh (Hình ảnh tab trong Flow). */
export type Veo3GenerationMode = 'video' | 'image'
export type Veo3Multiplier = 1 | 2 | 3 | 4
export type Veo3AiModel = 'veo-3.1-fast' | 'veo-3.1-fast-lower-priority' | 'veo-3.1-quality'
/** Image mode models (Hình ảnh tab). */
export type Veo3ImageModel = 'Nano Banana Pro' | 'Nano Banana 2' | 'Imagen 4'
/** 720p = tải ngay (không upscale). 1080p/4k = upscale rồi tải. */
export type Veo3DownloadResolution = '720p' | '1080p' | '4k'
/** Image mode download resolution (khác video: 1k, 2k, 4k). */
export type Veo3ImageDownloadResolution = '1k' | '2k' | '4k'

export interface Veo3Project {
  id:          string
  name:        string
  outputDir:   string
  aiModel:     Veo3AiModel
  /** Image mode model (chỉ khi generationMode=image). */
  imageModel?: Veo3ImageModel
  /** Video = tạo video. Image = tạo hình ảnh (Hình ảnh trong Flow). */
  generationMode?: Veo3GenerationMode
  videoMode:   Veo3VideoMode
  landscape:   boolean
  multiplier:  Veo3Multiplier
  /** Độ phân giải tải video. 720p = tải ngay không upscale. */
  downloadResolution?: Veo3DownloadResolution
  /** Độ phân giải tải ảnh (chỉ khi generationMode=image): 1k, 2k, 4k. */
  imageDownloadResolution?: Veo3ImageDownloadResolution
  prompts:     string[]
  /** @deprecated use startFramesDir */
  imageDir?:   string
  /** Folder with 1.png, 2.png... for start frame (per script or per prompt). */
  startFramesDir?: string
  /** Folder with 1.png, 2.png... for end frame (optional). */
  endFramesDir?:  string
  createdAt:   number
  /** When true, prompts are built from selected scripts; 1 image per script (1.png, 2.png, ...). */
  useScripts?: boolean
  scriptIds?:  string[]
}

export interface Veo3QueueJob {
  id:       string
  index:    number
  prompt:   string
  status:   JobStatus
  progress: number
  profileId?: string
  error?:   string
  /** When project uses 1 script + multiple images: which image (0-based) this job uses; each image runs through all prompts. */
  imageIndex?: number
  /** @deprecated Use imageIndex for 1-script-per-project flow (1 script, N images, each image runs all prompts). */
  scriptIndex?: number
}

export interface Veo3QueueProject extends Veo3Project {
  jobs:      Veo3QueueJob[]
  expanded:  boolean
}

// ─── Account (Grok credentials) ──────────────────────────────────────────────

export interface Account {
  id:      string
  email:   string
  status:  AcctStatus
  error?:  string
  /** Auto-create: current step label from main */
  progressLabel?: string
}

// ─── Script (set of prompts for Veo3; 1 image per script) ────────────────────
export interface Script {
  id:      string
  name:    string
  prompts: string[]
}
