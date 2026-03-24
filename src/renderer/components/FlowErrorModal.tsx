import { Modal, Btn, ModalLabel, ModalRow } from './ui'

/**
 * Modal lỗi tự động — không hiển thị selector/stack; nhắc không can thiệp + liên hệ admin.
 */
export function FlowErrorModal({
  onClose,
  stepLabel,
  message,
  failureIndex,
  screenshotPath,
}: {
  onClose: () => void
  stepLabel: string
  message: string
  /** Thứ tự lỗi trong phiên (1, 2, …) khi nhiều job lỗi */
  failureIndex?: number
  /** Ảnh chụp trang Flow (full page) khi lỗi — lưu trong thư mục log */
  screenshotPath?: string
}) {
  return (
    <Modal title="Không thể hoàn tất tự động" onClose={onClose} width={480}>
      <ModalRow>
        <ModalLabel>Bước xảy ra lỗi</ModalLabel>
        <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>{stepLabel}</div>
      </ModalRow>
      <ModalRow>
        <ModalLabel>Mô tả ngắn gọn</ModalLabel>
        <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.55 }}>{message}</div>
      </ModalRow>
      {screenshotPath != null && screenshotPath.length > 0 && (
        <ModalRow>
          <ModalLabel>Ảnh màn hình lỗi</ModalLabel>
          <div style={{ fontSize: 12, color: "var(--text3)", wordBreak: "break-all", lineHeight: 1.45 }}>
            Đã lưu PNG (toàn bộ trang): {screenshotPath}
          </div>
        </ModalRow>
      )}
      {failureIndex != null && failureIndex > 1 && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
          Đây là lỗi thứ {failureIndex} trong phiên chạy — nhiều job có thể đã thất bại tương tự.
        </div>
      )}
      <ModalRow>
        <ModalLabel>Lưu ý quan trọng</ModalLabel>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>
          <li>Khi tool đang chạy, không dùng chuột/bàn phím trên cửa sổ trình duyệt tự động, không thu nhỏ hoặc che khuất cửa sổ.</li>
          <li>Can thiệp tay có thể làm lệch thao tác và gây lỗi lặp lại.</li>
        </ul>
      </ModalRow>
      <ModalRow style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
          Nếu lỗi vẫn xảy ra khi bạn đã để trang tải xong và không thao tác trên cửa sổ đó, vui lòng liên hệ admin và gửi file log trong thư mục log của ứng dụng.
        </div>
      </ModalRow>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => (window as any).electronAPI?.openLogFolder?.()}
          >
            Mở thư mục log
          </Btn>
          {screenshotPath != null && screenshotPath.length > 0 && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => (window as any).electronAPI?.showItemInFolder?.(screenshotPath)}
            >
              Mở ảnh trong Explorer
            </Btn>
          )}
        </div>
        <Btn variant="primary" onClick={onClose}>Đã hiểu</Btn>
      </div>
    </Modal>
  )
}
