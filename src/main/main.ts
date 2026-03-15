/**
 * FLOW AUTOMATION — Electron Main Process
 * File: src/main/main.ts
 *
 * IPC handlers:
 *   select-directory        → folder picker
 *   select-text-file        → .txt file picker, returns content
 *   select-images           → image file picker, returns paths[]
 *   select-credentials-file → .txt picker, returns { path, credentials[] }
 *   open-profiles           → launch browsers + login; keep profiles open (no queue)
 *   run-queue               → run job queue with already-open profiles
 *   stop-session            → close all profiles (and abort if queue is running)
 *
 * Events emitted to renderer:
 *   account-status  { accountId, status, email, error? }
 *   job-progress    { projectId, jobId, progress }
 *   job-completed   { projectId, jobId, outputPath }
 *   job-failed      { projectId, jobId, error }
 *   session-done    { success, summary }
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import * as fs from 'fs'
import os from 'os'
import { machineIdSync } from 'node-machine-id'
import { autoUpdater } from 'electron-updater'
import { chromium, BrowserContext, Page } from 'patchright'
import { BrowserWorker }                       from '../automation/BrowserWorker'
import { AccountLogin, parseCredentialsFile } from '../automation/AccountLogin'
import { resolveImageForIndex, resolveImagesForIndex, resolveAllImagePathsFromDir, listImagePathsFromDir } from '../automation/inputParser'
import { initAppLogger, appLog, getLogDirectory } from './logger'
import { runVeo3CreateVideoFlow, runVeo3ProjectFlow, runVeo3ProjectFlowByGroups } from '../automation/veo3Flow'
import { VEO3_SELECTORS as VEO3_SEL } from '../automation/veo3Selectors'

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let autoUpdateInterval: NodeJS.Timeout | null = null
let licenseRefreshInterval: NodeJS.Timeout | null = null
let hasDownloadedUpdate = false
const APP_DISPLAY_NAME = 'Loha Studio'

// ─── Activation / licensing (online key server) ───────────────────────────────
const LICENSE_STATE_FILE = 'license-state.json'
const DEVICE_ID_FILE = 'license-device-id.txt'
const LICENSE_OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000
const LICENSE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000
const LICENSE_API_BASE_URL = (process.env.LICENSE_API_BASE_URL || 'https://lohastudioadmin.vercel.app').replace(/\/+$/, '')
const LICENSE_ADMIN_URL = process.env.LICENSE_ADMIN_URL || `${LICENSE_API_BASE_URL}/admin`

type LicenseRole = 'user' | 'admin'

interface LicenseActivationStatus {
  activated: boolean
  role?: LicenseRole
  subject?: string
  keyCode?: string
  expiresAt?: number
  lastCheckedAt?: number
  reason?: string
  deviceId?: string
  apiBaseUrl?: string
  adminUrl?: string
}

interface LicenseServerInfo {
  id: string
  subject?: string
  keyCode?: string
  role?: LicenseRole
  expiresAt: number
}

interface LicenseStateFile {
  token?: string
  deviceId?: string
  lastCheckedAt?: number
  license?: LicenseServerInfo
}

function getLicenseStatePath(): string {
  return path.join(app.getPath('userData'), LICENSE_STATE_FILE)
}

function getDeviceIdPath(): string {
  return path.join(app.getPath('userData'), DEVICE_ID_FILE)
}

function readLicenseState(): LicenseStateFile {
  const fp = getLicenseStatePath()
  if (!fs.existsSync(fp)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'))
    return (raw && typeof raw === 'object') ? (raw as LicenseStateFile) : {}
  } catch {
    return {}
  }
}

function writeLicenseState(next: LicenseStateFile): void {
  fs.writeFileSync(getLicenseStatePath(), JSON.stringify(next, null, 2), 'utf8')
}

function getOrCreateDeviceId(): string {
  const fp = getDeviceIdPath()
  if (fs.existsSync(fp)) {
    const val = fs.readFileSync(fp, 'utf8').trim()
    if (val) return val
  }
  let deviceId = ''
  try {
    deviceId = machineIdSync(true)
  } catch {
    deviceId = `${os.hostname()}-${Date.now()}`
  }
  fs.writeFileSync(fp, deviceId, 'utf8')
  return deviceId
}

function getCachedActivationStatus(): LicenseActivationStatus {
  const now = Date.now()
  const state = readLicenseState()
  const deviceId = state.deviceId || getOrCreateDeviceId()
  const license = state.license
  if (!state.token || !license) {
    return {
      activated: false,
      reason: 'NO_LICENSE',
      deviceId,
      apiBaseUrl: LICENSE_API_BASE_URL,
      adminUrl: LICENSE_ADMIN_URL,
    }
  }
  if (license.expiresAt <= now) {
    return {
      activated: false,
      reason: 'EXPIRED',
      role: license.role,
      subject: license.subject,
      keyCode: license.keyCode,
      expiresAt: license.expiresAt,
      lastCheckedAt: state.lastCheckedAt,
      deviceId,
      apiBaseUrl: LICENSE_API_BASE_URL,
      adminUrl: LICENSE_ADMIN_URL,
    }
  }
  const lastCheckedAt = state.lastCheckedAt || 0
  const stale = now - lastCheckedAt > LICENSE_OFFLINE_GRACE_MS
  if (stale) {
    return {
      activated: false,
      reason: 'OFFLINE_GRACE_EXCEEDED',
      role: license.role,
      subject: license.subject,
      keyCode: license.keyCode,
      expiresAt: license.expiresAt,
      lastCheckedAt,
      deviceId,
      apiBaseUrl: LICENSE_API_BASE_URL,
      adminUrl: LICENSE_ADMIN_URL,
    }
  }
  return {
    activated: true,
    role: license.role || 'user',
    subject: license.subject,
    keyCode: license.keyCode,
    expiresAt: license.expiresAt,
    lastCheckedAt,
    deviceId,
    apiBaseUrl: LICENSE_API_BASE_URL,
    adminUrl: LICENSE_ADMIN_URL,
  }
}

async function refreshLicenseFromServer(): Promise<LicenseActivationStatus> {
  const state = readLicenseState()
  const token = state.token
  const deviceId = state.deviceId || getOrCreateDeviceId()
  if (!token) return getCachedActivationStatus()

  const res = await fetch(`${LICENSE_API_BASE_URL}/api/license/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-device-id': deviceId,
    },
  })
  if (!res.ok) throw new Error(`HTTP_${res.status}`)
  const data = await res.json() as { ok?: boolean; active?: boolean; license?: LicenseServerInfo; reason?: string }
  if (!data?.ok || !data?.active || !data.license) {
    writeLicenseState({ ...state, lastCheckedAt: Date.now(), license: undefined, token: undefined, deviceId })
    return {
      ...getCachedActivationStatus(),
      activated: false,
      reason: data?.reason || 'NOT_ACTIVE',
    }
  }
  writeLicenseState({
    ...state,
    deviceId,
    token,
    lastCheckedAt: Date.now(),
    license: data.license,
  })
  return getCachedActivationStatus()
}

function requireActivationForAction(actionName: string):
  | { ok: true }
  | { ok: false; error: string } {
  const status = getCachedActivationStatus()
  if (status.activated) return { ok: true }
  appLog('warn', `Blocked action without activation: ${actionName} (${status.reason ?? 'UNKNOWN'})`, 'license')
  return { ok: false, error: 'Ứng dụng chưa kích hoạt hợp lệ hoặc đã hết hạn. Vui lòng kích hoạt online.' }
}

function formatUpdaterError(err: unknown): { userMessage: string; raw: string } {
  const raw = String((err as any)?.message ?? err ?? '').trim()
  const oneLine = raw.split('\n')[0]?.trim() || raw
  const isGithubAtom404 = /releases\.atom/i.test(raw) && /404/i.test(raw)
  if (isGithubAtom404) {
    return {
      userMessage: 'Update channel chưa có release đầu tiên. Hãy publish tag vX.Y.Z trên GitHub.',
      raw,
    }
  }
  return { userMessage: oneLine.slice(0, 220), raw }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return
  if (process.env.DISABLE_AUTO_UPDATE === '1') {
    appLog('info', 'Auto update disabled by DISABLE_AUTO_UPDATE=1', 'main')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    appLog('info', 'Auto update: checking for updates', 'main')
    hasDownloadedUpdate = false
    send('app-update-status', { stage: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    appLog('info', `Auto update: update available -> ${info.version}`, 'main')
    send('app-update-status', { stage: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    appLog('info', `Auto update: no update available (current=${app.getVersion()}, latest=${info.version})`, 'main')
    send('app-update-status', { stage: 'up-to-date', version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    appLog('info', `Auto update: downloading ${progress.percent.toFixed(1)}%`, 'main')
    send('app-update-status', { stage: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    appLog('info', `Auto update: downloaded ${info.version}; will install on next app quit`, 'main')
    hasDownloadedUpdate = true
    send('app-update-status', { stage: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    const f = formatUpdaterError(err)
    appLog('warn', `Auto update: ${f.raw}`, 'main')
    send('app-update-status', { stage: 'error', message: f.userMessage })
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: any) => {
      appLog('warn', `Auto update check failed: ${err?.message ?? String(err)}`, 'main')
    })
  }, 15000)

  autoUpdateInterval = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err: any) => {
      appLog('warn', `Auto update periodic check failed: ${err?.message ?? String(err)}`, 'main')
    })
  }, 4 * 60 * 60 * 1000)
}

function setupLicenseRefreshLoop() {
  const run = async () => {
    try {
      const status = await refreshLicenseFromServer()
      send('license-status', status)
    } catch (err: any) {
      appLog('warn', `License refresh failed: ${err?.message ?? String(err)}`, 'license')
    }
  }
  setTimeout(run, 12000)
  licenseRefreshInterval = setInterval(run, LICENSE_REFRESH_INTERVAL_MS)
}

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    // Dev/runtime from project root
    path.join(process.cwd(), 'build', 'icon.ico'),
    // When app is launched from built output with different cwd
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    // Fallback for some packaged layouts
    path.join(process.resourcesPath, 'build', 'icon.ico'),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function createWindow() {
  const iconPath = resolveWindowIconPath()
  mainWindow = new BrowserWindow({
    width:           1100,
    height:          720,
    minWidth:        860,
    minHeight:       580,
    title:           APP_DISPLAY_NAME,
    ...(iconPath ? { icon: iconPath } : {}),
    backgroundColor: '#f5f4f1',
    titleBarStyle:   'hiddenInset',   // macOS: traffic lights overlap titlebar
    webPreferences: {
      // In electron-vite, built preload lives in ../preload/preload.js relative to out/main
      preload:         path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  mainWindow.setTitle(APP_DISPLAY_NAME)
}

app.whenReady().then(() => {
  app.setName(APP_DISPLAY_NAME)
  initAppLogger(app.getPath('userData'))
  appLog('info', 'Loha Studio ready', 'main')
  createWindow()
  setupAutoUpdater()
  setupLicenseRefreshLoop()
})

app.on('window-all-closed', () => {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval)
    autoUpdateInterval = null
  }
  if (licenseRefreshInterval) {
    clearInterval(licenseRefreshInterval)
    licenseRefreshInterval = null
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(channel: string, data: any) {
  mainWindow?.webContents.send(channel, data)
}

// ─── IPC: File pickers ────────────────────────────────────────────────────────

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return res.canceled ? null : res.filePaths[0]
})

ipcMain.handle('select-text-file', async () => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt'] }],
  })
  if (res.canceled || !res.filePaths[0]) return null
  return fs.readFileSync(res.filePaths[0], 'utf-8')
})

ipcMain.handle('select-images', async () => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  return res.canceled ? [] : res.filePaths
})

ipcMain.handle('select-credentials-file', async () => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt'] }],
  })
  if (res.canceled || !res.filePaths[0]) return null

  const filePath = res.filePaths[0]
  try {
    const credentials = parseCredentialsFile(filePath)
    appLog('info', `Credentials loaded: ${filePath} (${credentials.length} accounts)`, 'main')
    return { path: filePath, credentials }
  } catch (err: any) {
    appLog('error', `Credentials parse error: ${err.message}`, 'main')
    return { path: filePath, credentials: [], error: err.message }
  }
})

// ─── Logging (for renderer + open log folder) ────────────────────────────────
ipcMain.handle('log-to-file', (_e, payload: { level: string; message: string; source?: string }) => {
  const level = ['info', 'warn', 'error'].includes(payload.level) ? payload.level as 'info' | 'warn' | 'error' : 'info'
  appLog(level, payload.message, payload.source ?? 'renderer')
})
ipcMain.handle('get-log-directory', () => getLogDirectory())
ipcMain.handle('open-log-folder', async () => {
  const dir = getLogDirectory()
  if (!dir) return
  const { shell } = await import('electron')
  shell.openPath(dir).catch(() => {})
})

ipcMain.handle('check-for-updates-now', async () => {
  if (!app.isPackaged) return { success: false, error: 'Chỉ kiểm tra update ở bản đã build.' }
  try {
    await autoUpdater.checkForUpdates()
    return { success: true }
  } catch (err: any) {
    const f = formatUpdaterError(err)
    return { success: false, error: f.userMessage }
  }
})

ipcMain.handle('install-downloaded-update', async () => {
  if (!app.isPackaged) return { success: false, error: 'Chỉ cài update ở bản đã build.' }
  if (!hasDownloadedUpdate) return { success: false, error: 'Chưa có bản update nào đã tải xong.' }
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err: any) {
      appLog('error', `quitAndInstall failed: ${err?.message ?? String(err)}`, 'main')
    }
  }, 150)
  return { success: true }
})

const VEO3_SCRIPTS_FILE = 'veo3-scripts.json'
ipcMain.handle('get-scripts', async () => {
  const fp = path.join(app.getPath('userData'), VEO3_SCRIPTS_FILE)
  if (!fs.existsSync(fp)) return []
  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
})
ipcMain.handle('save-scripts', (_e, scripts: { id: string; name: string; prompts: string[] }[]) => {
  const fp = path.join(app.getPath('userData'), VEO3_SCRIPTS_FILE)
  fs.writeFileSync(fp, JSON.stringify(scripts || [], null, 2), 'utf-8')
})

ipcMain.handle('license-get-status', async () => {
  const status = getCachedActivationStatus()
  if (status.activated) {
    try {
      return await refreshLicenseFromServer()
    } catch {
      return getCachedActivationStatus()
    }
  }
  return status
})

ipcMain.handle('license-refresh-status', async () => {
  try {
    const status = await refreshLicenseFromServer()
    return { success: true, status }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err), status: getCachedActivationStatus() }
  }
})

ipcMain.handle('license-activate', async (_e, key: string) => {
  const trimmed = String(key || '').trim()
  if (!trimmed) return { success: false, error: 'Vui lòng nhập activation key.' }
  const deviceId = getOrCreateDeviceId()
  try {
    const res = await fetch(`${LICENSE_API_BASE_URL}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: trimmed,
        deviceId,
        appVersion: app.getVersion(),
      }),
    })
    const data = await res.json().catch(() => ({} as any))
    if (!res.ok || !data?.ok || !data?.token || !data?.license) {
      const reason = data?.error || data?.reason || `HTTP_${res.status}`
      appLog('warn', `License activate failed: ${reason}`, 'license')
      return { success: false, error: `Kích hoạt thất bại (${reason}).` }
    }
    const next: LicenseStateFile = {
      token: data.token,
      deviceId,
      lastCheckedAt: Date.now(),
      license: data.license as LicenseServerInfo,
    }
    writeLicenseState(next)
    const status = getCachedActivationStatus()
    appLog('info', `License activated: ${status.subject ?? 'unknown'} (${status.role ?? 'user'})`, 'license')
    return { success: true, status }
  } catch (err: any) {
    return { success: false, error: `Không kết nối được license server (${err?.message ?? String(err)}).` }
  }
})

ipcMain.handle('license-open-admin', async () => {
  if (!LICENSE_ADMIN_URL) return { success: false, error: 'LICENSE_ADMIN_URL chưa được cấu hình.' }
  const status = getCachedActivationStatus()
  if (status.role !== 'admin') return { success: false, error: 'Tài khoản hiện tại không có quyền admin.' }
  const { shell } = await import('electron')
  await shell.openExternal(LICENSE_ADMIN_URL)
  return { success: true }
})

// ─── Session state ────────────────────────────────────────────────────────────

interface SessionAccount {
  id:        string
  email:     string
  password:  string
  ctx?:      BrowserContext
  profileDir: string
}

let sessionAccounts: SessionAccount[] = []
let sessionAborted  = false
const PROFILES_DIR  = path.resolve('./profiles')

ipcMain.handle('stop-session', () => {
  sessionAborted = true
  for (const acct of sessionAccounts) {
    acct.ctx?.close().catch(() => {})
  }
  sessionAccounts = []
})

// ─── IPC: Open profiles (launch + login only, wait for queue) ─────────────────

ipcMain.handle('open-profiles', async (_event, credentialsPath: string) => {
  const gate = requireActivationForAction('open-profiles')
  if (!gate.ok) return { success: false, readyCount: 0, error: gate.error }

  sessionAborted = false
  sessionAccounts = []

  let credentials: { email: string; password: string }[]
  try {
    credentials = parseCredentialsFile(credentialsPath)
  } catch (err: any) {
    appLog('error', `Credentials: ${err.message}`, 'main')
    return { success: false, readyCount: 0, error: `Không đọc được file credentials: ${err.message}` }
  }

  const sessionDir = path.join(PROFILES_DIR, `session-${Date.now()}`)
  fs.mkdirSync(sessionDir, { recursive: true })

  sessionAccounts = credentials.map((c, i) => ({
    id:         `acct-${i}`,
    email:      c.email,
    password:   c.password,
    profileDir: path.join(sessionDir, `account-${String(i + 1).padStart(3, '0')}`),
  }))

  await Promise.allSettled(
    sessionAccounts.map((acct, i) => loginAccount(acct, i))
  )

  if (sessionAborted) return { success: false, readyCount: 0, error: 'Đã dừng' }

  const readyCount = sessionAccounts.filter(a => a.ctx).length
  if (readyCount === 0) {
    appLog('error', 'No account logged in successfully', 'main')
    return { success: false, readyCount: 0, error: 'Không có tài khoản nào đăng nhập thành công' }
  }

  appLog('info', `Profiles open: ${readyCount} accounts ready — add jobs and click Run queue`, 'main')
  return { success: true, readyCount }
})

// ─── IPC: Run queue (profiles must already be open) ───────────────────────────

interface FlatJob {
  projectId:   string
  projectName: string
  outputDir:   string
  jobId:       string
  index:       number
  prompt:      string
  mode:        string
  mediaType:   string
  ratio:       string
  resolution:  string
  duration:    string
  imageDir?:   string
}

function buildFlatJobs(queue: any[]): FlatJob[] {
  const flatJobs: FlatJob[] = []
  for (const project of queue) {
    for (const job of project.jobs) {
      flatJobs.push({
        projectId:   project.id,
        projectName: project.name,
        outputDir:   project.outputDir,
        jobId:       job.id,
        index:       job.index,
        prompt:      job.prompt,
        mode:        project.mode,
        mediaType:   project.mediaType,
        ratio:       project.ratio,
        resolution:  project.resolution,
        duration:    project.duration,
        imageDir:    project.imageDir,
      })
    }
  }
  return flatJobs
}

// Shared queue: workers consume via next(); append-queue pushes new jobs during run
let sharedJobQueue: FlatJob[] = []

ipcMain.handle('run-queue', async (_event, queue: any[]) => {
  const gate = requireActivationForAction('run-queue')
  if (!gate.ok) return { success: false, error: gate.error }

  const readyAccounts = sessionAccounts.filter(a => a.ctx)
  if (readyAccounts.length === 0) {
    return { success: false, error: 'Chưa mở profiles. Nhấn Start trước.' }
  }

  const flatJobs = buildFlatJobs(queue)
  if (flatJobs.length === 0) {
    return { success: false, error: 'Queue trống. Thêm dự án vào queue rồi nhấn Run queue.' }
  }

  sessionAborted = false
  let jobIndex = 0
  const jobsMutex = { next: () => flatJobs[jobIndex++] }
  let successCount = 0
  let failedCount  = 0

  appLog('info', `Run queue: ${flatJobs.length} jobs, ${readyAccounts.length} accounts`, 'main')

  await Promise.allSettled(
    readyAccounts.map(acct => runWorkerLoop(acct, jobsMutex, flatJobs, {
      onSuccess: () => successCount++,
      onFailed:  () => failedCount++,
    }))
  )

  // Profiles stay open — do NOT close. Send account back to ready.
  for (const acct of readyAccounts) {
    send('account-status', { accountId: acct.id, email: acct.email, status: 'ready' })
  }

  send('session-done', {
    success: true,
    summary: { total: flatJobs.length, success: successCount, failed: failedCount },
  })

  appLog('info', `Queue done: ${successCount}/${flatJobs.length} success, ${failedCount} failed`, 'main')
  return { success: true, summary: { total: flatJobs.length, success: successCount, failed: failedCount } }
})

// Append jobs to the running queue (call while session is running; new jobs run after current ones)
ipcMain.handle('append-queue', (_event, queueAddition: any[]) => {
  if (sessionAccounts.length === 0) return
  const added = buildFlatJobs(queueAddition)
  sharedJobQueue.push(...added)
  appLog('info', `Appended ${added.length} jobs to queue (total tail)`, 'main')
})

// ─── start-session: open profiles + run queue (single flow). Queue can be appended during run via append-queue.

ipcMain.handle('start-session', async (_event, config: {
  credentialsPath: string
  queue: any[]
}) => {
  const gate = requireActivationForAction('start-session')
  if (!gate.ok) return { success: false, error: gate.error }

  sessionAborted = false
  sessionAccounts = []

  let credentials: { email: string; password: string }[]
  try {
    credentials = parseCredentialsFile(config.credentialsPath)
  } catch (err: any) {
    appLog('error', `Credentials: ${err.message}`, 'main')
    return { success: false, error: `Không đọc được file credentials: ${err.message}` }
  }

  const sessionDir = path.join(PROFILES_DIR, `session-${Date.now()}`)
  fs.mkdirSync(sessionDir, { recursive: true })
  sessionAccounts = credentials.map((c, i) => ({
    id:         `acct-${i}`,
    email:      c.email,
    password:   c.password,
    profileDir: path.join(sessionDir, `account-${String(i + 1).padStart(3, '0')}`),
  }))

  await Promise.allSettled(
    sessionAccounts.map((acct, i) => loginAccount(acct, i))
  )
  if (sessionAborted) return { success: false, error: 'Session bị dừng' }

  const readyAccounts = sessionAccounts.filter(a => a.ctx)
  if (readyAccounts.length === 0) {
    appLog('error', 'No account logged in successfully', 'main')
    return { success: false, error: 'Không có tài khoản nào đăng nhập thành công' }
  }

  const flatJobs = buildFlatJobs(config.queue)
  if (flatJobs.length === 0) {
    for (const acct of sessionAccounts) acct.ctx?.close().catch(() => {})
    sessionAccounts = []
    return { success: false, error: 'Queue trống' }
  }

  sharedJobQueue = [...flatJobs]
  const jobsMutex = { next: () => sharedJobQueue.shift() ?? null }
  let successCount = 0
  let failedCount = 0
  await Promise.allSettled(
    readyAccounts.map(acct => runWorkerLoop(acct, jobsMutex, [], {
      onSuccess: () => successCount++,
      onFailed:  () => failedCount++,
    }))
  )

  const totalProcessed = successCount + failedCount
  for (const acct of sessionAccounts) acct.ctx?.close().catch(() => {})
  sessionAccounts = []
  sharedJobQueue = []
  // Delete Grok session profile dir when all jobs done (no accumulation)
  try {
    if (sessionDir && fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true })
      appLog('info', `Deleted session dir: ${sessionDir}`, 'main')
    }
  } catch (e) { appLog('warn', `Could not delete session dir: ${(e as Error).message}`, 'main') }
  send('session-done', { success: true, summary: { total: totalProcessed, success: successCount, failed: failedCount } })
  return { success: true, summary: { total: totalProcessed, success: successCount, failed: failedCount } }
})

// ─── Login 1 account ──────────────────────────────────────────────────────────

async function loginAccount(acct: SessionAccount, index: number): Promise<void> {
  send('account-status', { accountId: acct.id, email: acct.email, status: 'logging_in' })

  // Stagger
  await new Promise(r => setTimeout(r, index * 1500))

  fs.mkdirSync(acct.profileDir, { recursive: true })

  let ctx: BrowserContext
  try {
    ctx = await chromium.launchPersistentContext(acct.profileDir, {
      channel:  'chrome',
      headless: false,
      viewport: { width: 1280, height: 700 },
      args:     ['--no-sandbox'],
    })
  } catch (err: any) {
    appLog('error', `Launch Chrome failed [${acct.id}]: ${err.message}`, 'main')
    send('account-status', { accountId: acct.id, email: acct.email, status: 'failed', error: err.message })
    return
  }

  const login = new AccountLogin(ctx, acct.id, (_type, payload: any) => {
    if (_type === 'completed') {
      send('account-status', { accountId: acct.id, email: acct.email, status: 'ready' })
    } else if (_type === 'failed') {
      send('account-status', { accountId: acct.id, email: acct.email, status: 'failed', error: payload.error })
    }
  }, { onLog: (level, msg) => appLog(level, `[${acct.id}] ${msg}`, 'login') })

  const result = await login.login({ email: acct.email, password: acct.password })

  if (result.success) {
    acct.ctx = ctx
  } else {
    ctx.close().catch(() => {})
    send('account-status', { accountId: acct.id, email: acct.email, status: 'failed', error: result.error })
  }
}

// ─── Worker loop: 1 account xử lý jobs tuần tự ───────────────────────────────

async function runWorkerLoop(
  acct: SessionAccount,
  jobsMutex: { next: () => any },
  _allJobs: any[],
  cb: { onSuccess: () => void; onFailed: () => void }
): Promise<void> {
  if (!acct.ctx) return

  send('account-status', { accountId: acct.id, email: acct.email, status: 'running' })

  while (!sessionAborted) {
    const job = jobsMutex.next()
    if (!job) break  // queue rỗng

    try {
      // Tạo output dir: outputDir/projectName/
      const safeProjectName = job.projectName.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\s]/g, '').replace(/\s+/g, '_')
      const jobOutputDir    = path.join(job.outputDir, safeProjectName)
      fs.mkdirSync(jobOutputDir, { recursive: true })

      const ext        = job.mediaType === 'Video' ? 'mp4' : 'jpg'
      const outputPath = path.join(jobOutputDir, `${job.index + 1}.${ext}`)

      const worker = new BrowserWorker(acct.ctx!, job.jobId, (type, payload: any) => {
        if (type === 'progress') {
          send('job-progress', { projectId: job.projectId, jobId: job.jobId, progress: payload.percent ?? 0 })
        }
      }, { onLog: (level, msg) => appLog(level, `[${job.jobId}] ${msg}`, 'worker') })

      // Build GrokJob từ flat job
      const grokJob = buildGrokJob(job, outputPath)
      await worker.run(grokJob, outputPath)

      send('job-completed', { projectId: job.projectId, jobId: job.jobId, outputPath })
      cb.onSuccess()

    } catch (err: any) {
      const errMsg = err.message ?? String(err)
      appLog('error', `Job failed [${job.jobId}]: ${errMsg}`, 'main')

      // OUT_OF_QUOTA → account này hết quota, dừng loop, requeue job không làm được
      if (errMsg.includes('OUT_OF_QUOTA')) {
        send('account-status', { accountId: acct.id, email: acct.email, status: 'failed', error: 'Hết quota' })
        send('job-failed', { projectId: job.projectId, jobId: job.jobId, error: 'Hết quota — requeue' })
        // Đẩy job lại cuối queue (bằng cách giảm jobIndex không thực tế trong JS đơn luồng
        // nên ghi nhận là failed, cần cơ chế requeue riêng nếu muốn)
        cb.onFailed()
        break
      }

      send('job-failed', { projectId: job.projectId, jobId: job.jobId, error: errMsg })
      cb.onFailed()
    }
  }
}

// ─── Build GrokJob từ flat job ────────────────────────────────────────────────

function buildGrokJob(job: any, outputPath: string): any {
  const base = {
    id:            job.jobId,
    title:         `${job.projectName}_${job.index + 1}`,
    prompt:        job.prompt,
    ratio:         job.ratio,
    outputBaseDir: path.dirname(outputPath),
    outputPath,
  }

  switch (job.mode) {
    case 'prompt_only':
      return { ...base, mode: job.mediaType === 'Video' ? 'prompt-to-video' : 'prompt-to-image', resolution: job.resolution, duration: job.duration }
    case 'animate_image':
      if (!job.imageDir) {
        throw new Error('Thiếu thư mục ảnh cho mode animate_image')
      }
      // index trong UI là 0-based, file trên đĩa là 1-based (1.png ứng với job index 0)
      const imagePath = resolveImageForIndex(job.imageDir, job.index + 1)
      if (!imagePath) {
        throw new Error(`Không tìm thấy ảnh cho job #${job.index + 1} trong: ${job.imageDir}`)
      }
      return { ...base, mode: 'image-to-video', resolution: job.resolution, imagePath }
    case 'edit_image':
      if (!job.imageDir) {
        throw new Error('Thiếu thư mục ảnh cho mode edit_image')
      }
      const imagePaths = resolveImagesForIndex(job.imageDir, job.index + 1)
      if (!imagePaths.length) {
        throw new Error(`Không tìm thấy ảnh cho job #${job.index + 1} trong: ${job.imageDir}`)
      }
      return { ...base, mode: 'images-to-image', imagePaths: imagePaths.slice(0, 3) }
    default:
      return { ...base, mode: 'prompt-to-image' }
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

app.on('before-quit', async () => {
  for (const acct of sessionAccounts) {
    acct.ctx?.close().catch(() => {})
  }
  for (const v of veo3Profiles) {
    v.ctx?.close().catch(() => {})
  }
})

// ─── Veo3 (Google Flow) persistent profiles ───────────────────────────────────
// Profiles live under profiles/veo3/profile-001, profile-002, ...
// status.json in each dir: { loggedIn: boolean, email?: string }
// Login detection: https://labs.google/fx/vi/tools/flow — header profile pic (multiple selectors)

const VEO3_PROFILES_DIR = path.join(PROFILES_DIR, 'veo3')
const VEO3_FLOW_URL = 'https://labs.google/fx/vi/tools/flow'
const VEO3_FLOW_LANDING_URL = 'https://labs.google/fx/vi/tools/flow#pricing'
const VEO3_STATUS_FILE = 'status.json'
const VEO3_POLL_INTERVAL_MS = 6000
const VEO3_FIRST_POLL_DELAY_MS = 5000

const VEO3_LOGGED_IN_SELECTORS = [
  '.sc-c8eefe6-0.dqnnrd .sc-c8eefe6-8.cHonUi',
  'img[src*="googleusercontent.com"]',
  'img[alt*="hồ sơ"]',
  'img[alt*="profile" i]',
]

interface Veo3ProfileEntry {
  profileId: string
  profileDir: string
  ctx?: BrowserContext
  page?: Page
  loggedIn?: boolean
}

let veo3Profiles: Veo3ProfileEntry[] = []

/** Remove a Veo3 profile from the in-memory list and notify renderer (e.g. after user closed the browser). */
function removeVeo3Entry(profileId: string): void {
  const idx = veo3Profiles.findIndex(v => v.profileId === profileId)
  if (idx >= 0) {
    const profileDir = veo3Profiles[idx].profileDir
    veo3Profiles.splice(idx, 1)
    writeVeo3Status(profileDir, false)
    send('veo3-profile-status', { profileId, loggedIn: false })
  }
}

/** Drop entries whose page/context is closed and notify renderer; returns remaining count with valid page. */
function pruneClosedVeo3Profiles(): number {
  const closed: string[] = []
  for (const v of veo3Profiles) {
    try {
      if (v.page?.isClosed?.()) closed.push(v.profileId)
    } catch {
      closed.push(v.profileId)
    }
  }
  for (const id of closed) removeVeo3Entry(id)
  return veo3Profiles.filter(v => {
    try { return !!(v.page && typeof v.page.isClosed === 'function' && !v.page.isClosed()) } catch { return false }
  }).length
}

const VEO3_JOB_POLL_INTERVAL_MS = 4000
const VEO3_JOB_DEADLINE_MS = 5 * 60 * 1000

/** Poll page until generating progress reaches 100% or timeout; sends job-progress and job-completed. Returns when done. */
async function waitForVeo3JobCompletion(
  page: { isClosed: () => boolean; locator: (s: string) => { first: () => { textContent: (o: { timeout: number }) => Promise<string | null> } } },
  projectId: string,
  jobId: string,
  sendFn: (ch: string, d: any) => void
): Promise<void> {
  const deadline = Date.now() + VEO3_JOB_DEADLINE_MS
  while (Date.now() < deadline) {
    try {
      if (page.isClosed()) return
      const progEl = page.locator(VEO3_SEL.generatingProgress).first()
      const text = await progEl.textContent({ timeout: 2000 }).catch(() => null)
      const pct = text != null ? parseInt(String(text).replace(/%/g, ''), 10) : 0
      if (!Number.isNaN(pct)) sendFn('job-progress', { projectId, jobId, progress: Math.min(100, pct) })
      if (pct >= 100) {
        sendFn('job-completed', { projectId, jobId, outputPath: '' })
        return
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, VEO3_JOB_POLL_INTERVAL_MS))
  }
  sendFn('job-completed', { projectId, jobId, outputPath: '' })
}

function getVeo3ProfileDirByIndex(index: number): string {
  return path.join(VEO3_PROFILES_DIR, `profile-${String(index).padStart(3, '0')}`)
}

function getVeo3ProfileDirById(profileId: string): string {
  return path.join(VEO3_PROFILES_DIR, profileId)
}

function readVeo3Status(profileDir: string): { loggedIn: boolean; email?: string } | null {
  const fp = path.join(profileDir, VEO3_STATUS_FILE)
  if (!fs.existsSync(fp)) return null
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    return { loggedIn: !!j.loggedIn, email: j.email }
  } catch {
    return null
  }
}

function writeVeo3Status(profileDir: string, loggedIn: boolean, email?: string): void {
  const fp = path.join(profileDir, VEO3_STATUS_FILE)
  fs.mkdirSync(profileDir, { recursive: true })
  fs.writeFileSync(fp, JSON.stringify({ loggedIn, ...(email != null && { email }) }), 'utf-8')
}

ipcMain.handle('veo3-list-profiles', async () => {
  if (!fs.existsSync(VEO3_PROFILES_DIR)) {
    return { profiles: [] }
  }
  const dirs = fs.readdirSync(VEO3_PROFILES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^profile-\d{3}$/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const profiles = dirs.map(d => {
    const profileDir = path.join(VEO3_PROFILES_DIR, d.name)
    const profileId = d.name
    const status = readVeo3Status(profileDir)
    return { profileId, profileDir, loggedIn: status?.loggedIn ?? false, email: status?.email }
  })
  return { profiles }
})

ipcMain.handle('veo3-get-image-paths-from-dir', async (_event, dir: string) => {
  if (!dir || typeof dir !== 'string') return []
  return listImagePathsFromDir(dir)
})

async function isVeo3PageLoggedIn(page: Page): Promise<boolean> {
  for (const sel of VEO3_LOGGED_IN_SELECTORS) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) return true
    } catch {
      continue
    }
  }
  return false
}

async function tryGetEmailFromFlowPage(page: Page): Promise<string | undefined> {
  try {
    const email = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ''
      const m = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
      return m ? m[0] : null
    })
    return email ?? undefined
  } catch {
    return undefined
  }
}

async function pollVeo3LoginState(profileId: string, profileDir: string, page: Page | null): Promise<void> {
  if (!page) {
    send('veo3-profile-status', { profileId, loggedIn: false })
    return
  }
  try {
    const stillOpen = await page.evaluate(() => !document.hidden).catch(() => false)
    if (!stillOpen) return
    const loggedIn = await isVeo3PageLoggedIn(page)
    const entry = veo3Profiles.find(v => v.profileId === profileId)
    if (entry) entry.loggedIn = loggedIn
    if (loggedIn) {
      const email = await tryGetEmailFromFlowPage(page)
      writeVeo3Status(profileDir, true, email)
      send('veo3-profile-status', { profileId, loggedIn: true, email })
    } else {
      writeVeo3Status(profileDir, false)
      send('veo3-profile-status', { profileId, loggedIn: false })
    }
  } catch {
    const entry = veo3Profiles.find(v => v.profileId === profileId)
    if (entry) entry.loggedIn = false
    send('veo3-profile-status', { profileId, loggedIn: false })
  }
}

ipcMain.handle('veo3-open-profiles', async (_event, count: number) => {
  const gate = requireActivationForAction('veo3-open-profiles')
  if (!gate.ok) return { opened: 0, success: false, error: gate.error }

  const n = Math.min(Math.max(1, Math.floor(count)), 20)
  fs.mkdirSync(VEO3_PROFILES_DIR, { recursive: true })

  for (let i = 1; i <= n; i++) {
    const profileId = `profile-${String(i).padStart(3, '0')}`
    const profileDir = getVeo3ProfileDirByIndex(i)
    if (veo3Profiles.some(v => v.profileId === profileId && v.ctx)) {
      continue
    }
    fs.mkdirSync(profileDir, { recursive: true })
    try {
      const ctx = await chromium.launchPersistentContext(profileDir, {
        channel:  'chrome',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1366, height: 768 },
        args:     ['--no-sandbox'],
      })
      const page = await ctx.newPage()
      await page.goto(VEO3_FLOW_LANDING_URL, { waitUntil: 'domcontentloaded' })
      const status = readVeo3Status(profileDir)
      const entry: Veo3ProfileEntry = { profileId, profileDir, ctx, page, loggedIn: status?.loggedIn ?? false }
      veo3Profiles.push(entry)
      ctx.on('close', () => removeVeo3Entry(profileId))
      send('veo3-profile-status', { profileId, loggedIn: status?.loggedIn ?? false, email: status?.email })
      const poll = () => pollVeo3LoginState(profileId, profileDir, entry.page ?? null)
      setTimeout(poll, VEO3_FIRST_POLL_DELAY_MS)
      setInterval(poll, VEO3_POLL_INTERVAL_MS)
    } catch (err: any) {
      appLog('error', `Veo3 open profile ${profileId}: ${err.message}`, 'main')
      send('veo3-profile-status', { profileId, loggedIn: false, error: err.message })
    }
  }
  return { opened: n }
})

ipcMain.handle('veo3-open-selected-profiles', async (_event, profileIds: string[]) => {
  const gate = requireActivationForAction('veo3-open-selected-profiles')
  if (!gate.ok) return { opened: 0, success: false, error: gate.error }

  if (!Array.isArray(profileIds) || profileIds.length === 0) return { opened: 0 }
  fs.mkdirSync(VEO3_PROFILES_DIR, { recursive: true })
  let opened = 0
  for (const profileId of profileIds) {
    if (!/^profile-\d{3}$/.test(profileId)) continue
    const profileDir = getVeo3ProfileDirById(profileId)
    if (veo3Profiles.some(v => v.profileId === profileId && v.ctx)) continue
    fs.mkdirSync(profileDir, { recursive: true })
    try {
      const ctx = await chromium.launchPersistentContext(profileDir, {
        channel:  'chrome',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1366, height: 768 },
        args:     ['--no-sandbox'],
      })
      const page = await ctx.newPage()
      await page.goto(VEO3_FLOW_LANDING_URL, { waitUntil: 'domcontentloaded' })
      const status = readVeo3Status(profileDir)
      const entry: Veo3ProfileEntry = { profileId, profileDir, ctx, page, loggedIn: status?.loggedIn ?? false }
      veo3Profiles.push(entry)
      ctx.on('close', () => removeVeo3Entry(profileId))
      opened += 1
      send('veo3-profile-status', { profileId, loggedIn: status?.loggedIn ?? false, email: status?.email })
      const poll = () => pollVeo3LoginState(profileId, profileDir, entry.page ?? null)
      setTimeout(poll, VEO3_FIRST_POLL_DELAY_MS)
      setInterval(poll, VEO3_POLL_INTERVAL_MS)
    } catch (err: any) {
      appLog('error', `Veo3 open profile ${profileId}: ${err.message}`, 'main')
      send('veo3-profile-status', { profileId, loggedIn: false, error: err.message })
    }
  }
  return { opened }
})

ipcMain.handle('veo3-close-all', async () => {
  for (const v of veo3Profiles) {
    v.ctx?.close().catch(() => {})
  }
  veo3Profiles = []
})

/** Run one Veo3 job: uses first *logged-in* profile's Flow page; navigates to project list then runs create-video flow. */
ipcMain.handle('veo3-run-job', async (_event, payload: {
  projectId?: string
  jobId?: string
  jobIndex?: number
  debugUploadOnly?: boolean
  prompt: string
  imageDir: string
  aiModel?: 'veo-3.1-fast' | 'veo-3.1-fast-lower-priority' | 'veo-3.1-quality'
  videoMode: 'frames' | 'ingredients'
  landscape: boolean
  multiplier: 1 | 2 | 3 | 4
}) => {
  const gate = requireActivationForAction('veo3-run-job')
  if (!gate.ok) return { success: false, error: gate.error }

  pruneClosedVeo3Profiles()
  const entry = veo3Profiles.find(v => v.page && v.loggedIn)
  if (!entry?.page) {
    return { success: false, error: 'Không có profile Veo3 nào đang mở và đã đăng nhập. Mở ít nhất 1 profile và đăng nhập Flow trước.' }
  }
  const { projectId, jobId, jobIndex = 0, debugUploadOnly, prompt, imageDir, aiModel, videoMode, landscape, multiplier } = payload
  const imagePaths: string[] = []
  if (imageDir && fs.existsSync(imageDir)) {
    const needCount = videoMode === 'frames' ? 2 : 3
    for (let k = 0; k < needCount; k++) {
      const num = videoMode === 'frames' ? jobIndex * 2 + 1 + k : jobIndex * 3 + 1 + k
      const png = path.join(imageDir, `${num}.png`)
      const jpg = path.join(imageDir, `${num}.jpg`)
      if (fs.existsSync(png)) imagePaths.push(png)
      else if (fs.existsSync(jpg)) imagePaths.push(jpg)
    }
  }
  const profileIdUsed = entry.profileId
  const networkLog: { type: 'request' | 'response'; url: string; method?: string; status?: number; when: number }[] = []
  const onReq = (req: { url: () => string; method: () => string }) => {
    networkLog.push({ type: 'request', url: req.url(), method: req.method(), when: Date.now() })
  }
  const onRes = (res: { url: () => string; status: () => number }) => {
    networkLog.push({ type: 'response', url: res.url(), status: res.status(), when: Date.now() })
  }
  entry.page.on('request', onReq)
  entry.page.on('response', onRes)
  try {
    if (projectId && jobId && !debugUploadOnly) {
      send('job-progress', { projectId, jobId, progress: 5 })
    }
    await entry.page.goto(VEO3_FLOW_URL, { waitUntil: 'domcontentloaded' })
    if (projectId && jobId && !debugUploadOnly) {
      send('job-progress', { projectId, jobId, progress: 10 })
    }
    const result = await runVeo3CreateVideoFlow(entry.page, prompt, imagePaths, {
      aiModel,
      videoMode,
      landscape,
      multiplier,
      debugUploadOnly,
    })
    if (result && 'uploadLog' in result && result.uploadLog) {
      const logDir = getLogDirectory()
      if (logDir) {
        const fp = path.join(logDir, `veo3-upload-log-${Date.now()}.json`)
        try {
          fs.writeFileSync(fp, JSON.stringify(result.uploadLog, null, 2), 'utf-8')
          appLog('info', `Veo3 upload log: ${result.uploadLog.length} request(s) → ${fp}`, 'main')
        } catch (e: any) {
          appLog('warn', `Could not write upload log: ${e?.message}`, 'main')
        }
      }
      return { success: true, debugUploadOnly: true }
    }
    if (projectId && jobId && !debugUploadOnly) {
      await waitForVeo3JobCompletion(entry.page, projectId, jobId, send)
    }
    return { success: true }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    const isClosed = /target page, context or browser has been closed|page.*closed|context.*closed/i.test(msg)
    if (isClosed) {
      removeVeo3Entry(profileIdUsed)
      return { success: false, error: 'Trình duyệt profile đã đóng. Vui lòng mở lại profile và thử lại.' }
    }
    if (projectId && jobId) send('job-failed', { projectId, jobId, error: msg })
    appLog('error', `Veo3 run job: ${msg}`, 'main')
    return { success: false, error: msg }
  } finally {
    entry.page.off('request', onReq)
    entry.page.off('response', onRes)
    const logDir = getLogDirectory()
    if (logDir && networkLog.length > 0) {
      const fp = path.join(logDir, `veo3-network-${Date.now()}.json`)
      try {
        fs.writeFileSync(fp, JSON.stringify(networkLog, null, 2), 'utf-8')
        appLog('info', `Veo3 network log: ${networkLog.length} entries → ${fp}`, 'main')
      } catch (e: any) {
        appLog('warn', `Could not write network log: ${e?.message}`, 'main')
      }
    }
  }
})

const VEO3_DELAY_BETWEEN_PROMPTS_MS = 30 * 1000

ipcMain.handle('veo3-run-queue', async (_event,   queue: Array<{
  id: string
  name: string
  outputDir: string
  aiModel?: 'veo-3.1-fast' | 'veo-3.1-fast-lower-priority' | 'veo-3.1-quality'
  jobs: Array<{ id: string; index: number; prompt: string; status: string; scriptIndex?: number; imageIndex?: number }>
  imageDir?: string
  startFramesDir?: string
  endFramesDir?: string
  videoMode: 'frames' | 'ingredients'
  landscape: boolean
  multiplier: 1 | 2 | 3 | 4
}>) => {
  const gate = requireActivationForAction('veo3-run-queue')
  if (!gate.ok) return { success: false, error: gate.error }

  pruneClosedVeo3Profiles()
  const profiles = veo3Profiles.filter(v => v.page && v.loggedIn)
  if (profiles.length === 0) return { success: false, error: 'Không có profile Veo3 nào đang mở và đã đăng nhập.' }
  const projectsWithPending = queue
    .map(q => ({
      ...q,
      pendingJobs: q.jobs.filter((j: { status: string }) => j.status === 'pending').sort((a: { index: number }, b: { index: number }) => a.index - b.index),
    }))
    .filter(q => q.pendingJobs.length > 0)
  if (projectsWithPending.length === 0) return { success: false, error: 'Queue trống hoặc không có job đang chờ.' }
  const projectQueue: typeof projectsWithPending = [...projectsWithPending]
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  async function runProjectOnEntry(
    entry: { page: any; profileId: string },
    project: typeof projectsWithPending[0]
  ): Promise<{ success: boolean }> {
    const prompts = project.pendingJobs.map((j: { prompt: string }) => j.prompt)
    const startDir = project.startFramesDir || project.imageDir || ''
    const endDir = project.endFramesDir || ''
    const hasImageIndex = project.pendingJobs.some((j: { imageIndex?: number }) => j.imageIndex !== undefined)
    const hasScriptIndices = project.pendingJobs.some((j: { scriptIndex?: number }) => j.scriptIndex !== undefined)
    const scriptIndexPerJob = !hasImageIndex && hasScriptIndices
      ? project.pendingJobs.map((j: { scriptIndex?: number }) => j.scriptIndex ?? 0)
      : undefined
    const imageIndexPerJob = hasImageIndex
      ? project.pendingJobs.map((j: { imageIndex?: number }) => j.imageIndex ?? 0)
      : undefined
    const startImagesInDir = startDir ? listImagePathsFromDir(startDir) : []
    const endImagesInDir = endDir ? listImagePathsFromDir(endDir) : []

    const groups: { imagePaths: string[]; prompts: string[] }[] = []
    if (imageIndexPerJob != null) {
      // 1 project = 1 script, multiple images; each image runs through all prompts
      const byImage = new Map<number, string[]>()
      imageIndexPerJob.forEach((imageIdx, i) => {
        if (!byImage.has(imageIdx)) byImage.set(imageIdx, [])
        byImage.get(imageIdx)!.push(prompts[i])
      })
      const sortedImageIndices = Array.from(byImage.keys()).sort((a, b) => a - b)
      for (const imageIdx of sortedImageIndices) {
        const groupPrompts = byImage.get(imageIdx)!
        // Script mode: use folder import order (no numbered filename requirement).
        const startPath = startImagesInDir[imageIdx]
        const endPath = endImagesInDir[imageIdx]
        const imagePaths: string[] = []
        if (startPath) imagePaths.push(startPath)
        if (endPath && endPath !== startPath) imagePaths.push(endPath)
        if (imagePaths.length > 0) groups.push({ imagePaths, prompts: groupPrompts })
      }
    } else if (scriptIndexPerJob != null) {
      const byScript = new Map<number, string[]>()
      scriptIndexPerJob.forEach((scriptIdx, i) => {
        if (!byScript.has(scriptIdx)) byScript.set(scriptIdx, [])
        byScript.get(scriptIdx)!.push(prompts[i])
      })
      const sortedScriptIndices = Array.from(byScript.keys()).sort((a, b) => a - b)
      for (const scriptIdx of sortedScriptIndices) {
        const groupPrompts = byScript.get(scriptIdx)!
        const indexOneBased = scriptIdx + 1
        const startPath = startDir && resolveImageForIndex(startDir, indexOneBased)
        const endPath = endDir && resolveImageForIndex(endDir, indexOneBased)
        const imagePaths: string[] = []
        if (startPath) imagePaths.push(startPath)
        if (endPath && endPath !== startPath) imagePaths.push(endPath)
        groups.push({ imagePaths, prompts: groupPrompts })
      }
    } else {
      for (let i = 0; i < prompts.length; i++) {
        const indexOneBased = i + 1
        const startPath = startDir && resolveImageForIndex(startDir, indexOneBased)
        const endPath = endDir && resolveImageForIndex(endDir, indexOneBased)
        const imagePaths: string[] = []
        if (startPath) imagePaths.push(startPath)
        if (endPath && endPath !== startPath) imagePaths.push(endPath)
        groups.push({ imagePaths, prompts: [prompts[i]] })
      }
    }

    for (const job of project.pendingJobs) {
      send('job-progress', { projectId: project.id, jobId: job.id, progress: 5 })
    }
    const networkLog: { type: 'request' | 'response'; url: string; method?: string; status?: number; when: number }[] = []
    const onReq = (req: { url: () => string; method: () => string }) => { networkLog.push({ type: 'request', url: req.url(), method: req.method(), when: Date.now() }) }
    const onRes = (res: { url: () => string; status: () => number }) => { networkLog.push({ type: 'response', url: res.url(), status: res.status(), when: Date.now() }) }
    entry.page.on('request', onReq)
    entry.page.on('response', onRes)
    try {
      await entry.page.goto(VEO3_FLOW_URL, { waitUntil: 'domcontentloaded' })
      for (const job of project.pendingJobs) {
        send('job-progress', { projectId: project.id, jobId: job.id, progress: 10 })
      }
      const expectedCount = project.pendingJobs.length * Math.max(1, project.multiplier ?? 2)
      const outputDirForProject = path.join(project.outputDir, project.name.replace(/\s+/g, '_').toLowerCase())
      const savedPaths = await runVeo3ProjectFlowByGroups(entry.page, groups, {
        aiModel: project.aiModel,
        videoMode: project.videoMode,
        landscape: project.landscape,
        multiplier: project.multiplier,
      }, {
        outputDir: outputDirForProject,
        expectedCount,
        onProgress: (completedCount) => {
          for (let i = 0; i < completedCount && i < project.pendingJobs.length; i++) {
            send('job-progress', { projectId: project.id, jobId: project.pendingJobs[i].id, progress: 100 })
          }
        },
      })
      for (let i = 0; i < project.pendingJobs.length; i++) {
        send('job-completed', {
          projectId: project.id,
          jobId: project.pendingJobs[i].id,
          outputPath: savedPaths[i] ?? '',
        })
      }
      return { success: true }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (/target page, context or browser has been closed|page.*closed|context.*closed/i.test(msg)) removeVeo3Entry(entry.profileId)
      for (const job of project.pendingJobs) {
        send('job-failed', { projectId: project.id, jobId: job.id, error: msg })
      }
      appLog('error', `Veo3 queue project: ${msg}`, 'main')
      return { success: false }
    } finally {
      entry.page.off('request', onReq)
      entry.page.off('response', onRes)
      const logDir = getLogDirectory()
      if (logDir && networkLog.length > 0) {
        try { fs.writeFileSync(path.join(logDir, `veo3-network-${Date.now()}.json`), JSON.stringify(networkLog, null, 2), 'utf-8') } catch (_) {}
      }
    }
  }

  appLog('info', `Veo3 queue: ${projectQueue.length} project(s), ${profiles.length} profile(s) — one project per profile, all images uploaded once, 30s between prompts`, 'main')
  await Promise.all(
    profiles.map(async (ent) => {
      if (!ent.page) return
      const entry = { page: ent.page, profileId: ent.profileId }
      while (projectQueue.length > 0) {
        const project = projectQueue.shift()!
        await runProjectOnEntry(entry, project)
      }
    })
  )
  send('session-done', { success: true, summary: { total: projectsWithPending.reduce((s, p) => s + p.pendingJobs.length, 0), success: 0, failed: 0 } })
  return { success: true }
})