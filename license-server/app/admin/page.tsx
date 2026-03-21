"use client"

import { useEffect, useMemo, useState } from 'react'

type Item = {
  id: string
  key_preview: string
  key_phone_tag?: string
  role: 'user' | 'admin'
  expires_at: number
  revoked: boolean
  created_at: number
  created_by?: string
  note?: string
  bound_device_id?: string
  activated_at?: number
  last_seen_at?: number
  grok_active?: boolean
  veo_active?: boolean
  sora_active?: boolean
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('')
  const [count, setCount] = useState(1)
  const [days, setDays] = useState(2)
  const [phoneTag, setPhoneTag] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [note, setNote] = useState('')
  const [generated, setGenerated] = useState<Array<{ id: string; key: string; role: string; expiresAt: number }>>([])
  const [items, setItems] = useState<Item[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<Item | null>(null)
  const [createGrok, setCreateGrok] = useState(true)
  const [createVeo, setCreateVeo] = useState(true)
  const [createSora, setCreateSora] = useState(false)

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'x-admin-key': adminKey }), [adminKey])

  const updateFeatures = async (id: string, patch: { grokActive?: boolean; veoActive?: boolean; soraActive?: boolean }) => {
    const res = await fetch('/api/admin/keys/update-features', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, ...patch }),
    })
    const data = await res.json()
    if (!res.ok || !data?.ok) throw new Error(data?.reason || `HTTP_${res.status}`)
    await refresh()
  }

  const refresh = async (nextPage?: number) => {
    if (!adminKey) return
    const pageToLoad = Math.max(1, nextPage ?? page)
    const params = new URLSearchParams({
      page: String(pageToLoad),
      pageSize: String(pageSize),
      q: query.trim(),
    })
    const res = await fetch(`/api/admin/keys/list?${params.toString()}`, { headers: { 'x-admin-key': adminKey } })
    const data = await res.json()
    if (!res.ok || !data?.ok) throw new Error(data?.reason || `HTTP_${res.status}`)
    setItems(data.items || [])
    setPage(Number(data.page || pageToLoad))
    setPageSize(Number(data.pageSize || pageSize))
    setTotal(Number(data.total || 0))
    setTotalPages(Number(data.totalPages || 1))
  }

  useEffect(() => {
    setGenerated([])
    setItems([])
    setPage(1)
    setTotal(0)
    setTotalPages(1)
  }, [adminKey])

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    try {
      setBusy(true)
      setError('')
      const res = await fetch('/api/admin/keys/revoke', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: revokeTarget.id }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.reason || `HTTP_${res.status}`)
      await refresh()
      setRevokeTarget(null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="container" style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Quản lý license</h2>
        <div className="row">
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin API key"
            style={{ minWidth: 320 }}
          />
          <button
            onClick={async () => {
              try {
                setBusy(true)
                setError('')
                await refresh()
              } catch (e: any) {
                setError(e?.message || String(e))
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy || !adminKey}
          >
            Kết nối
          </button>
        </div>
        {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Tạo key</h3>
        <div className="row">
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#4b5563' }}>Số lượng key</label>
            <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value || 1))} placeholder="Số lượng key" />
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#4b5563' }}>Số ngày hiệu lực</label>
            <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value || 2))} placeholder="Số ngày" />
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#4b5563' }}>Số điện thoại (gắn vào key)</label>
            <input
              value={phoneTag}
              onChange={(e) => setPhoneTag(e.target.value.replace(/\D+/g, ''))}
              placeholder="Ví dụ: 0987654321"
              style={{ minWidth: 180 }}
            />
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (optional)" style={{ minWidth: 220 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={createVeo} onChange={(e) => setCreateVeo(e.target.checked)} /> Veo
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={createGrok} onChange={(e) => setCreateGrok(e.target.checked)} /> Grok
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={createSora} onChange={(e) => setCreateSora(e.target.checked)} /> Sora
          </label>
          <button
            disabled={busy || !adminKey || phoneTag.trim().length < 6}
            onClick={async () => {
              try {
                setBusy(true)
                setError('')
                const res = await fetch('/api/admin/keys/create', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    count,
                    durationDays: days,
                    phoneTag,
                    role,
                    note,
                    createdBy: 'admin-web',
                    veoActive: createVeo,
                    grokActive: createGrok,
                    soraActive: createSora,
                  }),
                })
                const data = await res.json()
                if (!res.ok || !data?.ok) throw new Error(data?.reason || `HTTP_${res.status}`)
                setGenerated(data.generated || [])
                await refresh(1)
              } catch (e: any) {
                setError(e?.message || String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Tạo key
          </button>
        </div>
        {generated.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 600 }}>Keys vừa tạo (copy gửi cho khách):</div>
            {generated.map((g) => (
              <div key={g.id} style={{ fontSize: 13, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                <div><b>key:</b> <code>{g.key}</code></div>
                <div><b>expires:</b> {new Date(g.expiresAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Danh sách license</h3>
          <div className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: phone / preview / note"
              style={{ minWidth: 240 }}
            />
            <select
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value))}
              title="Rows per page"
            >
              <option value="10">10 / page</option>
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
            </select>
            <button
              disabled={busy || !adminKey}
              onClick={async () => {
                try {
                  setBusy(true)
                  setError('')
                  await refresh(1)
                } catch (e: any) {
                  setError(e?.message || String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Search
            </button>
            <button disabled={busy || !adminKey} onClick={() => refresh(page)}>Refresh</button>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#4b5563' }}>
          Tổng: {total} key(s) • Trang {page}/{totalPages}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Phone</th>
                <th>Veo</th>
                <th>Grok</th>
                <th>Sora</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Device</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.key_preview}</td>
                  <td>{it.key_phone_tag || '-'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={it.veo_active !== false}
                      disabled={busy || it.revoked || !adminKey}
                      onChange={async (e) => {
                        try {
                          setBusy(true)
                          setError('')
                          await updateFeatures(it.id, { veoActive: e.target.checked })
                        } catch (err: any) {
                          setError(err?.message || String(err))
                        } finally {
                          setBusy(false)
                        }
                      }}
                      title="Veo3 / Flow"
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={it.grok_active !== false}
                      disabled={busy || it.revoked || !adminKey}
                      onChange={async (e) => {
                        try {
                          setBusy(true)
                          setError('')
                          await updateFeatures(it.id, { grokActive: e.target.checked })
                        } catch (err: any) {
                          setError(err?.message || String(err))
                        } finally {
                          setBusy(false)
                        }
                      }}
                      title="Grok Imagine"
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={it.sora_active === true}
                      disabled={busy || it.revoked || !adminKey}
                      onChange={async (e) => {
                        try {
                          setBusy(true)
                          setError('')
                          await updateFeatures(it.id, { soraActive: e.target.checked })
                        } catch (err: any) {
                          setError(err?.message || String(err))
                        } finally {
                          setBusy(false)
                        }
                      }}
                      title="Sora (khi có trong app)"
                    />
                  </td>
                  <td>{it.role}</td>
                  <td>{new Date(Number(it.expires_at)).toLocaleString()}</td>
                  <td>{it.revoked ? 'revoked' : 'active'}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.bound_device_id || '-'}</td>
                  <td>{it.last_seen_at ? new Date(Number(it.last_seen_at)).toLocaleString() : '-'}</td>
                  <td>
                    <button
                      disabled={busy || it.revoked || !adminKey}
                      onClick={() => setRevokeTarget(it)}
                      style={{
                        background: '#dc2626',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        lineHeight: 1.2,
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            disabled={busy || !adminKey || page <= 1}
            onClick={() => refresh(page - 1)}
            style={{ background: '#6b7280' }}
          >
            Prev
          </button>
          <button
            disabled={busy || !adminKey || page >= totalPages}
            onClick={() => refresh(page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {revokeTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
          }}
          onClick={() => !busy && setRevokeTarget(null)}
        >
          <div
            className="card"
            style={{ width: 'min(480px, 92vw)', display: 'grid', gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, color: '#b91c1c' }}>Xác nhận revoke key</h3>
            <div style={{ fontSize: 13 }}>
              Bạn có chắc muốn revoke key <code>{revokeTarget.key_preview}</code>?
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Hành động này sẽ chặn key ở lần kiểm tra license tiếp theo.
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                disabled={busy}
                style={{ background: '#6b7280' }}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmRevoke}
                disabled={busy}
                style={{ background: '#dc2626' }}
              >
                {busy ? 'Đang revoke...' : 'Xác nhận revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
