/**
 * Thông báo renderer khi automation đóng modal/overlay chặn thao tác (chỉ khi main gắn sink).
 */

export type BlockingUiNotifyPayload = {
  kind: 'blocking-dismissed'
  stepLabel: string
  message: string
}

type Sink = (p: BlockingUiNotifyPayload) => void

let sink: Sink | null = null

export function setBlockingUiNotify(next: Sink | null): void {
  sink = next
}

export function emitBlockingUiDismissed(stepLabel: string, message: string): void {
  try {
    sink?.({ kind: 'blocking-dismissed', stepLabel, message })
  } catch {
    /* ignore */
  }
}
