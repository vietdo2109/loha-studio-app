/**
 * Chụp ảnh trang Flow (full page scroll) khi automation lỗi — lưu cạnh file log.
 */
import * as path from 'path'
import type { Page } from 'patchright'

export async function captureVeo3FlowPageScreenshot(
  page: Page | null | undefined,
  logDir: string | null | undefined,
  label: string
): Promise<string | null> {
  if (!page || !logDir) return null
  try {
    if (page.isClosed()) return null
  } catch {
    return null
  }
  const safe = label.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'error'
  const fp = path.join(logDir, `flow-error-${Date.now()}-${safe}.png`)
  try {
    await page.screenshot({ path: fp, fullPage: true })
    return fp
  } catch {
    return null
  }
}
