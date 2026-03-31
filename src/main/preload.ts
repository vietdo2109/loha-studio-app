import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Activation / licensing
  getActivationStatus: () => ipcRenderer.invoke('license-get-status'),
  activateLicenseKey: (key: string) => ipcRenderer.invoke('license-activate', key),
  refreshActivationStatus: () => ipcRenderer.invoke('license-refresh-status'),
  openLicenseAdmin: () => ipcRenderer.invoke('license-open-admin'),

  // File pickers
  selectDirectory:       () => ipcRenderer.invoke('select-directory'),
  selectTextFile:        () => ipcRenderer.invoke('select-text-file'),
  selectImages:          () => ipcRenderer.invoke('select-images'),
  selectCredentialsFile: () => ipcRenderer.invoke('select-credentials-file'),

  // Session
  startSession: (config: any) => ipcRenderer.invoke('start-session', config),
  stopSession:  ()             => ipcRenderer.invoke('stop-session'),
  runQueue:     (queue: any[]) => ipcRenderer.invoke('run-queue', queue),
  appendQueue: (queueAddition: any[]) => ipcRenderer.invoke('append-queue', queueAddition),

  // Logging
  logToFile:      (payload: { level: string; message: string; source?: string }) => ipcRenderer.invoke('log-to-file', payload),
  getLogDirectory: () => ipcRenderer.invoke('get-log-directory'),
  openLogFolder:   () => ipcRenderer.invoke('open-log-folder'),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath) as Promise<boolean>,
  checkForUpdatesNow: () => ipcRenderer.invoke('check-for-updates-now'),
  installDownloadedUpdate: () => ipcRenderer.invoke('install-downloaded-update'),

  // Veo3 scripts (persisted in userData)
  getScripts: () => ipcRenderer.invoke('get-scripts') as Promise<{ id: string; name: string; prompts: string[] }[]>,
  saveScripts: (scripts: { id: string; name: string; prompts: string[] }[]) => ipcRenderer.invoke('save-scripts', scripts),

  // Events: Main → Renderer
  onAccountStatus: (cb: (e: any, d: any) => void) => ipcRenderer.on('account-status', cb),
  onGrokCreateProgress: (cb: (e: any, d: { index: number; profileId: string; step: string; percent: number }) => void) =>
    ipcRenderer.on('grok-create-progress', cb),
  onJobProgress:   (cb: (e: any, d: any) => void) => ipcRenderer.on('job-progress',   cb),
  onJobCompleted:  (cb: (e: any, d: any) => void) => ipcRenderer.on('job-completed',  cb),
  onJobFailed:     (cb: (e: any, d: any) => void) => ipcRenderer.on('job-failed',     cb),
  onSessionDone:   (cb: (e: any, d: any) => void) => ipcRenderer.on('session-done',   cb),
  onLicenseStatus: (cb: (e: any, d: any) => void) => ipcRenderer.on('license-status', cb),
  onAppUpdateStatus: (cb: (e: any, d: any) => void) => ipcRenderer.on('app-update-status', cb),

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),

  // Grok persistent profiles (same disk model as Veo3)
  grokListProfiles: () => ipcRenderer.invoke('grok-list-profiles'),
  grokOpenProfiles: (count: number) => ipcRenderer.invoke('grok-open-profiles', count),
  grokOpenSelectedProfiles: (profileIds: string[]) => ipcRenderer.invoke('grok-open-selected-profiles', profileIds),
  grokCloseAll: () => ipcRenderer.invoke('grok-close-all'),
  onGrokProfileStatus: (cb: (e: any, d: { profileId: string; loggedIn: boolean; email?: string; error?: string }) => void) =>
    ipcRenderer.on('grok-profile-status', cb),

  // Veo3 (Google Flow) profiles
  veo3ListProfiles: () => ipcRenderer.invoke('veo3-list-profiles'),
  veo3GetImagePathsFromDir: (dir: string) => ipcRenderer.invoke('veo3-get-image-paths-from-dir', dir),
  veo3OpenProfiles: (count: number) => ipcRenderer.invoke('veo3-open-profiles', count),
  veo3OpenSelectedProfiles: (profileIds: string[]) => ipcRenderer.invoke('veo3-open-selected-profiles', profileIds),
  veo3CloseAll: () => ipcRenderer.invoke('veo3-close-all'),
  veo3DeleteProfile: (profileId: string) => ipcRenderer.invoke('veo3-delete-profile', profileId),
  veo3StopQueue: () => ipcRenderer.invoke('veo3-stop-queue'),
  veo3RunJob: (payload: { projectId?: string; jobId?: string; jobIndex?: number; debugUploadOnly?: boolean; prompt: string; imageDir: string; aiModel?: 'veo-3.1-fast' | 'veo-3.1-fast-lower-priority' | 'veo-3.1-quality'; videoMode: 'frames' | 'ingredients'; landscape: boolean; multiplier: 1 | 2 | 3 | 4 }) =>
    ipcRenderer.invoke('veo3-run-job', payload),
  veo3RunQueue: (queue: any[], options?: { enableHumanBehavior?: boolean }) => ipcRenderer.invoke('veo3-run-queue', queue, options),

  // Profile warming
  veo3WarmProfile: (profileId: string) => ipcRenderer.invoke('veo3-warm-profile', profileId),
  veo3WarmAllProfiles: () => ipcRenderer.invoke('veo3-warm-all-profiles'),
  veo3GetWarmingStatus: (profileId: string) => ipcRenderer.invoke('veo3-get-warming-status', profileId),
  veo3RefreshStaleProfiles: () => ipcRenderer.invoke('veo3-refresh-stale-profiles'),
  onVeo3WarmingStatus: (
    cb: (
      e: any,
      d: {
        profileId: string
        status: 'started' | 'progress' | 'done' | 'error'
        current?: number
        total?: number
        siteName?: string
        phase?: string
        visited?: number
        error?: string
      }
    ) => void
  ) => ipcRenderer.on('veo3-warming-status', cb),

  onVeo3ProfileStatus: (cb: (e: any, d: { profileId: string; loggedIn: boolean; email?: string; error?: string }) => void) =>
    ipcRenderer.on('veo3-profile-status', cb),
  onVeo3FlowNotify: (
    cb: (
      e: any,
      d: {
        projectId?: string
        jobId?: string
        kind: 'blocking-dismissed'
        stepLabel: string
        message: string
      }
    ) => void
  ) => ipcRenderer.on('veo3-flow-notify', cb),
  onVeo3ProfileBlocked: (
    cb: (
      e: any,
      d: {
        profileId: string
        reason?: string
        message?: string
      }
    ) => void
  ) => ipcRenderer.on('veo3-profile-blocked', cb),
})
