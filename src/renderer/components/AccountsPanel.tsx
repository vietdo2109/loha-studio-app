import type { Account, AcctStatus } from '../types'
import { Btn, Tag } from './ui'
import { Icon } from './icons'

export function AccountsPanel({ accounts, credFile, onLoadCred }: {
  accounts: Account[]; credFile: string; onLoadCred: () => void
}) {
  const statusColor: Record<AcctStatus, string> = {
    idle:       "#d1d5db",
    logging_in: "#3b82f6",
    ready:      "#22c55e",
    failed:     "#ef4444",
    running:    "#f59e0b",
  }
  const statusLabel: Record<AcctStatus, string> = {
    idle:       "Chưa kết nối",
    logging_in: "Đang đăng nhập...",
    ready:      "Sẵn sàng",
    failed:     "Thất bại",
    running:    "Đang chạy",
  }

  const ready   = accounts.filter(a => a.status === "ready").length
  const failed  = accounts.filter(a => a.status === "failed").length
  const running = accounts.filter(a => a.status === "logging_in").length

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 14, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Tài khoản</span>
        <div style={{ display: "flex", gap: 5 }}>
          {ready > 0   && <Tag color="green">{ready} sẵn sàng</Tag>}
          {running > 0 && <Tag color="blue">{running} đang kết nối</Tag>}
          {failed > 0  && <Tag color="orange">{failed} lỗi</Tag>}
        </div>
      </div>

      <div style={{
        padding: "10px 12px", background: "var(--bg2)", borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>File credentials</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{
            flex: 1, fontSize: 12, fontFamily: "var(--mono)", color: credFile ? "var(--text)" : "var(--text3)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {credFile ? credFile.split(/[/\\]/).pop() : "Chưa chọn file..."}
          </div>
          <Btn size="sm" onClick={onLoadCred}><Icon.File /> Chọn file</Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {accounts.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 12, padding: "24px 0" }}>
            Chưa có tài khoản nào
          </div>
        ) : accounts.map(a => (
          <div key={a.id} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
            background: "var(--surface)", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", animation: "slideIn .15s ease",
          }}>
            <Icon.Dot color={statusColor[a.status]}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.email}
              </div>
              {a.status === "logging_in" && (
                <div style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <Icon.Spin /> Đang đăng nhập...
                </div>
              )}
              {a.status === "failed" && a.error && (
                <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>{a.error}</div>
              )}
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: statusColor[a.status] }}>
              {statusLabel[a.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
