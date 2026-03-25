import { useState, useEffect } from 'react'
import { Modal, Btn } from './ui'
import { Icon } from './icons'

export function Veo3ProfilesModal({
  onClose,
  profiles,
  onRefresh,
  onOpenN,
  onOpenSelected,
  onCloseAll,
  onStatus,
}: {
  onClose: () => void
  profiles: { profileId: string; profileDir: string; loggedIn: boolean; email?: string }[]
  onRefresh: () => void
  onOpenN: (n: number) => void
  onOpenSelected: (profileIds: string[]) => void
  onCloseAll: () => void
  onStatus: (profileId: string, loggedIn: boolean, email?: string) => void
}) {
  const [numInput, setNumInput] = useState(3)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  useEffect(() => {
    onRefresh()
  }, [])
  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onVeo3ProfileStatus) return
    const handler = (_e: any, d: { profileId: string; loggedIn: boolean; email?: string }) => {
      onStatus(d.profileId, d.loggedIn, d.email)
    }
    api.onVeo3ProfileStatus(handler)
    return () => { api.removeAllListeners?.('veo3-profile-status') }
  }, [onStatus])

  const handleOpen = () => {
    const n = Math.max(1, Math.min(20, Math.floor(numInput) || 1))
    onOpenN(n)
    onRefresh()
  }

  const toggleSelect = (profileId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }

  const handleOpenSelected = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    onOpenSelected(ids)
    onRefresh()
  }

  const handleDeleteProfile = async (profileId: string) => {
    const api = (window as any).electronAPI
    if (!api?.veo3DeleteProfile) return
    const ok = window.confirm(`Xóa profile ${profileId}? Hành động này sẽ xóa dữ liệu profile trên máy.`)
    if (!ok) return
    setDeletingId(profileId)
    try {
      const res = await api.veo3DeleteProfile(profileId)
      if (!res?.success) {
        window.alert(res?.error ?? `Không xóa được ${profileId}.`)
        return
      }
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(profileId)
        return next
      })
      onRefresh()
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Modal title="Veo3 (Google Flow) — Profiles" onClose={onClose} width={480}>
      <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
        Mở N profile trình duyệt, đăng nhập Google thủ công (Flow → Get started / đăng nhập). Có thể mở tab mới tới Flow nếu tab pricing bị vòng lặp — tool nhận diện theo mọi tab Flow đã đăng nhập và gắn automation đúng tab.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <input
          type="number"
          min={1}
          max={20}
          value={numInput}
          onChange={(e) => setNumInput(Number(e.target.value) || 1)}
          style={{
            width: 56, padding: "6px 8px", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", fontSize: 13,
          }}
        />
        <Btn onClick={handleOpen} variant="primary">Mở N profiles</Btn>
        <Btn onClick={onRefresh} variant="ghost" size="sm">Làm mới</Btn>
        {profiles.length > 0 && (
          <Btn onClick={onCloseAll} variant="ghost" size="sm">Đóng tất cả</Btn>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Profiles ({profiles.length})</div>
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {profiles.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
            Chưa có profile. Nhập số và nhấn "Mở N profiles".
          </div>
        ) : (
          profiles.map((p) => (
            <div
              key={p.profileId}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                background: p.loggedIn ? "var(--accent2-bg)" : "var(--bg2)",
                border: `1px solid ${p.loggedIn ? "#86efac" : "var(--border)"}`,
                borderRadius: "var(--radius)",
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(p.profileId)}
                onChange={() => toggleSelect(p.profileId)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <Icon.Dot color={p.loggedIn ? "#22c55e" : "#d1d5db"} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{p.profileId}</span>
              <span style={{ fontSize: 11, color: p.loggedIn ? "var(--accent2)" : "var(--text3)" }}>
                {p.loggedIn ? (p.email ? `Đã đăng nhập: ${p.email}` : "Đã đăng nhập Google") : "Chưa đăng nhập"}
              </span>
              <div style={{ marginLeft: "auto" }}>
                <Btn
                  size="sm"
                  variant="danger"
                  onClick={() => handleDeleteProfile(p.profileId)}
                  disabled={deletingId != null}
                  title="Xóa profile này khỏi máy"
                >
                  {deletingId === p.profileId ? "Đang xóa..." : "Xóa"}
                </Btn>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        {profiles.length > 0 && selectedIds.size > 0 && (
          <Btn onClick={handleOpenSelected} variant="primary">Mở các profile được chọn</Btn>
        )}
        <Btn onClick={onClose}>Đóng</Btn>
      </div>
    </Modal>
  )
}
