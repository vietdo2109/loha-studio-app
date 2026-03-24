/**
 * Theo dõi nhẹ trên trang Flow (trong Chrome automation):
 * - Tab bị ẩn (visibilitychange) — đổi tab, thu nhỏ, Alt+Tab
 * - Thao tác chuột/bàn phím/lăn từ người (isTrusted) — không phải do script
 *
 * Ghi qua flowEmit → file flow-actions-*.log (không lộ selector).
 * Giúp giải thích lỗi timeout / Step 4 khi user vô tình can thiệp.
 */

import type { Page } from 'patchright'
import { flowEmit } from './flowActionLog'

const installed = new WeakSet<Page>()

function handlePayload(payload: { type: string; detail?: string; ts: number }): void {
  const { type, detail } = payload
  if (type === 'visibility') {
    if (detail === 'hidden') {
      flowEmit(
        'warn',
        'Phát hiện tab Flow bị ẩn (đổi tab khác, thu nhỏ cửa sổ Chrome, hoặc Alt+Tab). Thao tác tự động có thể timeout hoặc lệch bước.'
      )
    } else if (detail === 'visible') {
      flowEmit('detail', 'Tab Flow hiển thị lại.')
    }
    return
  }
  if (type === 'trusted_input') {
    flowEmit(
      'warn',
      `Phát hiện thao tác tay trên trang (${detail ?? 'input'}) trong khi automation đang chạy — có thể làm lệch bước tiếp theo (vd. Step 4 không tìm thấy nút).`
    )
  }
}

/**
 * Gắn một lần / Page. An toàn gọi lại (bỏ qua nếu đã gắn).
 */
export async function installFlowUserInterferenceMonitor(page: Page): Promise<void> {
  if (installed.has(page)) return

  const handler = (payload: { type: string; detail?: string; ts: number }) => {
    try {
      handlePayload(payload)
    } catch {
      /* ignore */
    }
  }

  try {
    await page.exposeFunction('__flowReportUserInterference', handler)
  } catch (e) {
    const msg = String(e)
    if (!/already|registered|exists/i.test(msg)) throw e
  }

  await page.evaluate(() => {
    const w = window as unknown as Window & {
      __flowInterferenceInstalled?: boolean
      __lastTrustedInput?: number
      __flowTrustGraceUntil?: number
      __flowReportUserInterference?: (p: { type: string; detail?: string; ts: number }) => Promise<void>
    }
    if (w.__flowInterferenceInstalled) return
    w.__flowInterferenceInstalled = true
    /** Bỏ qua cảnh báo "tay" trong lúc automation/khởi động — pointer isTrusted đôi khi true (focus, dialog OS, CDP). */
    const TRUSTED_GRACE_AFTER_INSTALL_MS = 45_000
    /** Sau khi tab ẩn (hộp chọn file, Alt+Tab…), bỏ qua thêm — tránh báo nhầm khi focus trả lại. */
    const TRUSTED_GRACE_AFTER_HIDDEN_MS = 20_000
    w.__flowTrustGraceUntil = Date.now() + TRUSTED_GRACE_AFTER_INSTALL_MS

    const report = (type: string, detail?: string) => {
      const fn = w.__flowReportUserInterference
      if (typeof fn !== 'function') return
      void fn({ type, detail, ts: Date.now() }).catch(() => {})
    }

    let lastVis = 0
    const VIS_THROTTLE_MS = 2500
    document.addEventListener(
      'visibilitychange',
      () => {
        const now = Date.now()
        if (now - lastVis < VIS_THROTTLE_MS && document.visibilityState === 'visible') return
        lastVis = now
        if (document.visibilityState === 'hidden') {
          w.__flowTrustGraceUntil = Math.max(
            w.__flowTrustGraceUntil ?? 0,
            now + TRUSTED_GRACE_AFTER_HIDDEN_MS
          )
        }
        report('visibility', document.visibilityState)
      },
      true
    )

    /** Chỉ pointerdown: keydown/wheel dễ nhiễu (IME, scroll, focus). */
    const TRUSTED_INPUT_THROTTLE_MS = 4000
    const onTrustedPointer = (e: Event) => {
      if (!e.isTrusted || e.type !== 'pointerdown') return
      const now = Date.now()
      if (now < (w.__flowTrustGraceUntil ?? 0)) return
      if (!w.__lastTrustedInput) w.__lastTrustedInput = 0
      if (now - w.__lastTrustedInput < TRUSTED_INPUT_THROTTLE_MS) return
      w.__lastTrustedInput = now
      report('trusted_input', e.type)
    }
    window.addEventListener('pointerdown', onTrustedPointer, true)
  })

  installed.add(page)
  flowEmit(
    'detail',
    'Đã bật theo dõi môi trường: tab ẩn + thao tác tay trên trang (chỉ ghi file log khi có sự kiện).'
  )
}
