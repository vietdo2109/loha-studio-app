import { useState, useEffect, useCallback } from 'react'
import { Modal, Btn } from './ui'
import { Icon } from './icons'

type WarmingState = {
  status: 'idle' | 'warming' | 'done' | 'error'
  current?: number
  total?: number
  siteName?: string
  visited?: number
  warmed?: boolean
  lastWarmedAt?: number
  stale?: boolean
}

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
  const [warmingStates, setWarmingStates] = useState<Record<string, WarmingState>>({})
  const [warmingAll, setWarmingAll] = useState(false)

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

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onVeo3WarmingStatus) return
    const handler = (_e: any, d: any) => {
      setWarmingStates(prev => {
        const next = { ...prev }
        const cur = next[d.profileId] ?? { status: 'idle' }
        if (d.status === 'started') {
          next[d.profileId] = { ...cur, status: 'warming', current: 0, total: 0 }
        } else if (d.status === 'progress') {
          next[d.profileId] = { ...cur, status: 'warming', current: d.current, total: d.total, siteName: d.siteName }
        } else if (d.status === 'done') {
          next[d.profileId] = { ...cur, status: 'done', visited: d.visited, warmed: true, lastWarmedAt: Date.now(), stale: false }
        } else if (d.status === 'error') {
          next[d.profileId] = { ...cur, status: 'error' }
        }
        return next
      })
    }
    api.onVeo3WarmingStatus(handler)
    return () => { api.removeAllListeners?.('veo3-warming-status') }
  }, [])

  const loadWarmingStatus = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.veo3GetWarmingStatus) return
    for (const p of profiles) {
      const res = await api.veo3GetWarmingStatus(p.profileId)
      if (res) {
        setWarmingStates(prev => ({
          ...prev,
          [p.profileId]: {
            ...prev[p.profileId],
            status: res.isWarming ? 'warming' : (prev[p.profileId]?.status ?? 'idle'),
            warmed: res.warmed,
            lastWarmedAt: res.lastWarmedAt,
            stale: res.stale,
          }
        }))
      }
    }
  }, [profiles])

  useEffect(() => { loadWarmingStatus() }, [loadWarmingStatus])

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

  const handleWarmProfile = async (profileId: string) => {
    const api = (window as any).electronAPI
    if (!api?.veo3WarmProfile) return
    await api.veo3WarmProfile(profileId)
  }

  const handleWarmAll = async () => {
    const api = (window as any).electronAPI
    if (!api?.veo3WarmAllProfiles) return
    setWarmingAll(true)
    try {
      await api.veo3WarmAllProfiles()
    } finally {
      setWarmingAll(false)
    }
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
    <Modal title="Veo3 (Google Flow) — Profiles" onClose={onClose} width={540}>
      <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
        Mở N profile trình duyệt, đăng nhập Google thủ công (Flow → Get started / đăng nhập). Có thể mở tab mới tới Flow nếu tab pricing bị vòng lặp — tool nhận diện theo mọi tab Flow đã đăng nhập và gắn automation đúng tab.
      </p>
      <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>
        <strong>Profile Warming:</strong> Lần đầu dùng profile mới, nhấn "Warm" để ghé thăm 15-20 site phổ biến (có GA) giúp profile trông giống người dùng thật, tăng reCAPTCHA trust score. Đăng nhập Google/YouTube trên profile trước khi warm để hiệu quả hơn. Cookie tự động làm mới mỗi ngày khi chạy queue.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
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
          <>
            <Btn onClick={onCloseAll} variant="ghost" size="sm">Đóng tất cả</Btn>
            <Btn onClick={handleWarmAll} variant="ghost" size="sm" disabled={warmingAll}>
              {warmingAll ? "Đang warm..." : "Warm tất cả"}
            </Btn>
          </>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Profiles ({profiles.length})</div>
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {profiles.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
            Chưa có profile. Nhập số và nhấn "Mở N profiles".
          </div>
        ) : (
          profiles.map((p) => {
            const ws = warmingStates[p.profileId]
            const isWarming = ws?.status === 'warming'
            const isWarmed = ws?.warmed ?? false
            const isStale = ws?.stale ?? true
            const warmLabel = isWarming
              ? `Warming ${ws?.current ?? 0}/${ws?.total ?? '?'}${ws?.siteName ? ` — ${ws.siteName}` : ''}`
              : isWarmed && !isStale
                ? 'Warmed'
                : isStale && isWarmed
                  ? 'Cần làm mới'
                  : 'Chưa qua bước làm nóng'
            const warmColor = isWarming ? '#f59e0b' : isWarmed && !isStale ? '#22c55e' : '#ef4444'

            return (
              <div
                key={p.profileId}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  background: p.loggedIn ? "var(--accent2-bg)" : "var(--bg2)",
                  border: `1px solid ${p.loggedIn ? "#86efac" : "var(--border)"}`,
                  borderRadius: "var(--radius)",
                  flexWrap: "wrap",
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
                <span style={{ fontSize: 10, color: warmColor, fontWeight: 500 }} title={
                  ws?.lastWarmedAt ? `Warmed lần cuối: ${new Date(ws.lastWarmedAt).toLocaleString()}` : 'Chưa warm lần nào'
                }>
                  {warmLabel}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => handleWarmProfile(p.profileId)}
                    disabled={isWarming || deletingId != null}
                    title="Warm profile: ghé thăm 15-20 website phổ biến để xây dựng cookie & lịch sử"
                  >
                    {isWarming ? "Warming..." : "Warm"}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    onClick={() => handleDeleteProfile(p.profileId)}
                    disabled={deletingId != null || isWarming}
                    title="Xóa profile này khỏi máy"
                  >
                    {deletingId === p.profileId ? "Đang xóa..." : "Xóa"}
                  </Btn>
                </div>
              </div>
            )
          })
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
