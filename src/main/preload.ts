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
  openProfiles: (credentialsPath: string) => ipcRenderer.invoke('open-profiles', credentialsPath),
  runQueue:     (queue: any[]) => ipcRenderer.invoke('run-queue', queue),
  appendQueue: (queueAddition: any[]) => ipcRenderer.invoke('append-queue', queueAddition),

  // Logging
  logToFile:      (payload: { level: string; message: string; source?: string }) => ipcRenderer.invoke('log-to-file', payload),
  getLogDirectory: () => ipcRenderer.invoke('get-log-directory'),
  openLogFolder:   () => ipcRenderer.invoke('open-log-folder'),
  checkForUpdatesNow: () => ipcRenderer.invoke('check-for-updates-now'),
  installDownloadedUpdate: () => ipcRenderer.invoke('install-downloaded-update'),

  // Veo3 scripts (persisted in userData)
  getScripts: () => ipcRenderer.invoke('get-scripts') as Promise<{ id: string; name: string; prompts: string[] }[]>,
  saveScripts: (scripts: { id: string; name: string; prompts: string[] }[]) => ipcRenderer.invoke('save-scripts', scripts),

  // Events: Main → Renderer
  onAccountStatus: (cb: (e: any, d: any) => void) => ipcRenderer.on('account-status', cb),
  onJobProgress:   (cb: (e: any, d: any) => void) => ipcRenderer.on('job-progress',   cb),
  onJobCompleted:  (cb: (e: any, d: any) => void) => ipcRenderer.on('job-completed',  cb),
  onJobFailed:     (cb: (e: any, d: any) => void) => ipcRenderer.on('job-failed',     cb),
  onSessionDone:   (cb: (e: any, d: any) => void) => ipcRenderer.on('session-done',   cb),
  onLicenseStatus: (cb: (e: any, d: any) => void) => ipcRenderer.on('license-status', cb),
  onAppUpdateStatus: (cb: (e: any, d: any) => void) => ipcRenderer.on('app-update-status', cb),

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),

  // Veo3 (Google Flow) profiles
  veo3ListProfiles: () => ipcRenderer.invoke('veo3-list-profiles'),
  veo3GetImagePathsFromDir: (dir: string) => ipcRenderer.invoke('veo3-get-image-paths-from-dir', dir),
  veo3OpenProfiles: (count: number) => ipcRenderer.invoke('veo3-open-profiles', count),
  veo3OpenSelectedProfiles: (profileIds: string[]) => ipcRenderer.invoke('veo3-open-selected-profiles', profileIds),
  veo3CloseAll: () => ipcRenderer.invoke('veo3-close-all'),
  veo3RunJob: (payload: { projectId?: string; jobId?: string; jobIndex?: number; debugUploadOnly?: boolean; prompt: string; imageDir: string; aiModel?: 'veo-3.1-fast' | 'veo-3.1-fast-lower-priority' | 'veo-3.1-quality'; videoMode: 'frames' | 'ingredients'; landscape: boolean; multiplier: 1 | 2 | 3 | 4 }) =>
    ipcRenderer.invoke('veo3-run-job', payload),
  veo3RunQueue: (queue: any[]) => ipcRenderer.invoke('veo3-run-queue', queue),
  onVeo3ProfileStatus: (cb: (e: any, d: { profileId: string; loggedIn: boolean; email?: string; error?: string }) => void) =>
    ipcRenderer.on('veo3-profile-status', cb),
})
