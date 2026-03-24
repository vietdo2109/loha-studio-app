/**
 * Nhật ký thao tác Flow (Veo3) — dễ đọc cho người dùng, vẫn giữ dòng kỹ thuật khi cần debug.
 * Main process gắn sink (IPC + file); automation chỉ gọi emit*.
 * Dòng ghi file/console: không dấu (logAsciiVi) để terminal Windows đọc ổn định.
 */

import { logAsciiVi } from './logAsciiVi'

export type FlowLogKind = 'action' | 'detail' | 'info' | 'warn' | 'error' | 'ok'

export interface FlowLogPayload {
  kind: FlowLogKind
  /** Dòng chính (ưu tiên tiếng Việt, dễ hiểu) */
  message: string
  /** Chi tiết kỹ thuật (selector, timeout, stack rút gọn) */
  tech?: string
  ts: number
}

type FlowLogSink = (payload: FlowLogPayload) => void

let sink: FlowLogSink | null = null
let context: { projectId?: string; jobId?: string } = {}

export function setFlowLogSink(next: FlowLogSink | null): void {
  sink = next
}

export function setFlowLogContext(c: { projectId?: string; jobId?: string }): void {
  context = { ...c }
}

export function clearFlowLogContext(): void {
  context = {}
}

/** Gửi một dòng có cấu trúc (hiển thị + file + IPC nếu đã gắn sink). */
export function flowEmit(kind: FlowLogKind, message: string, tech?: string): void {
  const payload: FlowLogPayload = {
    kind,
    message,
    tech,
    ts: Date.now(),
  }
  const prefix = `[Flow ${context.projectId ? `${context.projectId.slice(0, 8)} ` : ''}]`
  const line = `${tech ? `${message} | ${tech}` : message}`
  if (kind === 'error') console.error(prefix, line)
  else if (kind === 'warn') console.warn(prefix, line)
  else console.log(prefix, `[${kind}]`, line)
  try {
    sink?.(payload)
  } catch {
    /* ignore */
  }
}

/** Ghi lỗi ngay sau một thao tác (message đã gắn với ngữ cảnh). */
export function flowEmitError(err: unknown, doingWhat: string): void {
  const { user, tech } = humanizePlaywrightError(err)
  flowEmit('error', `Lỗi khi ${doingWhat}: ${user}`, tech)
}

export function formatPayloadForFile(p: FlowLogPayload): string {
  const iso = new Date(p.ts).toISOString()
  const msg = logAsciiVi(p.message)
  const tech = p.tech !== undefined ? logAsciiVi(p.tech) : undefined
  const base = `${iso} [${p.kind.toUpperCase()}] ${msg}`
  if (tech) return `${base}\n  -> Ky thuat: ${tech}\n`
  return `${base}\n`
}

/**
 * Chuyển lỗi Playwright/DOM sang mô tả ngắn (user) + nguyên bản rút gọn (tech).
 */
export function humanizePlaywrightError(err: unknown): { user: string; tech: string } {
  const tech = err instanceof Error ? err.message : String(err)
  const t = tech.toLowerCase()

  if (/target page.*closed|browser has been closed|context.*closed|page.*closed/i.test(tech)) {
    return {
      user: 'Cửa sổ trình duyệt đã đóng hoặc mất kết nối. Hãy mở lại profile Veo3 và chạy lại.',
      tech,
    }
  }
  if (/timeout|exceeded/i.test(t) && /waiting|locator|selector/i.test(t)) {
    return {
      user:
        'Hết thời gian chờ — nút hoặc vùng cần thao tác không xuất hiện kịp. Thử: đợi trang Flow tải xong, không che cửa sổ, rồi chạy lại.',
      tech,
    }
  }
  if (/timeout/i.test(t)) {
    return {
      user: 'Thao tác mất quá lâu (timeout). Mạng hoặc giao diện Google Flow có thể đang chậm.',
      tech,
    }
  }
  if (/not (visible|attached|enabled)|strict mode violation|element is not visible/i.test(t)) {
    return {
      user: 'Không tương tác được phần tử trên trang — giao diện có thể đã đổi hoặc có hộp thoại che.',
      tech,
    }
  }
  if (/navigation|net::|failed to fetch/i.test(t)) {
    return {
      user: 'Lỗi tải trang hoặc mạng. Kiểm tra kết nối và thử lại.',
      tech,
    }
  }

  return {
    user: 'Có lỗi khi tự động thao tác trên Flow. Nếu lỗi lặp lại, hãy gửi file log trong thư mục log cho admin.',
    tech,
  }
}

/**
 * Suy ra bước nghiệp vụ (tiếng Việt, không lộ selector) từ nội dung lỗi — dùng cho modal người dùng.
 */
export function describeFlowStepFromError(err: unknown): string {
  const tech = err instanceof Error ? err.message : String(err)
  const s = tech
  if (/Step 4 hard stop|step 4|add images from ordered|flowAddImage|Thêm vào câu lệnh|Bắt đầu.*dialog|slot.*picker/i.test(s)) {
    return 'Bước 4 — Thêm ảnh vào prompt (khung Bắt đầu / Kết thúc, chọn ảnh đã tải)'
  }
  if (/Step 5|Paste prompt|submit|promptInput|flowTypePrompt/i.test(s)) {
    return 'Bước 5 — Nhập prompt và gửi lệnh tạo'
  }
  if (/Step 3|flowUpload|content dialog|setInputFiles|upload.*image|Tải hình/i.test(s)) {
    return 'Bước 3 — Tải ảnh lên Flow (hộp thoại nội dung)'
  }
  if (/Step 2|setVideoMode|setImageMode|Video mode|Ingredients|Frames/i.test(s)) {
    return 'Bước 2 — Chọn chế độ Video / Hình ảnh và cài đặt'
  }
  if (/Step 1|new project|Dự án mới|flowClickNewProject/i.test(s)) {
    return 'Bước 1 — Tạo dự án mới trên Flow'
  }
  if (/download|1080p|4k|720p|upscale|edit tab|flowWaitAndDownload/i.test(s)) {
    return 'Bước tải video / độ phân giải'
  }
  return 'Trong quá trình chạy tự động trên Google Flow'
}

/** Bọc async: log bước → lỗi gắn ngay dưới nếu throw. */
export async function withFlowAction<T>(title: string, detail: string | undefined, fn: () => Promise<T>): Promise<T> {
  flowEmit('action', title, detail)
  try {
    const r = await fn()
    flowEmit('ok', `Xong: ${title}`)
    return r
  } catch (e) {
    flowEmitError(e, title)
    throw e
  }
}
