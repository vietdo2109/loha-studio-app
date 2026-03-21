import { useState, useEffect } from "react"
import { Modal, Btn } from "./ui"
import { Icon } from "./icons"

export type GrokProfileRow = {
  profileId: string
  profileDir: string
  loggedIn: boolean
  email?: string
  error?: string
  runStatus?: "running" | "failed"
}

export function GrokProfilesModal({
  onClose,
  profiles,
  onRefresh,
  onOpenN,
  onOpenSelected,
  onCloseAll,
  onStatus,
  allowGrok,
}: {
  onClose: () => void
  profiles: GrokProfileRow[]
  onRefresh: () => void
  onOpenN: (n: number) => void
  onOpenSelected: (profileIds: string[]) => void
  onCloseAll: () => void
  onStatus: (profileId: string, loggedIn: boolean, email?: string) => void
  allowGrok: boolean
}) {
  const [numInput, setNumInput] = useState(3)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    onRefresh()
  }, [])

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onGrokProfileStatus) return
    const handler = (_e: any, d: { profileId: string; loggedIn: boolean; email?: string }) => {
      onStatus(d.profileId, d.loggedIn, d.email)
    }
    api.onGrokProfileStatus(handler)
    return () => { api.removeAllListeners?.("grok-profile-status") }
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

  return (
    <Modal title="Grok (Imagine) — Profiles" onClose={onClose} width={480}>
      <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
        Mở N profile Chrome, đăng nhập xAI/Grok thủ công trên <b>grok.com/imagine</b>. Tool lưu profile dưới <span style={{ fontFamily: "var(--mono)" }}>profiles/grok/profile-001…</span> và nhận diện đã đăng nhập (giống Veo3).
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="number"
          min={1}
          max={20}
          value={numInput}
          disabled={!allowGrok}
          onChange={e => setNumInput(Number(e.target.value) || 1)}
          style={{
            width: 56, padding: "6px 8px", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", fontSize: 13,
            background: "var(--surface)", color: "var(--text)",
          }}
        />
        <Btn onClick={handleOpen} variant="primary" disabled={!allowGrok} title={allowGrok ? undefined : "License không bật Grok"}>Mở N profiles</Btn>
        <Btn onClick={onRefresh} variant="ghost" size="sm" disabled={!allowGrok}>Làm mới</Btn>
        {profiles.length > 0 && (
          <Btn onClick={onCloseAll} variant="ghost" size="sm" disabled={!allowGrok}>Đóng tất cả</Btn>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Profiles ({profiles.length})</div>
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {profiles.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
            Chưa có profile. Nhập số và nhấn &quot;Mở N profiles&quot;.
          </div>
        ) : (
          profiles.map(p => (
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
              <Icon.Dot color={p.runStatus === "running" ? "#f59e0b" : p.loggedIn ? "#22c55e" : "#d1d5db"} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{p.profileId}</span>
              <span style={{ fontSize: 11, color: p.loggedIn ? "var(--accent2)" : "var(--text3)", flex: 1, minWidth: 0 }}>
                {p.runStatus === "running" && "Đang chạy job… "}
                {p.runStatus === "failed" && (p.error ? `Lỗi: ${p.error}` : "Lỗi")}
                {!p.runStatus && (p.loggedIn ? (p.email ? `Đã đăng nhập: ${p.email}` : "Đã đăng nhập Grok") : "Chưa đăng nhập")}
              </span>
            </div>
          ))
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        {profiles.length > 0 && selectedIds.size > 0 && (
          <Btn onClick={handleOpenSelected} variant="primary" disabled={!allowGrok}>Mở các profile được chọn</Btn>
        )}
        <Btn onClick={onClose}>Đóng</Btn>
      </div>
    </Modal>
  )
}
