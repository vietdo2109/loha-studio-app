import { useState, useEffect, useCallback } from "react"
import type { Platform, AppPanel, Project, QueueProject, QueueJob, JobStatus, Account, AcctStatus, Veo3Project, Veo3QueueProject, Veo3QueueJob, Script } from "./types"
import { GlobalStyle } from "./GlobalStyle"
import {
  Icon,
  Btn,
  Checkbox,
  ProjectRow,
  QueueProjectRow,
  NewProjectModal,
  JobDetailModal,
  Veo3ProjectRow,
  Veo3NewProjectModal,
  Veo3ScriptModal,
  Veo3QueueProjectRow,
  Veo3ProfilesModal,
  AccountsPanel,
  ErrorPanel,
} from "./components"

export default function App() {
  type ActivationStatus = {
    activated: boolean
    role?: "user" | "admin"
    subject?: string
    keyCode?: string
    expiresAt?: number
    lastCheckedAt?: number
    reason?: string
    deviceId?: string
    apiBaseUrl?: string
    adminUrl?: string
  }
  const [platform,        setPlatform]        = useState<Platform>("Veo3")
  const [activePanel,     setActivePanel]     = useState<AppPanel>("projects")
  // Grok
  const [projects,        setProjects]        = useState<Project[]>([])
  const [selectedIds,     setSelectedIds]     = useState<Set<string>>(new Set())
  const [queue,           setQueue]           = useState<QueueProject[]>([])
  const [accounts,        setAccounts]        = useState<Account[]>([])
  const [credFile,        setCredFile]        = useState("")
  const [showNewProject,  setShowNewProject]  = useState(false)
  const [editProject,     setEditProject]     = useState<Project | null>(null)
  const [selectedJobDetail, setSelectedJobDetail] = useState<{ qp: QueueProject; job: QueueJob } | null>(null)
  // Veo3 (separate project/queue structure)
  const [veo3Projects,    setVeo3Projects]    = useState<Veo3Project[]>([])
  const [veo3SelectedIds, setVeo3SelectedIds] = useState<Set<string>>(new Set())
  const [veo3Queue,       setVeo3Queue]       = useState<Veo3QueueProject[]>([])
  const [showVeo3NewProject, setShowVeo3NewProject] = useState(false)
  const [editVeo3Project, setEditVeo3Project] = useState<Veo3Project | null>(null)
  const [scripts, setScripts] = useState<Script[]>([])
  const [showScriptModal, setShowScriptModal] = useState(false)
  // Shared
  const [errors,          setErrors]          = useState<string[]>([])
  const [errExpanded,     setErrExpanded]     = useState(false)
  const [isStarting,      setIsStarting]      = useState(false)
  const [sessionSummary,  setSessionSummary]  = useState<{ total: number; success: number; failed: number } | null>(null)
  const [isStartingVeo3,  setIsStartingVeo3]  = useState(false)
  const [showVeo3Modal, setShowVeo3Modal] = useState(false)
  const [veo3ProfilesList, setVeo3ProfilesList] = useState<{ profileId: string; profileDir: string; loggedIn: boolean; email?: string }[]>([])
  const [activationStatus, setActivationStatus] = useState<ActivationStatus>({ activated: false })
  const [activationLoading, setActivationLoading] = useState(true)
  const [activationKey, setActivationKey] = useState("")
  const [activationBusy, setActivationBusy] = useState(false)
  const [activationError, setActivationError] = useState("")
  const [updateStatus, setUpdateStatus] = useState<string>("")
  const [updateReady, setUpdateReady] = useState(false)

  const allSelected = platform === "Veo3"
    ? veo3Projects.length > 0 && veo3Projects.every(p => veo3SelectedIds.has(p.id))
    : projects.length > 0 && projects.every(p => selectedIds.has(p.id))
  const someSelected = platform === "Veo3"
    ? veo3Projects.some(p => veo3SelectedIds.has(p.id))
    : projects.some(p => selectedIds.has(p.id))
  const currentProjects = platform === "Veo3" ? veo3Projects : projects
  const currentSelectedIds = platform === "Veo3" ? veo3SelectedIds : selectedIds
  const currentQueue = platform === "Veo3" ? veo3Queue : queue

  const toggleSelect = (id: string) => {
    if (platform === "Veo3") {
      setVeo3SelectedIds(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
    }
  }

  const toggleAll = () => {
    if (platform === "Veo3") {
      if (allSelected) setVeo3SelectedIds(new Set())
      else setVeo3SelectedIds(new Set(veo3Projects.map(p => p.id)))
    } else {
      if (allSelected) setSelectedIds(new Set())
      else setSelectedIds(new Set(projects.map(p => p.id)))
    }
  }

  const pushToQueue = async () => {
    if (platform === "Veo3") {
      const selected = veo3Projects.filter(p => veo3SelectedIds.has(p.id))
      if (selected.length === 0) return
      const newItems: Veo3QueueProject[] = []
      for (const p of selected) {
        let jobs: Veo3QueueJob[]
        if (p.useScripts && p.scriptIds && p.scriptIds.length > 0) {
          // 1 project = 1 script; project can have multiple images; each image runs through ALL prompts in the script
          const script = scripts.find(s => s.id === p.scriptIds![0])
          if (!script) continue
          const startDir = p.startFramesDir || p.imageDir || ''
          const imagePaths: string[] = startDir
            ? await ((window as any).electronAPI?.veo3GetImagePathsFromDir?.(startDir) ?? Promise.resolve([]))
            : []
          if (imagePaths.length === 0) continue
          let idx = 0
          jobs = imagePaths.flatMap((_, imageIndex) =>
            script.prompts.map(prompt => ({
              id: `${p.id}-${idx}`,
              index: idx++,
              prompt,
              status: 'pending' as JobStatus,
              progress: 0,
              imageIndex,
            }))
          )
        } else {
          jobs = p.prompts.map((prompt, i) => ({
            id: `${p.id}-${i}`,
            index: i,
            prompt,
            status: 'pending' as JobStatus,
            progress: 0,
          }))
        }
        newItems.push({ ...p, aiModel: p.aiModel ?? 'veo-3.1-fast', expanded: true, jobs })
      }
      if (newItems.length > 0) {
        setVeo3Queue(prev => {
          const existingIds = new Set(prev.map(q => q.id))
          return [...prev, ...newItems.filter(q => !existingIds.has(q.id))]
        })
        setVeo3SelectedIds(new Set())
      }
    } else {
      const selected = projects.filter(p => selectedIds.has(p.id))
      if (selected.length === 0) return

      const newItems: QueueProject[] = selected.map(p => ({
        ...p,
        expanded: true,
        jobs: p.prompts.map((prompt, i) => ({
          id:       `${p.id}-${i}`,
          index:    i,
          prompt,
          status:   "pending" as JobStatus,
          progress: 0,
        })),
      }))

      setQueue(prev => {
        const existingIds = new Set(prev.map(q => q.id))
        return [...prev, ...newItems.filter(q => !existingIds.has(q.id))]
      })
      setSelectedIds(new Set())

      if (isStarting && (window as any).electronAPI?.appendQueue) {
        ;(window as any).electronAPI.appendQueue(newItems)
      }
    }
  }

  const handleSaveProject = (data: Project | Omit<Project, "id" | "createdAt">) => {
    if ("id" in data && data.id) {
      setProjects(prev => prev.map(p => p.id === data.id ? (data as Project) : p))
      setEditProject(null)
    } else {
      const p: Project = { ...data, id: Date.now().toString(), createdAt: Date.now() }
      setProjects(prev => [...prev, p])
      setShowNewProject(false)
    }
  }

  const handleSaveVeo3Project = (data: Veo3Project | Omit<Veo3Project, "id" | "createdAt">) => {
    if ("id" in data && data.id) {
      setVeo3Projects(prev => prev.map(p => p.id === data.id ? (data as Veo3Project) : p))
      setEditVeo3Project(null)
    } else {
      const p: Veo3Project = { ...data, id: Date.now().toString(), createdAt: Date.now() }
      setVeo3Projects(prev => [...prev, p])
      setShowVeo3NewProject(false)
    }
  }

  const handleLoadCred = async () => {
    const file = await (window as any).electronAPI?.selectCredentialsFile?.()
    if (!file) return
    setCredFile(file.path)
    setAccounts(file.credentials.map((c: any, i: number) => ({
      id: `acct-${i}`, email: c.email, status: "idle" as AcctStatus,
    })))
  }

  const handleStart = async () => {
    if (queue.length === 0 || accounts.length === 0 || isStarting) return
    const queueToRun = queue
      .map(qp => ({
        ...qp,
        jobs: qp.jobs.filter(j => j.status !== "done"),
      }))
      .filter(qp => qp.jobs.length > 0)
    if (queueToRun.length === 0) {
      setErrors(prev => [...prev, "Không còn job nào đang chờ. Chỉ job đã hoàn thành trong queue — thêm dự án mới và đẩy vào queue."])
      return
    }
    setIsStarting(true)
    setErrors([])
    const api = (window as any).electronAPI
    if (api?.logToFile) {
      api.logToFile({ level: 'info', message: `Session started: ${queueToRun.length} projects, ${queueToRun.reduce((s, q) => s + q.jobs.length, 0)} jobs (chỉ job chưa xong)`, source: 'renderer' })
    }
    try {
      if (!api?.startSession) {
        setErrors(prev => [...prev, 'Electron API not available. Please run inside the Electron app.'])
        return
      }
      const res = await api.startSession({
        credentialsPath: credFile,
        queue: queueToRun,
      })
      if (!res?.success && res?.error) {
        setErrors(prev => [...prev, res.error])
        api.logToFile?.({ level: 'error', message: `Session error: ${res.error}`, source: 'renderer' })
      }
    } catch (err: any) {
      const errMsg = err?.message ?? String(err)
      setErrors(prev => [...prev, errMsg])
      api?.logToFile?.({ level: 'error', message: `Session exception: ${errMsg}`, source: 'renderer' })
    } finally {
      setIsStarting(false)
    }
  }

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api) return

    const handleAccountStatus = (_e: any, payload: { accountId: string; email: string; status: AcctStatus; error?: string }) => {
      setAccounts(prev => {
        const idx = prev.findIndex(a => a.id === payload.accountId)
        if (idx === -1) {
          return [...prev, { id: payload.accountId, email: payload.email, status: payload.status, error: payload.error }]
        }
        const next = [...prev]
        next[idx] = { ...next[idx], status: payload.status, error: payload.error }
        return next
      })
    }

    const handleJobProgress = (_e: any, payload: { projectId: string; jobId: string; progress: number }) => {
      setQueue(prev =>
        prev.map(p => p.id !== payload.projectId ? p : ({
          ...p,
          jobs: p.jobs.map(j =>
            j.id === payload.jobId
              ? { ...j, status: "running" as JobStatus, progress: payload.progress ?? 0 }
              : j
          ),
        }))
      )
      setVeo3Queue(prev =>
        prev.map(p => p.id !== payload.projectId ? p : ({
          ...p,
          jobs: p.jobs.map(j =>
            j.id === payload.jobId
              ? { ...j, status: "running" as JobStatus, progress: payload.progress ?? 0 }
              : j
          ),
        }))
      )
    }

    const handleJobCompleted = (_e: any, payload: { projectId: string; jobId: string; outputPath: string }) => {
      setQueue(prev =>
        prev.map(p => p.id !== payload.projectId ? p : ({
          ...p,
          jobs: p.jobs.map(j =>
            j.id === payload.jobId
              ? { ...j, status: "done" as JobStatus, progress: 100 }
              : j
          ),
        }))
      )
      setVeo3Queue(prev =>
        prev.map(p => p.id !== payload.projectId ? p : ({
          ...p,
          jobs: p.jobs.map(j =>
            j.id === payload.jobId
              ? { ...j, status: "done" as JobStatus, progress: 100 }
              : j
          ),
        }))
      )
    }

    const handleJobFailed = (_e: any, payload: { projectId: string; jobId: string; error: string }) => {
      setQueue(prev =>
        prev.map(p => p.id !== payload.projectId ? p : ({
          ...p,
          jobs: p.jobs.map(j =>
            j.id === payload.jobId
              ? { ...j, status: "failed" as JobStatus, error: payload.error, progress: j.progress }
              : j
          ),
        }))
      )
      setVeo3Queue(prev =>
        prev.map(p => p.id !== payload.projectId ? p : ({
          ...p,
          jobs: p.jobs.map(j =>
            j.id === payload.jobId
              ? { ...j, status: "failed" as JobStatus, error: payload.error, progress: j.progress }
              : j
          ),
        }))
      )
      setErrors(prev => [...prev, payload.error])
      ;(window as any).electronAPI?.logToFile?.({ level: 'error', message: `Job failed [${payload.jobId}]: ${payload.error}`, source: 'renderer' })
    }

    const handleSessionDone = (_e: any, payload: { success: boolean; summary: { total: number; success: number; failed: number } }) => {
      setIsStarting(false)
      setIsStartingVeo3(false)
      setSessionSummary(payload.summary)
      const api = (window as any).electronAPI
      api?.logToFile?.({ level: payload.summary.failed > 0 ? 'warn' : 'info', message: `Session done: ${payload.summary.success}/${payload.summary.total} success, ${payload.summary.failed} failed`, source: 'renderer' })
      if (!payload.success || payload.summary.failed > 0) {
        setErrors(prev => [...prev, `Session finished with ${payload.summary.failed} failed jobs out of ${payload.summary.total}.`])
      }
    }

    api.onAccountStatus(handleAccountStatus)
    api.onJobProgress(handleJobProgress)
    api.onJobCompleted(handleJobCompleted)
    api.onJobFailed(handleJobFailed)
    api.onSessionDone(handleSessionDone)

    return () => {
      try {
        api.removeAllListeners?.("account-status")
        api.removeAllListeners?.("job-progress")
        api.removeAllListeners?.("job-completed")
        api.removeAllListeners?.("job-failed")
        api.removeAllListeners?.("session-done")
        api.removeAllListeners?.("license-status")
        api.removeAllListeners?.("app-update-status")
      } catch {}
    }
  }, [])

  const toggleQueueExpand = (id: string) => {
    if (platform === "Veo3") {
      setVeo3Queue(prev => prev.map(q => q.id === id ? { ...q, expanded: !q.expanded } : q))
    } else {
      setQueue(prev => prev.map(q => q.id === id ? { ...q, expanded: !q.expanded } : q))
    }
  }

  useEffect(() => {
    if (platform === 'Veo3') setActivePanel('projects')
  }, [platform])

  useEffect(() => {
    if (platform !== 'Veo3') return
    const api = (window as any).electronAPI
    if (!api?.getScripts) return
    api.getScripts().then((list: Script[]) => setScripts(Array.isArray(list) ? list : []))
  }, [platform])

  useEffect(() => {
    let mounted = true
    const api = (window as any).electronAPI
    if (!api?.getActivationStatus) {
      setActivationLoading(false)
      return
    }
    api.getActivationStatus()
      .then((status: ActivationStatus) => {
        if (!mounted) return
        setActivationStatus(status ?? { activated: false })
      })
      .catch(() => {
        if (!mounted) return
        setActivationStatus({ activated: false, reason: "STATUS_ERROR" })
      })
      .finally(() => {
        if (!mounted) return
        setActivationLoading(false)
      })
    api?.onLicenseStatus?.((_e: any, status: ActivationStatus) => {
      if (!mounted) return
      setActivationStatus(status ?? { activated: false })
    })
    api?.onAppUpdateStatus?.((_e: any, payload: { stage?: string; version?: string; percent?: number; message?: string }) => {
      if (!mounted) return
      if (!payload?.stage) return
      if (payload.stage === 'downloading') {
        setUpdateReady(false)
        setUpdateStatus(`Update: downloading ${Math.round(payload.percent ?? 0)}%`)
      } else if (payload.stage === 'available') {
        setUpdateReady(false)
        setUpdateStatus(`Update available: ${payload.version ?? ''}`.trim())
      } else if (payload.stage === 'downloaded') {
        setUpdateReady(true)
        setUpdateStatus(`Update downloaded: ${payload.version ?? ''}`.trim())
      } else if (payload.stage === 'up-to-date') {
        setUpdateReady(false)
        setUpdateStatus(`Update: up to date (${payload.version ?? ''})`.trim())
      } else if (payload.stage === 'error') {
        setUpdateStatus(`Update error: ${payload.message ?? 'unknown'}`)
      } else if (payload.stage === 'checking') {
        setUpdateReady(false)
        setUpdateStatus('Update: checking...')
      }
    })
    return () => { mounted = false }
  }, [])

  const handleSaveScript = useCallback((s: Script | Omit<Script, 'id'>) => {
    const api = (window as any).electronAPI
    if (!api?.getScripts || !api?.saveScripts) return
    const id = 'id' in s && s.id ? s.id : Date.now().toString()
    const script: Script = { id, name: s.name, prompts: s.prompts }
    const next = 'id' in s && s.id
      ? scripts.map(x => x.id === s.id ? script : x)
      : [...scripts, script]
    setScripts(next)
    api.saveScripts(next)
  }, [scripts])

  const handleDeleteScript = useCallback((id: string) => {
    const api = (window as any).electronAPI
    if (!api?.saveScripts) return
    const next = scripts.filter(s => s.id !== id)
    setScripts(next)
    api.saveScripts(next)
  }, [scripts])

  const readyCount = accounts.filter(a => a.status === "ready").length
  const hasPendingJobs = platform === "Veo3"
    ? veo3Queue.some(qp => qp.jobs.some(j => j.status !== "done"))
    : queue.some(qp => qp.jobs.some(j => j.status !== "done"))
  const hasPendingVeo3Job = veo3Queue.some(qp => qp.jobs.some(j => j.status === 'pending'))
  const pendingVeo3Count = veo3Queue.reduce((s, qp) => s + qp.jobs.filter(j => j.status === 'pending').length, 0)

  const refreshVeo3Profiles = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.veo3ListProfiles) return
    const res = await api.veo3ListProfiles()
    setVeo3ProfilesList(res?.profiles ?? [])
  }, [])

  const handleVeo3Status = useCallback((profileId: string, loggedIn: boolean, email?: string) => {
    setVeo3ProfilesList(prev => {
      const i = prev.findIndex(p => p.profileId === profileId)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], loggedIn, ...(email !== undefined && { email }) }
        return next
      }
      return [...prev, { profileId, profileDir: '', loggedIn, ...(email !== undefined && { email }) }]
    })
  }, [])

  const handleVeo3OpenN = useCallback(async (n: number) => {
    const api = (window as any).electronAPI
    if (!api?.veo3OpenProfiles) return
    await api.veo3OpenProfiles(n)
    await refreshVeo3Profiles()
  }, [refreshVeo3Profiles])

  const handleVeo3CloseAll = useCallback(async () => {
    const api = (window as any).electronAPI
    api?.veo3CloseAll?.()
    await refreshVeo3Profiles()
  }, [refreshVeo3Profiles])

  const handleVeo3OpenSelected = useCallback(async (profileIds: string[]) => {
    const api = (window as any).electronAPI
    if (!api?.veo3OpenSelectedProfiles || profileIds.length === 0) return
    await api.veo3OpenSelectedProfiles(profileIds)
    await refreshVeo3Profiles()
  }, [refreshVeo3Profiles])

  const handleVeo3Start = useCallback(async () => {
    const pending = veo3Queue.filter(p => p.jobs.some(j => j.status === 'pending'))
    if (pending.length === 0) {
      setErrors(prev => [...prev, 'Không có job nào đang chờ. Thêm dự án và đẩy vào queue.'])
      return
    }
    const api = (window as any).electronAPI
    if (!api?.veo3RunQueue) {
      setErrors(prev => [...prev, 'veo3RunQueue không khả dụng.'])
      return
    }
    if (veo3ProfilesList.filter(p => p.loggedIn).length === 0) {
      setErrors(prev => [...prev, 'Chưa có profile nào đăng nhập. Mở Veo3 Profiles và đăng nhập Flow.'])
      return
    }
    setIsStartingVeo3(true)
    const res = await api.veo3RunQueue(veo3Queue)
    if (!res?.success) {
      setErrors(prev => [...prev, res?.error ?? 'Chạy queue thất bại.'])
      setIsStartingVeo3(false)
    }
  }, [veo3Queue, veo3ProfilesList])

  const handleActivate = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.activateLicenseKey) {
      setActivationError("Electron API không khả dụng.")
      return
    }
    const key = activationKey.trim()
    if (!key) {
      setActivationError("Vui lòng nhập activation key.")
      return
    }
    setActivationBusy(true)
    setActivationError("")
    try {
      const res = await api.activateLicenseKey(key)
      if (!res?.success) {
        setActivationError(res?.error ?? "Kích hoạt thất bại.")
        return
      }
      setActivationStatus(res.status ?? { activated: true })
      setActivationKey("")
    } catch (err: any) {
      setActivationError(err?.message ?? String(err))
    } finally {
      setActivationBusy(false)
    }
  }, [activationKey])

  const handleOpenAdmin = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.openLicenseAdmin) return
    const res = await api.openLicenseAdmin()
    if (!res?.success) setErrors(prev => [...prev, res?.error ?? 'Không mở được trang quản lý.'])
  }, [])

  if (activationLoading) {
    return (
      <>
        <GlobalStyle/>
        <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "var(--bg)" }}>
          <div style={{ color: "var(--text2)", fontSize: 14 }}>Đang kiểm tra kích hoạt...</div>
        </div>
      </>
    )
  }

  if (!activationStatus.activated) {
    return (
      <>
        <GlobalStyle/>
        <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "var(--bg)" }}>
          <div style={{
            width: "min(680px, 92vw)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--surface)",
            boxShadow: "0 10px 26px rgba(0,0,0,.08)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Kích hoạt ứng dụng</div>
            <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
              Khách hàng cần nhập activation key hợp lệ để sử dụng tool.
              Ứng dụng sẽ gọi license API để xác thực key, ràng buộc thiết bị và thời hạn.
            </div>
            <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
              Liên hệ mua tool: <b>039.969.2275</b>
            </div>
            <input
              value={activationKey}
              onChange={(e) => setActivationKey(e.target.value)}
              placeholder="Dán activation key tại đây"
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 13,
                outline: "none",
              }}
            />
            {(activationError || activationStatus.reason) && (
              <div style={{ fontSize: 12, color: "var(--danger)" }}>
                {activationError || `Chưa kích hoạt (${activationStatus.reason})`}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn
                variant="ghost"
                onClick={async () => {
                  const api = (window as any).electronAPI
                  const r = await api?.refreshActivationStatus?.()
                  if (r?.status) setActivationStatus(r.status)
                }}
                disabled={activationBusy}
              >
                Kiểm tra lại
              </Btn>
              <Btn variant="primary" onClick={handleActivate} disabled={activationBusy}>
                {activationBusy ? <><Icon.Spin /> Đang kích hoạt...</> : "Kích hoạt"}
              </Btn>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <GlobalStyle/>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>

        <div style={{
          height: "var(--titlebar)", background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center",
          WebkitAppRegion: "drag",
          paddingLeft: 80, paddingRight: 12,
          gap: 8, flexShrink: 0,
        } as any}>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-.01em" }}>Loha Studio</span>
          <div style={{ width: 1, height: 14, background: "var(--border)", margin: "0 4px" }}/>
          <div style={{ display: "flex", gap: 2, WebkitAppRegion: "no-drag" } as any}>
            {(["Veo3", "Grok"] as Platform[]).map(p => (
              <button key={p} onClick={() => setPlatform(p)} style={{
                padding: "3px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: platform === p ? "var(--bg2)" : "transparent",
                color: platform === p ? "var(--text)" : "var(--text3)",
                transition: "all .12s",
              }}>{p}</button>
            ))}
            {activationStatus.role === 'admin' && (
              <button
                onClick={handleOpenAdmin}
                style={{
                  padding: "3px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--accent-bg)",
                  color: "var(--accent)",
                  transition: "all .12s",
                }}
                title="Mở trang Quản lý license (admin)"
              >
                Quản lý
              </button>
            )}
          </div>
          <div style={{ flex: 1 }}/>
          <div style={{ display: "flex", gap: 2, WebkitAppRegion: "no-drag" } as any}>
            <button
              onClick={() => setActivePanel("projects")}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: activePanel === "projects" ? "var(--bg2)" : "transparent",
                color: activePanel === "projects" ? "var(--text)" : "var(--text3)",
                transition: "all .12s",
              }}
            >
              <Icon.Projects/> Dự án
            </button>
            <button
              onClick={() => setActivePanel("guide")}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: activePanel === "guide" ? "var(--bg2)" : "transparent",
                color: activePanel === "guide" ? "var(--text)" : "var(--text3)",
                transition: "all .12s",
              }}
            >
              <Icon.Info /> Hướng dẫn sử dụng
            </button>
            {platform === "Grok" && (
              <button
                onClick={() => setActivePanel("accounts")}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  background: activePanel === "accounts" ? "var(--bg2)" : "transparent",
                  color: activePanel === "accounts" ? "var(--text)" : "var(--text3)",
                  transition: "all .12s",
                }}
              >
                <Icon.Accounts/> Grok tài khoản
              </button>
            )}
            {platform === "Veo3" && (
              <button
                onClick={() => setShowVeo3Modal(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  background: "var(--accent-bg)",
                  color: "var(--accent)",
                  transition: "all .12s",
                }}
              >
                <Icon.User/> Veo3 Profiles
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>

          {activePanel === "projects" && (
            <>
              <div style={{
                width: "50%", display: "flex", flexDirection: "column", minHeight: 0,
                borderRight: "1px solid var(--border)",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", borderBottom: "1px solid var(--border)",
                  background: "var(--surface)", flexShrink: 0,
                }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    {platform === "Veo3" ? "Dự án Veo3 (Flow)" : "Danh sách dự án"}
                  </span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {currentProjects.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onChange={toggleAll}
                      />
                    )}
                    {currentSelectedIds.size > 0 && (
                      <Btn size="sm" variant="danger" onClick={() => {
                        if (platform === "Veo3") {
                          setVeo3Projects(prev => prev.filter(p => !veo3SelectedIds.has(p.id)))
                          setVeo3SelectedIds(new Set())
                        } else {
                          setProjects(prev => prev.filter(p => !selectedIds.has(p.id)))
                          setSelectedIds(new Set())
                        }
                      }}>
                        <Icon.Trash /> Xoá ({currentSelectedIds.size})
                      </Btn>
                    )}
                    {platform === "Veo3" && (
                      <>
                        <Btn size="sm" variant="ghost" onClick={() => setShowScriptModal(true)}>
                          Thêm/sửa kịch bản
                        </Btn>
                        <Btn size="sm" variant="primary" onClick={() => setShowVeo3NewProject(true)}>
                          <Icon.Plus /> Thêm dự án
                        </Btn>
                      </>
                    )}
                    {platform !== "Veo3" && (
                      <Btn size="sm" variant="primary" onClick={() => setShowNewProject(true)}>
                        <Icon.Plus /> Thêm
                      </Btn>
                    )}
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {platform === "Veo3" ? (
                    <>
                      {veo3Projects.length === 0 ? (
                      <div style={{
                        flex: 1, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 10,
                        color: "var(--text3)", textAlign: "center",
                      }}>
                        <Icon.Projects/>
                        <div style={{ fontSize: 13 }}>Chưa có dự án Veo3 nào</div>
                        <Btn variant="primary" onClick={() => setShowVeo3NewProject(true)}><Icon.Plus /> Tạo dự án Veo3</Btn>
                      </div>
                      ) : (
                        veo3Projects.map(p => (
                        <Veo3ProjectRow
                          key={p.id}
                          project={p}
                          checked={veo3SelectedIds.has(p.id)}
                          onCheck={() => toggleSelect(p.id)}
                          onEdit={(proj) => setEditVeo3Project(proj)}
                        />
                        ))
                      )}
                    </>
                  ) : projects.length === 0 ? (
                    <div style={{
                      flex: 1, display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 10,
                      color: "var(--text3)", textAlign: "center",
                    }}>
                      <Icon.Projects/>
                      <div style={{ fontSize: 13 }}>Chưa có dự án nào</div>
                      <Btn variant="primary" onClick={() => setShowNewProject(true)}><Icon.Plus /> Tạo dự án mới</Btn>
                    </div>
                  ) : projects.map(p => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      checked={selectedIds.has(p.id)}
                      onCheck={() => toggleSelect(p.id)}
                      onEdit={(proj) => setEditProject(proj)}
                    />
                  ))}
                </div>
              </div>

              <div style={{
                width: 36, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: "var(--bg2)", borderRight: "1px solid var(--border)",
                flexShrink: 0,
              }}>
                <button
                  onClick={pushToQueue}
                  disabled={currentSelectedIds.size === 0}
                  title={platform === "Veo3" ? `Đưa ${currentSelectedIds.size} dự án Veo3 vào queue` : `Đưa ${currentSelectedIds.size} dự án vào queue`}
                  style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: currentSelectedIds.size > 0 ? "var(--accent)" : "var(--bg3)",
                    color: currentSelectedIds.size > 0 ? "#fff" : "var(--text3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all .15s", border: "none", cursor: currentSelectedIds.size > 0 ? "pointer" : "default",
                  }}
                >
                  <Icon.Arrow/>
                </button>
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", borderBottom: "1px solid var(--border)",
                  background: "var(--surface)", flexShrink: 0,
                }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    Queue
                  </span>
                  {currentQueue.length > 0 && (
                    <Btn size="sm" variant="ghost" onClick={() => platform === "Veo3" ? setVeo3Queue([]) : setQueue([])}><Icon.Trash /> Xoá hết</Btn>
                  )}
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {platform === "Veo3" ? (
                    veo3Queue.length === 0 ? (
                      <div style={{
                        flex: 1, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 8,
                        color: "var(--text3)", textAlign: "center",
                      }}>
                        <Icon.Arrow/>
                        <div style={{ fontSize: 13 }}>Chọn dự án Veo3 và nhấn → để thêm vào queue</div>
                      </div>
                    ) : (
                      veo3Queue.map(qp => (
                        <Veo3QueueProjectRow
                          key={qp.id}
                          qp={qp}
                          onToggle={() => toggleQueueExpand(qp.id)}
                        />
                      ))
                    )
                  ) : queue.length === 0 ? (
                    <div style={{
                      flex: 1, display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 8,
                      color: "var(--text3)", textAlign: "center",
                    }}>
                      <Icon.Arrow/>
                      <div style={{ fontSize: 13 }}>Chọn dự án và nhấn → để thêm vào queue</div>
                    </div>
                  ) : queue.map(qp => (
                    <QueueProjectRow
                      key={qp.id}
                      qp={qp}
                      onToggle={() => toggleQueueExpand(qp.id)}
                      onJobClick={(qp, job) => setSelectedJobDetail({ qp, job })}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {platform === "Grok" && activePanel === "accounts" && (
            <div style={{ flex: 1 }}>
              <AccountsPanel accounts={accounts} credFile={credFile} onLoadCred={handleLoadCred}/>
            </div>
          )}
          {activePanel === "guide" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 14 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Hướng dẫn sử dụng nhanh</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                  Tài liệu này giúp bạn tạo video đúng quy trình, tránh lỗi nhập ảnh/prompt và hiểu rõ cách chạy theo chế độ kịch bản hoặc prompt thủ công.
                </div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>1) Kích hoạt ứng dụng</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                  Mở app, nhập activation key được cấp từ admin, nhấn <b>Kích hoạt</b>. Nếu key hợp lệ và chưa hết hạn, app sẽ mở đầy đủ chức năng.
                </div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>2) Tạo video Veo3 (chi tiết)</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                  <li>Vào tab <b>Veo3</b>, tạo dự án mới và chọn <b>Thư mục tải về</b>.</li>
                  <li><b>Import ảnh:</b> chọn <b>Thư mục ảnh đầu</b>. Ảnh được dùng theo thứ tự trong thư mục.</li>
                  <li><b>Chế độ prompt:</b> tắt chế độ kịch bản, nhập prompt trực tiếp vào ô Prompts. (Lưu ý: Ảnh cần được đặt tên theo số thứ tự: 1.png, 2.png, ... khi dùng chế độ prompt)</li>
                  <li><b>Chế độ kịch bản:</b> bật chế độ kịch bản, chọn 1 script; mỗi ảnh sẽ chạy qua toàn bộ prompt trong script đó.</li>
                  <li>Đẩy dự án sang queue, mở <b>Veo3 Profiles</b>, đăng nhập profile rồi nhấn <b>Start</b>.</li>
                </ul>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>3) Quy ước nhập prompts</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 6 }}>
                  Mỗi prompt phải cách nhau <b>1 dòng trắng</b> (blank line). App sẽ tách prompts theo quy ước này.
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", background: "var(--bg2)", borderRadius: 8, padding: 10, fontFamily: "var(--mono)", whiteSpace: "pre-wrap" }}>
                  Prompt 1: A cinematic close-up of a woman in red dress...
                  {"\n\n"}
                  Prompt 2: Slow camera pan, soft backlight, realistic skin...
                  {"\n\n"}
                  Prompt 3: Wide shot, city lights at night, dramatic mood...
                </div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>4) Cập nhật phiên bản</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                  Nhấn <b>Check update</b>. Khi thấy thông báo đã tải xong, nhấn <b>Restart to update</b> để cập nhật.
                </div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Lưu ý quan trọng</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                  <li>Tên file ảnh và tên dự án nên đặt <b>không dấu</b> để giảm rủi ro lỗi trong quá trình chạy tự động.</li>
                  <li>Không thu nhỏ/tắt màn hình khi automation đang chạy.</li>
                  <li>Giữ mạng ổn định khi kích hoạt key và kiểm tra update.</li>
                  <li>Nếu gặp lỗi import ảnh, prompt, hoặc lỗi bất kỳ, vui lòng liên hệ để được hỗ trợ nhanh.</li>
                </ul>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Thông tin liên hệ</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>
                  Mua tool / hỗ trợ kỹ thuật: <b>039.969.2275</b>
                </div>
              </div>
            </div>
          )}
        </div>

        <ErrorPanel errors={errors} expanded={errExpanded} onToggle={() => setErrExpanded(e => !e)}/>

        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", background: "var(--surface)",
          borderTop: "1px solid var(--border)", flexShrink: 0,
        }}>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>
            {activePanel === "guide" ? "Đang xem hướng dẫn sử dụng" : platform === "Veo3" ? (
              veo3Queue.length > 0 ? (
                hasPendingJobs
                  ? `${veo3Queue.reduce((s, q) => s + q.jobs.filter(j => j.status !== "done").length, 0)} job đang chờ · ${veo3Queue.reduce((s, q) => s + q.jobs.length, 0)} tổng · ${veo3Queue.length} dự án Veo3`
                  : `Tất cả job đã xong (${veo3Queue.reduce((s, q) => s + q.jobs.length, 0)} job) — thêm dự án mới và →`
              ) : "Chưa có job Veo3 nào"
            ) : queue.length > 0 ? (
              hasPendingJobs
                ? `${queue.reduce((s, q) => s + q.jobs.filter(j => j.status !== "done").length, 0)} job đang chờ · ${queue.reduce((s, q) => s + q.jobs.length, 0)} tổng · ${queue.length} dự án`
                : `Tất cả job đã xong (${queue.reduce((s, q) => s + q.jobs.length, 0)} job) — thêm dự án mới và →`
            ) : "Chưa có job nào"}
            {sessionSummary && (
              <span style={{ marginLeft: 8 }}>
                · Kết quả gần nhất: {sessionSummary.success}/{sessionSummary.total} thành công, {sessionSummary.failed} lỗi
              </span>
            )}
            <span style={{ marginLeft: 8 }}>
              · License: {activationStatus.role === 'admin' ? 'admin' : 'user'}
              {activationStatus.expiresAt ? ` · hết hạn ${new Date(activationStatus.expiresAt).toLocaleString()}` : ''}
            </span>
            {updateStatus && (
              <span
                style={{
                  marginLeft: 8,
                  display: 'inline-block',
                  maxWidth: 380,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  verticalAlign: 'bottom',
                }}
                title={updateStatus}
              >
                · {updateStatus}
              </span>
            )}
          </div>
          <div style={{ flex: 1 }}/>
          {(window as any).electronAPI?.checkForUpdatesNow && (
            <button
              type="button"
              onClick={async () => {
                const res = await (window as any).electronAPI.checkForUpdatesNow()
                if (!res?.success && res?.error) setErrors(prev => [...prev, res.error])
              }}
              style={{ fontSize: 11, color: "var(--text3)", textDecoration: "none", background: "none", padding: "2px 6px" }}
              title="Kiểm tra update ngay"
            >
              Check update
            </button>
          )}
          {updateReady && (window as any).electronAPI?.installDownloadedUpdate && (
            <button
              type="button"
              onClick={async () => {
                const res = await (window as any).electronAPI.installDownloadedUpdate()
                if (!res?.success && res?.error) setErrors(prev => [...prev, res.error])
              }}
              style={{ fontSize: 11, color: "#fff", background: "#16a34a", padding: "3px 8px", borderRadius: 6 }}
              title="Khởi động lại app để cài bản update đã tải"
            >
              Restart to update
            </button>
          )}
          {accounts.length > 0 && platform === "Grok" && (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              {readyCount}/{accounts.length} tài khoản sẵn sàng
            </span>
          )}
          {platform === "Veo3" && activePanel === "projects" && (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              Veo3: {veo3ProfilesList.length} profiles ({veo3ProfilesList.filter(p => p.loggedIn).length} đã đăng nhập). Không thu nhỏ cửa sổ / tắt màn hình khi chạy.
            </span>
          )}
          {platform === "Veo3" && activePanel === "projects" && (
            <>
              <Btn
                variant="primary"
                disabled={pendingVeo3Count === 0 || veo3ProfilesList.filter(p => p.loggedIn).length === 0 || isStartingVeo3}
                onClick={handleVeo3Start}
                size="lg"
                style={{ minWidth: 100 }}
                title="Chạy queue: 1 profile = 1 dự án, mỗi 30s chạy prompt tiếp theo. Lưu ý: Không thu nhỏ cửa sổ hoặc tắt màn hình khi đang chạy — automation cần cửa sổ hiển thị để thao tác."
              >
                {isStartingVeo3 ? <><Icon.Spin /> Đang chạy...</> : <><Icon.Play /> Start</>}
              </Btn>
            </>
          )}
          {platform === "Grok" && activePanel === "projects" && (
            <Btn
              variant="primary"
              disabled={!hasPendingJobs || accounts.length === 0 || isStarting}
              onClick={handleStart}
              size="lg"
              style={{ minWidth: 100 }}
              title="Chạy queue. Có thể thêm dự án vào queue (→) trong lúc chạy để chạy tiếp."
            >
              {isStarting ? <><Icon.Spin /> Đang chạy...</> : <><Icon.Play /> Start</>}
            </Btn>
          )}
        </div>

      </div>

      {(showNewProject || editProject) && (
        <NewProjectModal
          onClose={() => { setShowNewProject(false); setEditProject(null) }}
          onSave={handleSaveProject}
          initial={editProject ?? undefined}
        />
      )}
      {(showVeo3NewProject || editVeo3Project) && (
        <Veo3NewProjectModal
          onClose={() => { setShowVeo3NewProject(false); setEditVeo3Project(null) }}
          onSave={handleSaveVeo3Project}
          initial={editVeo3Project ?? undefined}
          scripts={scripts}
        />
      )}
      {selectedJobDetail != null && (
        <JobDetailModal
          qp={selectedJobDetail.qp}
          job={selectedJobDetail.job}
          onClose={() => setSelectedJobDetail(null)}
        />
      )}
      {showVeo3Modal && (
        <Veo3ProfilesModal
          onClose={() => setShowVeo3Modal(false)}
          profiles={veo3ProfilesList}
          onRefresh={refreshVeo3Profiles}
          onOpenN={handleVeo3OpenN}
          onOpenSelected={handleVeo3OpenSelected}
          onCloseAll={handleVeo3CloseAll}
          onStatus={handleVeo3Status}
        />
      )}
      {showScriptModal && (
        <Veo3ScriptModal
          onClose={() => setShowScriptModal(false)}
          onSave={handleSaveScript}
          onDelete={handleDeleteScript}
          scripts={scripts}
        />
      )}
    </>
  )
}
