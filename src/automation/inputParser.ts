/**
 * FLOW AUTOMATION — InputParser
 * File: src/automation/InputParser.ts
 *
 * Parse prompt từ 2 nguồn:
 *   1. File .txt — prompts cách nhau bằng 1 dòng trắng
 *   2. String trực tiếp — split theo dòng trắng
 *
 * Ảnh đi kèm prompt:
 *   - Folder chứa ảnh được chỉ định
 *   - Ảnh đặt tên theo số thứ tự: 1.png, 2.jpg, 1.jpeg, ...
 *   - Prompt index 0 → ảnh tên "1.*" (1-based để dễ hiểu với user)
 */

import * as fs from 'fs'
import * as path from 'path'
import { ParsedPromptFile, GrokJob, VideoConfig, isVideoOutput } from './types'

// ─── Parse prompts từ text ────────────────────────────────────────────────────

/**
 * Parse chuỗi text thành mảng prompts.
 * Prompts phân cách bằng 1 hoặc nhiều dòng trắng.
 *
 * Input:
 *   "anya eating peanuts\n\nanya drinking tea\n\nanya sleeping"
 *
 * Output:
 *   ["anya eating peanuts", "anya drinking tea", "anya sleeping"]
 */
export function parsePromptsFromText(text: string): string[] {
  return text
    .split(/\n\s*\n/)           // split theo dòng trắng (1 hoặc nhiều)
    .map(block => block.trim())
    .filter(block => block.length > 0)
}

/**
 * Parse prompts từ file .txt
 */
export function parsePromptsFromFile(filePath: string): ParsedPromptFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File không tồn tại: ${filePath}`)
  }
  if (!filePath.endsWith('.txt')) {
    throw new Error(`File phải là .txt: ${filePath}`)
  }

  const text    = fs.readFileSync(filePath, 'utf-8')
  const prompts = parsePromptsFromText(text)

  if (prompts.length === 0) {
    throw new Error(`File .txt không có prompt nào: ${filePath}`)
  }

  return { prompts, source: filePath }
}

// ─── Resolve ảnh theo index ───────────────────────────────────────────────────

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

/**
 * Tìm file ảnh trong folder theo index (1-based).
 * Tìm: 1.png, 1.jpg, 1.jpeg, 1.webp (theo thứ tự ưu tiên)
 *
 * @param imageDir  thư mục chứa ảnh
 * @param index     số thứ tự 1-based (prompt thứ 1 → "1.*")
 * @returns         đường dẫn tuyệt đối, hoặc null nếu không tìm thấy
 */
export function resolveImageForIndex(imageDir: string, index: number): string | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(imageDir, `${index}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Resolve all image paths in a directory by index 1, 2, 3, ... until no file found.
 * Used when 1 project = 1 script with multiple images (each image runs through all prompts).
 */
export function resolveAllImagePathsFromDir(imageDir: string, maxCount: number = 200): string[] {
  const out: string[] = []
  for (let i = 1; i <= maxCount; i++) {
    const p = resolveImageForIndex(imageDir, i)
    if (!p) break
    out.push(p)
  }
  return out
}

/**
 * List all image files in a directory by directory iteration order.
 * Used by Veo3 script mode where filename numbering is not required.
 */
export function listImagePathsFromDir(imageDir: string): string[] {
  if (!imageDir || !fs.existsSync(imageDir)) return []
  const entries = fs.readdirSync(imageDir, { withFileTypes: true })
  const isPureNumericStem = (fileName: string): number | null => {
    const stem = path.parse(fileName).name.trim()
    if (!/^\d+$/.test(stem)) return null
    const n = Number(stem)
    return Number.isFinite(n) ? n : null
  }
  return entries
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    // Deterministic order for prompt/image flows:
    // numeric filenames are ordered 1 -> 2 -> ... -> N, then non-numeric names.
    .sort((a, b) => {
      const aNum = isPureNumericStem(a)
      const bNum = isPureNumericStem(b)
      if (aNum != null && bNum != null) return aNum - bNum
      if (aNum != null) return -1
      if (bNum != null) return 1
      return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    })
    .map(name => path.join(imageDir, name))
}

/**
 * Tìm tất cả ảnh cho 1 index (dùng khi mode images-to-image, tối đa 3 ảnh).
 * Convention: 1a.png, 1b.png, 1c.png — hoặc chỉ 1.png nếu chỉ có 1 ảnh.
 */
export function resolveImagesForIndex(imageDir: string, index: number): string[] {
  const results: string[] = []

  // Thử single: 1.png
  const single = resolveImageForIndex(imageDir, index)
  if (single) return [single]

  // Thử multi: 1a.*, 1b.*, 1c.*
  for (const suffix of ['a', 'b', 'c']) {
    for (const ext of IMAGE_EXTENSIONS) {
      const candidate = path.join(imageDir, `${index}${suffix}${ext}`)
      if (fs.existsSync(candidate)) {
        results.push(candidate)
        break
      }
    }
  }

  return results
}

// ─── Build jobs từ Video config ───────────────────────────────────────────────

export interface BuildJobsOptions {
  videoId:       string
  videoTitle:    string
  prompts:       string[]       // từ parsePromptsFromText/File
  config:        VideoConfig
  outputBaseDir: string
  imageDir?:     string         // folder chứa ảnh (nếu mode cần ảnh)
}

/**
 * Tạo mảng GrokJob từ danh sách prompts + config.
 * outputDir = outputBaseDir/videoTitle/ (sẽ tạo folder nếu chưa có)
 * Tên file output = index (1.mp4, 2.mp4, ...)
 */
export function buildJobsFromPrompts(opts: BuildJobsOptions): GrokJob[] {
  const { videoId, videoTitle, prompts, config, outputBaseDir, imageDir } = opts
  const outputDir = path.join(outputBaseDir, videoTitle)

  return prompts.map((prompt, i) => {
    const index  = i + 1                    // 1-based
    const id     = `${videoId}_${index}`
    const title  = `${videoTitle} #${index}`
    const base   = { id, title, prompt, ratio: config.ratio, outputBaseDir: outputDir }

    switch (config.mode) {
      case 'prompt-to-image':
        return { ...base, mode: 'prompt-to-image' } as GrokJob

      case 'prompt-to-video':
        return { ...base, mode: 'prompt-to-video', resolution: config.resolution! } as GrokJob

      case 'image-to-video': {
        if (!imageDir) throw new Error(`image-to-video cần imageDir`)
        const imagePath = resolveImageForIndex(imageDir, index)
        if (!imagePath) throw new Error(`Không tìm thấy ảnh cho prompt #${index} trong: ${imageDir}`)
        return { ...base, mode: 'image-to-video', resolution: config.resolution!, imagePath } as GrokJob
      }

      case 'images-to-image': {
        if (!imageDir) throw new Error(`images-to-image cần imageDir`)
        const imagePaths = resolveImagesForIndex(imageDir, index)
        if (imagePaths.length === 0) throw new Error(`Không tìm thấy ảnh cho prompt #${index} trong: ${imageDir}`)
        return { ...base, mode: 'images-to-image', imagePaths: imagePaths as [string, ...string[]] } as GrokJob
      }
    }
  })
}

// ─── Resolve output filename ──────────────────────────────────────────────────

/**
 * Tên file output theo index: 1.mp4, 2.jpg, ...
 * Không dùng timestamp — dễ sort và map với prompt
 */
export function resolveOutputPath(outputDir: string, index: number, mode: VideoConfig['mode']): string {
  const ext = isVideoOutput({ mode } as any) ? 'mp4' : 'jpg'
  return path.join(outputDir, `${index}.${ext}`)
}