// ─── Primitives ───────────────────────────────────────────────────────────────

export type AspectRatio = '16:9' | '9:16' | '1:1' | '2:3' | '3:2'
export type Resolution  = '480p' | '720p'
/** Inline video bar (03/2026): 6s | 10s */
export type Duration = '6s' | '10s'

/**
 * Mode xác định flow nào sẽ được chạy trong BrowserWorker:
 *
 * prompt-to-image  → Flow A (text only) → generate image
 * prompt-to-video  → Flow A (text only) → generate video
 * image-to-video   → Flow B (1 ảnh)    → animate image thành video
 * images-to-image  → Flow C (1-3 ảnh)  → edit image với prompt
 */
export type JobMode =
  | 'prompt-to-image'   // text → image
  | 'prompt-to-video'   // text → video
  | 'image-to-video'    // 1 ảnh + prompt → video (Animate Image)
  | 'images-to-image'   // 1-3 ảnh + prompt → image (Edit Image)

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

// ─── Job (đơn vị thực thi nhỏ nhất — 1 prompt = 1 job) ───────────────────────

/**
 * BaseJob: các field chung cho tất cả job types
 */
interface BaseJob {
  id:            string         // unique ID, tự generate
  title:         string         // tên hiển thị
  prompt:        string         // prompt text
  ratio:         AspectRatio
  outputBaseDir: string         // thư mục gốc
  // outputDir sẽ được resolve thành: outputBaseDir/videoTitle/index.ext
  // ví dụ: outputs/anya-eating/1.mp4
}

/**
 * Job: text → image
 */
export interface PromptToImageJob extends BaseJob {
  mode: 'prompt-to-image'
  // không có resolution (Grok tự chọn cho image)
  // không có imagePaths
}

/**
 * Job: text → video
 */
export interface PromptToVideoJob extends BaseJob {
  mode:       'prompt-to-video'
  resolution: Resolution
}

/**
 * Job: 1 ảnh + prompt → video (Animate Image flow)
 */
export interface ImageToVideoJob extends BaseJob {
  mode:       'image-to-video'
  resolution: Resolution
  duration?:  Duration
  imagePath:  string            // đúng 1 ảnh
}

/**
 * Job: 1-3 ảnh + prompt → image (Edit Image flow)
 */
export interface ImagesToImageJob extends BaseJob {
  mode:       'images-to-image'
  imagePaths: [string, ...string[]] & { length: 1 | 2 | 3 }  // 1 đến 3 ảnh
}

/**
 * Union type — dùng ở hầu hết mọi nơi
 */
export type GrokJob =
  | PromptToImageJob
  | PromptToVideoJob
  | ImageToVideoJob
  | ImagesToImageJob

// ─── Video (tập hợp nhiều job cùng config) ───────────────────────────────────

/**
 * VideoConfig: config chung áp dụng cho tất cả job trong 1 video
 * User chỉ set 1 lần khi tạo video
 */
export interface VideoConfig {
  mode:       JobMode
  ratio:      AspectRatio
  resolution?: Resolution       // chỉ cần khi mode có video output
}

/**
 * Video: đơn vị quản lý cấp cao
 * - 1 video = nhiều prompts (jobs)
 * - tất cả jobs dùng chung VideoConfig
 * - output: outputBaseDir/title/1.ext, 2.ext, ...
 */
export interface Video {
  id:            string
  title:         string         // tên folder output
  config:        VideoConfig
  prompts:       string[]       // danh sách prompt, index = số thứ tự
  imagePaths?:   string[]       // ảnh tương ứng theo index (ảnh 0 → prompt 0)
  outputBaseDir: string
  status:        'idle' | 'running' | 'done' | 'partial-failed'
  createdAt:     number
}

// ─── Input parsing ────────────────────────────────────────────────────────────

/**
 * Kết quả parse từ file .txt
 * Prompts cách nhau bằng 1 dòng trắng
 */
export interface ParsedPromptFile {
  prompts: string[]             // danh sách prompts đã trim
  source:  string               // path file gốc
}

// ─── Worker events ────────────────────────────────────────────────────────────

export type WorkerEventType = 'progress' | 'completed' | 'failed' | 'log'

export interface ProgressPayload {
  jobId:   string
  step:    string
  percent: number
}

export interface CompletedPayload {
  jobId:    string
  filePath: string
}

export interface FailedPayload {
  jobId: string
  error: string
}

export interface LogPayload {
  level:     'info' | 'warn' | 'error'
  message:   string
  timestamp: string
}

export type WorkerEventHandler = (
  type: WorkerEventType,
  payload: ProgressPayload | CompletedPayload | FailedPayload | LogPayload
) => void

// ─── Job result ───────────────────────────────────────────────────────────────

export interface JobResult {
  jobId:     string
  success:   boolean
  filePath?: string
  error?:    string
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export const isVideoOutput = (job: GrokJob): job is PromptToVideoJob | ImageToVideoJob =>
  job.mode === 'prompt-to-video' || job.mode === 'image-to-video'

export const hasImages = (job: GrokJob): job is ImageToVideoJob | ImagesToImageJob =>
  job.mode === 'image-to-video' || job.mode === 'images-to-image'

export const isPromptOnly = (job: GrokJob): job is PromptToImageJob | PromptToVideoJob =>
  job.mode === 'prompt-to-image' || job.mode === 'prompt-to-video'