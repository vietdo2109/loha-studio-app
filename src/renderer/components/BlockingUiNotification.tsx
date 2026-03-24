import { useEffect } from 'react'

/**
 * Banner không chặn thao tác — báo khi automation đã tự đóng modal/overlay chặn pointer.
 */
export function BlockingUiNotification({
  stepLabel,
  message,
  onClose,
}: {
  stepLabel: string
  message: string
  onClose: () => void
}) {
  useEffect(() => {
    const t = window.setTimeout(onClose, 14000)
    return () => window.clearTimeout(t)
  }, [stepLabel, message, onClose])

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 520,
        width: 'calc(100% - 32px)',
        zIndex: 10050,
        padding: '14px 16px',
        borderRadius: 10,
        background: 'var(--panel)',
        border: '1px solid rgba(234, 179, 8, 0.45)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            Đã gỡ chặn giao diện — automation tiếp tục
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
            <span style={{ color: 'var(--text3)' }}>Bước: </span>
            {stepLabel}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{message}</div>
        </div>
        <button
          type="button"
          aria-label="Đóng"
          onClick={onClose}
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--text3)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
