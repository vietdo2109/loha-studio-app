/**
 * FLOW AUTOMATION — Electron Main Process
 * File: src/main/main.ts
 *
 * IPC handlers:
 *   select-directory        → folder picker
 *   select-text-file        → .txt file picker, returns content
 *   select-images           → image file picker, returns paths[]
 *   select-credentials-file → .txt picker (optional / legacy)
 *   grok-list-profiles / grok-open-profiles / grok-open-selected-profiles / grok-close-all
 *   run-queue               → job queue (Grok profiles must be open + logged in)
 *   stop-session            → abort running queue (does not close Grok browsers)
 *
 * Events emitted to renderer:
 *   account-status  { accountId, status, email, error? }
 *   grok-profile-status { profileId, loggedIn, email?, error? }
 *   job-progress    { projectId, jobId, progress }
 *   job-completed   { projectId, jobId, outputPath }
 *   job-failed      { projectId, jobId, error, errorDetail?, stepLabel?, screenshotPath? }
 *   session-done    { success, summary }
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import * as fs from 'fs'
import os from 'os'
import { spawn, type ChildProcess } from 'child_process'
import { machineIdSync } from 'node-machine-id'
import { autoUpdater } from 'electron-updater'
import { chromium, Browser, BrowserContext, Page } from 'patchright'
import { BrowserWorker } from '../automation/BrowserWorker'
import { parseCredentialsFile } from '../automation/AccountLogin'
import { resolveImageForIndex, resolveImagesForIndex, resolveAllImagePathsFromDir, listImagePathsFromDir } from '../automation/inputParser'
import { initAppLogger, appLog, getLogDirectory } from './logger'
import { captureVeo3FlowPageScreenshot } from './flowErrorScreenshot'
import { createVeo3RunDirectory, pruneVeo3RunDirectories, MAX_VEO3_RUN_RECORDS } from './runLogRetention'
import {
  setFlowLogSink,
  setFlowLogContext,
  clearFlowLogContext,
  formatPayloadForFile,
  humanizePlaywrightError,
  describeFlowStepFromError,
  FLOW_VEO3_SERVER_BLOCK_HINT_VI,
  type FlowLogPayload,
} from '../automation/flowActionLog'
import { setBlockingUiNotify } from '../automation/blockingUiNotify'
import { runVeo3CreateVideoFlow, runVeo3ProjectFlow, runVeo3ProjectFlowByGroups, isFlowPageBusy } from '../automation/veo3Flow'
import { VEO3_SELECTORS as VEO3_SEL } from '../automation/veo3Selectors'
import { warmProfile, refreshProfileCookies, startHumanBehaviorLoop, type WarmingProgress, type HumanBehaviorHandle } from '../automation/profileWarming'

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let autoUpdateInterval: NodeJS.Timeout | null = null
let licenseRefreshInterval: NodeJS.Timeout | null = null
let hasDownloadedUpdate = false
declare const __APP_DISPLAY_NAME__: string
declare const __BUILD_ICON_FILE__: string
const APP_DISPLAY_NAME = typeof __APP_DISPLAY_NAME__ !== 'undefined' ? __APP_DISPLAY_NAME__ : 'Loha Studio'
const BUILD_ICON_FILE = typeof __BUILD_ICON_FILE__ !== 'undefined' ? __BUILD_ICON_FILE__ : 'icon.ico'

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
  /** From server; if missing (old cache), treat as true for Veo/Grok — false only for Sora */
  veoActive?: boolean
  grokActive?: boolean
  soraActive?: boolean
}

interface LicenseServerInfo {
  id: string
  subject?: string
  keyCode?: string
  role?: LicenseRole
  expiresAt: number
  veoActive?: boolean
  grokActive?: boolean
  soraActive?: boolean
}

interface LicenseStateFile {
  token?: string
  deviceId?: string
  lastCheckedAt?: number
  license?: LicenseServerInfo
}

function licenseFeatureFlags(license: LicenseServerInfo | undefined): Pick<LicenseActivationStatus, 'veoActive' | 'grokActive' | 'soraActive'> {
  if (!license) return { veoActive: false, grokActive: false, soraActive: false }
  return {
    veoActive: license.veoActive !== false,
    grokActive: license.grokActive !== false,
    soraActive: license.soraActive === true,
  }
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
    ...licenseFeatureFlags(license),
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

type LicenseFeature = 'veo' | 'grok' | 'sora'

/** Block automation for AI products not enabled on this license (server flags). */
function requireLicenseFeature(feature: LicenseFeature, actionName: string):
  | { ok: true }
  | { ok: false; error: string } {
  const base = requireActivationForAction(actionName)
  if (!base.ok) return base
  const status = getCachedActivationStatus()
  if (!status.activated) return base
  if (feature === 'veo' && status.veoActive === false) {
    appLog('warn', `Blocked ${actionName}: Veo3 not enabled on license`, 'license')
    return {
      ok: false,
      error: 'License này không bật Veo3 (Google Flow). Liên hệ admin để bật trên key của bạn.',
    }
  }
  if (feature === 'grok' && status.grokActive === false) {
    appLog('warn', `Blocked ${actionName}: Grok not enabled on license`, 'license')
    return {
      ok: false,
      error: 'License này không bật Grok Imagine. Liên hệ admin để bật trên key của bạn.',
    }
  }
  if (feature === 'sora' && status.soraActive !== true) {
    appLog('warn', `Blocked ${actionName}: Sora not enabled on license`, 'license')
    return {
      ok: false,
      error: 'License này không bật Sora. Liên hệ admin để bật trên key của bạn.',
    }
  }
  return { ok: true }
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
  const iconName = BUILD_ICON_FILE
  const candidates = [
    // Dev/runtime from project root
    path.join(process.cwd(), 'build', iconName),
    // When app is launched from built output with different cwd
    path.join(app.getAppPath(), 'build', iconName),
    // Fallback for some packaged layouts (extraResources)
    path.join(process.resourcesPath, 'build', iconName),
    // Fallback to default icon.ico
    path.join(process.cwd(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.ico'),
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
  initAppLogger(app.getPath('userData'), APP_DISPLAY_NAME)
  appLog('info', `${APP_DISPLAY_NAME} ready`, 'main')
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

/**
 * Gắn nhật ký phiên Flow: mỗi lần chạy = một thư mục `logs/runs/<runId>/` (flow-actions.log + file khác cùng phiên).
 * Chỉ giữ tối đa MAX_VEO3_RUN_RECORDS thư mục gần nhất.
 */
function beginVeo3FlowLogSession(meta: { projectId?: string; jobId?: string }): { end: () => void; runDir: string | null } {
  setFlowLogContext(meta)
  const logDir = getLogDirectory()
  let fp: string | null = null
  let runDir: string | null = null
  if (logDir) {
    try {
      const created = createVeo3RunDirectory(logDir)
      runDir = created.runDir
      fp = path.join(runDir, 'flow-actions.log')
      fs.writeFileSync(
        fp,
        `# Flow — ${new Date().toISOString()}\n# projectId=${meta.projectId ?? ''} jobId=${meta.jobId ?? ''}\n# runDir=${runDir}\n\n`,
        'utf8'
      )
      pruneVeo3RunDirectories(logDir, MAX_VEO3_RUN_RECORDS)
    } catch {
      fp = null
      runDir = null
    }
  }
  /** Chỉ ghi file — không gửi log kỹ thuật lên renderer (tránh lộ logic + spam UI). */
  const sink = (p: FlowLogPayload) => {
    if (fp) {
      try {
        fs.appendFileSync(fp, formatPayloadForFile(p), 'utf8')
      } catch {
        /* ignore */
      }
    }
  }
  setFlowLogSink(sink)
  setBlockingUiNotify(payload => {
    send('veo3-flow-notify', { ...meta, ...payload })
  })
  const end = () => {
    setFlowLogSink(null)
    setBlockingUiNotify(null)
    clearFlowLogContext()
    if (fp) {
      appLog('info', `Nhật ký thao tác Flow: ${fp}`, 'veo3')
    }
  }
  return { end, runDir }
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

/** Hiển thị file trong Explorer (ảnh chụp lỗi Flow). */
ipcMain.handle('show-item-in-folder', async (_e, filePath: string) => {
  if (!filePath || typeof filePath !== 'string') return false
  try {
    if (!fs.existsSync(filePath)) return false
  } catch {
    return false
  }
  const { shell } = await import('electron')
  shell.showItemInFolder(filePath)
  return true
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

// ─── Session / Grok queue state ───────────────────────────────────────────────

let sessionAborted = false
const PROFILES_DIR = path.resolve('./profiles')

// ─── Grok (grok.com/imagine) persistent profiles — same model as Veo3 ─────────
// profiles/grok/profile-001 … status.json { loggedIn, email? }

const GROK_PROFILES_DIR = path.join(PROFILES_DIR, 'grok')
const GROK_IMAGINE_URL = 'https://grok.com/imagine'
const GROK_STATUS_FILE = 'status.json'
const GROK_POLL_INTERVAL_MS = 6000
const GROK_FIRST_POLL_DELAY_MS = 5000

const GROK_LOGGED_IN_SELECTORS = [
  '[data-sidebar="footer"] button[aria-haspopup="menu"]',
  '[data-sidebar="sidebar"] button[aria-haspopup="menu"]',
]

interface GrokProfileEntry {
  profileId: string
  profileDir: string
  ctx?: BrowserContext
  page?: Page
  loggedIn?: boolean
}

let grokProfiles: GrokProfileEntry[] = []

function getGrokProfileDirByIndex(index: number): string {
  return path.join(GROK_PROFILES_DIR, `profile-${String(index).padStart(3, '0')}`)
}

function getGrokProfileDirById(profileId: string): string {
  return path.join(GROK_PROFILES_DIR, profileId)
}

function readGrokStatus(profileDir: string): { loggedIn: boolean; email?: string } | null {
  const fp = path.join(profileDir, GROK_STATUS_FILE)
  if (!fs.existsSync(fp)) return null
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    return { loggedIn: !!j.loggedIn, email: j.email }
  } catch {
    return null
  }
}

function writeGrokStatus(profileDir: string, loggedIn: boolean, email?: string): void {
  const fp = path.join(profileDir, GROK_STATUS_FILE)
  fs.mkdirSync(profileDir, { recursive: true })
  fs.writeFileSync(fp, JSON.stringify({ loggedIn, ...(email != null && { email }) }), 'utf-8')
}

function removeGrokEntry(profileId: string): void {
  const idx = grokProfiles.findIndex(v => v.profileId === profileId)
  if (idx >= 0) {
    const profileDir = grokProfiles[idx].profileDir
    grokProfiles.splice(idx, 1)
    writeGrokStatus(profileDir, false)
    send('grok-profile-status', { profileId, loggedIn: false })
  }
}

function pruneClosedGrokProfiles(): void {
  const closed: string[] = []
  for (const v of grokProfiles) {
    try {
      if (v.page?.isClosed?.()) closed.push(v.profileId)
    } catch {
      closed.push(v.profileId)
    }
  }
  for (const id of closed) removeGrokEntry(id)
}

async function isGrokPageLoggedIn(page: Page): Promise<boolean> {
  for (const sel of GROK_LOGGED_IN_SELECTORS) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) return true
    } catch {
      continue
    }
  }
  return false
}

async function pollGrokLoginState(profileId: string, profileDir: string, page: Page | null): Promise<void> {
  if (!page) {
    send('grok-profile-status', { profileId, loggedIn: false })
    return
  }
  try {
    const loggedIn = await isGrokPageLoggedIn(page)
    const entry = grokProfiles.find(v => v.profileId === profileId)
    if (entry) entry.loggedIn = loggedIn
    const st = readGrokStatus(profileDir)
    const email = st?.email
    if (loggedIn) {
      writeGrokStatus(profileDir, true, email)
      send('grok-profile-status', { profileId, loggedIn: true, email })
    } else {
      writeGrokStatus(profileDir, false)
      send('grok-profile-status', { profileId, loggedIn: false })
    }
  } catch {
    const entry = grokProfiles.find(v => v.profileId === profileId)
    if (entry) entry.loggedIn = false
    send('grok-profile-status', { profileId, loggedIn: false })
  }
}

interface GrokWorkerAccount {
  id: string
  email: string
  ctx: BrowserContext
  profileDir: string
}

function getGrokReadyWorkers(): GrokWorkerAccount[] {
  pruneClosedGrokProfiles()
  return grokProfiles
    .filter(v => v.ctx && v.loggedIn)
    .map(v => {
      const st = readGrokStatus(v.profileDir)
      return {
        id: v.profileId,
        email: st?.email ?? v.profileId,
        profileDir: v.profileDir,
        ctx: v.ctx!,
      }
    })
}

ipcMain.handle('grok-list-profiles', async () => {
  if (!fs.existsSync(GROK_PROFILES_DIR)) {
    return { profiles: [] as { profileId: string; profileDir: string; loggedIn: boolean; email?: string }[] }
  }
  const dirs = fs.readdirSync(GROK_PROFILES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^profile-\d{3}$/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const profiles = dirs.map(d => {
    const profileDir = path.join(GROK_PROFILES_DIR, d.name)
    const profileId = d.name
    const status = readGrokStatus(profileDir)
    return { profileId, profileDir, loggedIn: status?.loggedIn ?? false, email: status?.email }
  })
  return { profiles }
})

ipcMain.handle('grok-open-profiles', async (_event, count: number) => {
  const gate = requireLicenseFeature('grok', 'grok-open-profiles')
  if (!gate.ok) return { opened: 0, success: false, error: gate.error }

  const n = Math.min(Math.max(1, Math.floor(count)), 20)
  fs.mkdirSync(GROK_PROFILES_DIR, { recursive: true })

  for (let i = 1; i <= n; i++) {
    const profileId = `profile-${String(i).padStart(3, '0')}`
    const profileDir = getGrokProfileDirByIndex(i)
    if (grokProfiles.some(v => v.profileId === profileId && v.ctx)) {
      continue
    }
    fs.mkdirSync(profileDir, { recursive: true })
    try {
      const ctx = await chromium.launchPersistentContext(profileDir, {
        channel:  'chrome',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1280, height: 700 },
        args:     ['--no-sandbox'],
      })
      const page = await ctx.newPage()
      await page.goto(GROK_IMAGINE_URL, { waitUntil: 'domcontentloaded' })
      const status = readGrokStatus(profileDir)
      const entry: GrokProfileEntry = { profileId, profileDir, ctx, page, loggedIn: status?.loggedIn ?? false }
      grokProfiles.push(entry)
      ctx.on('close', () => removeGrokEntry(profileId))
      send('grok-profile-status', { profileId, loggedIn: status?.loggedIn ?? false, email: status?.email })
      const poll = () => pollGrokLoginState(profileId, profileDir, entry.page ?? null)
      setTimeout(poll, GROK_FIRST_POLL_DELAY_MS)
      setInterval(poll, GROK_POLL_INTERVAL_MS)
    } catch (err: any) {
      appLog('error', `Grok open profile ${profileId}: ${err.message}`, 'main')
      send('grok-profile-status', { profileId, loggedIn: false, error: err.message })
    }
  }
  return { opened: n }
})

ipcMain.handle('grok-open-selected-profiles', async (_event, profileIds: string[]) => {
  const gate = requireLicenseFeature('grok', 'grok-open-selected-profiles')
  if (!gate.ok) return { opened: 0, success: false, error: gate.error }

  if (!Array.isArray(profileIds) || profileIds.length === 0) return { opened: 0 }
  fs.mkdirSync(GROK_PROFILES_DIR, { recursive: true })
  let opened = 0
  for (const profileId of profileIds) {
    if (!/^profile-\d{3}$/.test(profileId)) continue
    const profileDir = getGrokProfileDirById(profileId)
    if (grokProfiles.some(v => v.profileId === profileId && v.ctx)) continue
    fs.mkdirSync(profileDir, { recursive: true })
    try {
      const ctx = await chromium.launchPersistentContext(profileDir, {
        channel:  'chrome',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1280, height: 700 },
        args:     ['--no-sandbox'],
      })
      const page = await ctx.newPage()
      await page.goto(GROK_IMAGINE_URL, { waitUntil: 'domcontentloaded' })
      const status = readGrokStatus(profileDir)
      const entry: GrokProfileEntry = { profileId, profileDir, ctx, page, loggedIn: status?.loggedIn ?? false }
      grokProfiles.push(entry)
      ctx.on('close', () => removeGrokEntry(profileId))
      opened += 1
      send('grok-profile-status', { profileId, loggedIn: status?.loggedIn ?? false, email: status?.email })
      const poll = () => pollGrokLoginState(profileId, profileDir, entry.page ?? null)
      setTimeout(poll, GROK_FIRST_POLL_DELAY_MS)
      setInterval(poll, GROK_POLL_INTERVAL_MS)
    } catch (err: any) {
      appLog('error', `Grok open profile ${profileId}: ${err.message}`, 'main')
      send('grok-profile-status', { profileId, loggedIn: false, error: err.message })
    }
  }
  return { opened }
})

ipcMain.handle('grok-close-all', async () => {
  for (const v of grokProfiles) {
    v.ctx?.close().catch(() => {})
  }
  grokProfiles = []
})

ipcMain.handle('stop-session', () => {
  sessionAborted = true
})

let veo3QueueAbortRequested = false
let veo3QueueRunning = false

ipcMain.handle('veo3-stop-queue', () => {
  if (!veo3QueueRunning) return { success: true, running: false }
  veo3QueueAbortRequested = true
  appLog('warn', 'Veo3 queue: stop requested by user', 'main')
  return { success: true, running: true }
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
  /** 1 kịch bản + nhiều ảnh: chỉ số ảnh trong folder (0-based), giống Veo3 */
  imageIndex?: number
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
        imageIndex:  job.imageIndex,
      })
    }
  }
  return flatJobs
}

// Shared queue: workers consume via next(); append-queue pushes new jobs during run
let sharedJobQueue: FlatJob[] = []

ipcMain.handle('run-queue', async (_event, queue: any[]) => {
  const gate = requireLicenseFeature('grok', 'run-queue')
  if (!gate.ok) return { success: false, error: gate.error }

  const readyAccounts = getGrokReadyWorkers()
  if (readyAccounts.length === 0) {
    return { success: false, error: 'Chưa có profile Grok đang mở và đã đăng nhập. Vào Grok tài khoản → mở profile và đăng nhập grok.com/imagine.' }
  }

  const flatJobs = buildFlatJobs(queue)
  if (flatJobs.length === 0) {
    return { success: false, error: 'Queue trống. Thêm dự án vào queue rồi nhấn Run queue.' }
  }

  sessionAborted = false
  const pendingJobs = [...flatJobs]
  const jobsMutex = { next: () => pendingJobs.shift() ?? null }
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
  const gate = requireLicenseFeature('grok', 'append-queue')
  if (!gate.ok) {
    appLog('warn', `append-queue blocked: ${gate.error}`, 'license')
    return
  }
  if (getGrokReadyWorkers().length === 0) return
  const added = buildFlatJobs(queueAddition)
  sharedJobQueue.push(...added)
  appLog('info', `Appended ${added.length} jobs to queue (total tail)`, 'main')
})

// ─── start-session: open profiles + run queue (single flow). Queue can be appended during run via append-queue.

ipcMain.handle('start-session', async (_event, config: { queue: any[] }) => {
  const gate = requireLicenseFeature('grok', 'start-session')
  if (!gate.ok) return { success: false, error: gate.error }

  sessionAborted = false
  pruneClosedGrokProfiles()

  const readyAccounts = getGrokReadyWorkers()
  if (readyAccounts.length === 0) {
    return { success: false, error: 'Không có profile Grok nào đang mở và đã đăng nhập. Vào Grok tài khoản → mở profile và đăng nhập grok.com/imagine.' }
  }

  const flatJobs = buildFlatJobs(config.queue)
  if (flatJobs.length === 0) {
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
  sharedJobQueue = []
  send('session-done', { success: true, summary: { total: totalProcessed, success: successCount, failed: failedCount } })
  return { success: true, summary: { total: totalProcessed, success: successCount, failed: failedCount } }
})

// ─── Worker loop: 1 account xử lý jobs tuần tự ───────────────────────────────

async function runWorkerLoop(
  acct: GrokWorkerAccount,
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
        send('job-failed', {
          projectId: job.projectId,
          jobId: job.jobId,
          error: 'Hết quota — requeue',
          stepLabel: 'Grok Imagine — hết quota tài khoản',
        })
        // Đẩy job lại cuối queue (bằng cách giảm jobIndex không thực tế trong JS đơn luồng
        // nên ghi nhận là failed, cần cơ chế requeue riêng nếu muốn)
        cb.onFailed()
        break
      }

      const { user, tech } = humanizePlaywrightError(err)
      send('job-failed', {
        projectId: job.projectId,
        jobId: job.jobId,
        error: user,
        errorDetail: tech,
        stepLabel: 'Grok Imagine — chạy job tự động',
      })
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
      let imagePathAnimate: string | null = null
      if (job.imageIndex != null && job.imageIndex >= 0) {
        const ordered = listImagePathsFromDir(job.imageDir)
        imagePathAnimate = ordered[job.imageIndex] ?? null
      } else {
        // Mặc định: job index 0 → 1.png, …
        imagePathAnimate = resolveImageForIndex(job.imageDir, job.index + 1)
      }
      if (!imagePathAnimate) {
        throw new Error(
          `Không tìm thấy ảnh cho job #${job.index + 1}` +
            (job.imageIndex != null ? ` (ảnh #${job.imageIndex + 1} trong folder)` : '') +
            ` trong: ${job.imageDir}`
        )
      }
      return { ...base, mode: 'image-to-video', resolution: job.resolution, duration: job.duration, imagePath: imagePathAnimate }
    case 'edit_image':
      if (!job.imageDir) {
        throw new Error('Thiếu thư mục ảnh cho mode edit_image')
      }
      let imagePathsEdit: string[]
      if (job.imageIndex != null && job.imageIndex >= 0) {
        const ordered = listImagePathsFromDir(job.imageDir)
        const one = ordered[job.imageIndex]
        if (!one) {
          throw new Error(`Không tìm thấy ảnh #${job.imageIndex + 1} trong folder: ${job.imageDir}`)
        }
        imagePathsEdit = [one]
      } else {
        imagePathsEdit = resolveImagesForIndex(job.imageDir, job.index + 1)
        if (!imagePathsEdit.length) {
          throw new Error(`Không tìm thấy ảnh cho job #${job.index + 1} trong: ${job.imageDir}`)
        }
      }
      return { ...base, mode: 'images-to-image', imagePaths: imagePathsEdit.slice(0, 3) }
    default:
      return { ...base, mode: 'prompt-to-image' }
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

app.on('before-quit', async () => {
  for (const v of grokProfiles) {
    v.ctx?.close().catch(() => {})
  }
  for (const v of veo3Profiles) {
    v.browser?.close().catch(() => {})
    v.ctx?.close().catch(() => {})
    stopOwnedChromeProcess(v.chromeProcess)
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
const VEO3_CDP_PORT_BASE = Number(process.env.VEO3_CDP_PORT_BASE || '19220')
const VEO3_CDP_BOOT_TIMEOUT_MS = 30000

const VEO3_LOGGED_IN_SELECTORS = [
  '.sc-c8eefe6-0.dqnnrd .sc-c8eefe6-8.cHonUi',
  'img[src*="googleusercontent.com"]',
  'img[alt*="hồ sơ"]',
  'img[alt*="profile" i]',
  // Fallback "ready" signals on Flow project page.
  '#__next [role="textbox"][data-slate-editor="true"]',
  'button:has(i:text-is("add_2"))',
]

/** Do not navigate the tab while the user is on Google sign-in / OAuth — that aborts login and bounces back to pricing. */
function isOAuthOrGoogleSignInUrl(url: string): boolean {
  const u = url.toLowerCase()
  return (
    /accounts\.google\./i.test(u)
    || /\/signin\//i.test(u)
    || /google\.com\/(o\/|ServiceLogin|InteractiveLogin)/i.test(u)
    || /\/oauth/i.test(u)
    || /login\.google/i.test(u)
  )
}

/**
 * Prefer any Flow tab that shows logged-in UI (user may log in on a new tab while the first stays on #pricing).
 */
async function findVeo3LoggedInPage(ctx: BrowserContext): Promise<Page | null> {
  let pages: Page[] = []
  try {
    pages = ctx.pages()
  } catch {
    return null
  }
  for (const page of pages) {
    try {
      if (page.isClosed()) continue
      const url = page.url()
      if (isOAuthOrGoogleSignInUrl(url)) continue
      if (!/labs\.google\/fx\/vi\/tools\/flow/i.test(url)) continue
      if (await isVeo3PageLoggedIn(page)) return page
    } catch {
      continue
    }
  }
  return null
}

function pickOpenFlowPage(entry: Veo3ProfileEntry): Page | undefined {
  if (!entry.ctx) return entry.page
  try {
    const open = entry.ctx.pages().filter((p) => {
      try { return !p.isClosed() } catch { return false }
    })
    if (open.length === 0) return entry.page
    const primary = entry.page
    if (primary) {
      try {
        if (!primary.isClosed() && /labs\.google\/fx\/vi\/tools\/flow/i.test(primary.url())) return primary
      } catch { /* use fallback */ }
    }
    const flowTab = open.find((p) => {
      try { return /labs\.google\/fx\/vi\/tools\/flow/i.test(p.url()) } catch { return false }
    })
    return flowTab ?? open[0]
  } catch {
    return entry.page
  }
}

/**
 * Returns true if any Flow tab is logged in; updates entry.page to that tab for automation.
 */
async function resolveVeo3ProfileReady(entry: Veo3ProfileEntry): Promise<boolean> {
  if (!entry.ctx) return false
  const found = await findVeo3LoggedInPage(entry.ctx)
  if (found) {
    entry.page = found
    return true
  }
  const p = pickOpenFlowPage(entry)
  if (p) entry.page = p
  if (!entry.page) return false
  try {
    if (entry.page.isClosed()) return false
  } catch {
    return false
  }
  return isVeo3ProfileReallyReadySingleTab(entry.page)
}

async function isVeo3ProfileReallyReadySingleTab(page: Page): Promise<boolean> {
  try {
    if (page.isClosed()) return false
    const currentUrl = page.url()
    if (isOAuthOrGoogleSignInUrl(currentUrl)) {
      await page.waitForTimeout(300).catch(() => null)
      return false
    }
    if (!/labs\.google\/fx\/vi\/tools\/flow/i.test(currentUrl)) {
      await page.goto(VEO3_FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null)
      await page.waitForTimeout(400).catch(() => null)
    }
    const ok = await isVeo3PageLoggedIn(page)
    if (ok) return true
    await page.waitForTimeout(700).catch(() => null)
    return await isVeo3PageLoggedIn(page)
  } catch {
    return false
  }
}

interface Veo3ProfileEntry {
  profileId: string
  profileDir: string
  browser?: Browser
  ctx?: BrowserContext
  page?: Page
  chromeProcess?: ChildProcess
  debugPort?: number
  loggedIn?: boolean
  blockedByServer?: boolean
  loginPollTimer?: ReturnType<typeof setInterval>
}

let veo3Profiles: Veo3ProfileEntry[] = []
const veo3LoginStability = new Map<string, { stableLoggedIn: boolean; okStreak: number; failStreak: number; lastEmail?: string }>()
const VEO3_LOGIN_OK_STREAK_REQUIRED = 2
const VEO3_LOGIN_FAIL_STREAK_REQUIRED = 3

function updateStableVeo3ProfileStatus(
  profileId: string,
  observedLoggedIn: boolean,
  email?: string
): { stableLoggedIn: boolean; changed: boolean; emit: { profileId: string; loggedIn: boolean; email?: string } } {
  const prev = veo3LoginStability.get(profileId) ?? { stableLoggedIn: false, okStreak: 0, failStreak: 0, lastEmail: undefined }
  const next = { ...prev }
  if (observedLoggedIn) {
    next.okStreak += 1
    next.failStreak = 0
  } else {
    next.failStreak += 1
    next.okStreak = 0
  }

  let changed = false
  if (next.stableLoggedIn) {
    if (!observedLoggedIn && next.failStreak >= VEO3_LOGIN_FAIL_STREAK_REQUIRED) {
      next.stableLoggedIn = false
      changed = true
    }
  } else if (observedLoggedIn && next.okStreak >= VEO3_LOGIN_OK_STREAK_REQUIRED) {
    next.stableLoggedIn = true
    changed = true
  }

  const emailChanged = !!(next.stableLoggedIn && email && email !== next.lastEmail)
  if (emailChanged) next.lastEmail = email
  if (!next.stableLoggedIn) next.lastEmail = undefined
  veo3LoginStability.set(profileId, next)

  return {
    stableLoggedIn: next.stableLoggedIn,
    changed: changed || emailChanged,
    emit: { profileId, loggedIn: next.stableLoggedIn, ...(next.stableLoggedIn && next.lastEmail ? { email: next.lastEmail } : {}) },
  }
}

function parseProfileOrdinal(profileId: string): number {
  const m = profileId.match(/^profile-(\d{3})$/)
  if (!m) return 1
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : 1
}

function resolveChromeExecutablePath(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH
  }
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium']
  const hit = candidates.find(p => fs.existsSync(p))
  if (!hit) throw new Error('Không tìm thấy Chrome thường. Cài Google Chrome hoặc set CHROME_PATH.')
  return hit
}

async function waitForChromeCdpReady(port: number, timeoutMs: number = VEO3_CDP_BOOT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const endpoint = `http://127.0.0.1:${port}/json/version`
  while (Date.now() < deadline) {
    try {
      const res = await fetch(endpoint)
      if (res.ok) {
        const j = await res.json() as { webSocketDebuggerUrl?: string }
        if (typeof j.webSocketDebuggerUrl === 'string' && j.webSocketDebuggerUrl.length > 0) return
      }
    } catch {
      // keep polling until timeout
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Chrome CDP không sẵn sàng trên port ${port}`)
}

function stopOwnedChromeProcess(proc: ChildProcess | undefined): void {
  if (!proc || proc.killed) return
  try {
    proc.kill()
  } catch {
    // ignore
  }
}

async function openVeo3ProfileViaChromeCdp(profileId: string, profileDir: string): Promise<{
  browser: Browser
  ctx: BrowserContext
  page: Page
  chromeProcess: ChildProcess
  debugPort: number
}> {
  const chromePath = resolveChromeExecutablePath()
  const debugPort = VEO3_CDP_PORT_BASE + parseProfileOrdinal(profileId)
  const chromeArgs = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-features=Translate,OptimizationHints',
    '--new-window',
    VEO3_FLOW_LANDING_URL,
  ]
  const chromeProcess = spawn(chromePath, chromeArgs, {
    windowsHide: false,
    stdio: 'ignore',
  })
  try {
    await waitForChromeCdpReady(debugPort)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
    const ctx = browser.contexts()[0]
    if (!ctx) throw new Error('CDP connected nhưng không lấy được browser context')
    const page = ctx.pages()[0] ?? await ctx.newPage()
    if (!/labs\.google\/fx\/vi\/tools\/flow/i.test(page.url())) {
      await page.goto(VEO3_FLOW_LANDING_URL, { waitUntil: 'domcontentloaded' })
    }
    return { browser, ctx, page, chromeProcess, debugPort }
  } catch (err) {
    stopOwnedChromeProcess(chromeProcess)
    throw err
  }
}

/** Remove a Veo3 profile from the in-memory list and notify renderer (e.g. after user closed the browser). */
function removeVeo3Entry(profileId: string): void {
  const idx = veo3Profiles.findIndex(v => v.profileId === profileId)
  if (idx >= 0) {
    const entry = veo3Profiles[idx]
    const profileDir = entry.profileDir
    if (entry.loginPollTimer) {
      clearInterval(entry.loginPollTimer)
      entry.loginPollTimer = undefined
    }
    stopOwnedChromeProcess(entry.chromeProcess)
    veo3Profiles.splice(idx, 1)
    veo3LoginStability.delete(profileId)
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

function readVeo3Status(profileDir: string): { loggedIn: boolean; email?: string; lastWarmedAt?: number; warmed?: boolean } | null {
  const fp = path.join(profileDir, VEO3_STATUS_FILE)
  if (!fs.existsSync(fp)) return null
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    return { loggedIn: !!j.loggedIn, email: j.email, lastWarmedAt: j.lastWarmedAt, warmed: j.warmed }
  } catch {
    return null
  }
}

function writeVeo3Status(profileDir: string, loggedIn: boolean, email?: string, warmingFields?: { lastWarmedAt?: number; warmed?: boolean }): void {
  const fp = path.join(profileDir, VEO3_STATUS_FILE)
  fs.mkdirSync(profileDir, { recursive: true })
  const existing = readVeo3Status(profileDir) ?? {}
  const merged = {
    ...existing,
    loggedIn,
    ...(email != null && { email }),
    ...(warmingFields?.lastWarmedAt != null && { lastWarmedAt: warmingFields.lastWarmedAt }),
    ...(warmingFields?.warmed != null && { warmed: warmingFields.warmed }),
  }
  fs.writeFileSync(fp, JSON.stringify(merged), 'utf-8')
}

const WARMING_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
let veo3WarmingInProgress = new Set<string>()
let veo3HumanBehaviorHandles = new Map<string, HumanBehaviorHandle>()

function isProfileWarmingStale(profileDir: string): boolean {
  const status = readVeo3Status(profileDir)
  if (!status?.warmed || !status.lastWarmedAt) return true
  return Date.now() - status.lastWarmedAt > WARMING_REFRESH_INTERVAL_MS
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
    const runtime = veo3Profiles.find(v => v.profileId === profileId)
    let runtimeReady = false
    try {
      runtimeReady = !!(runtime?.loggedIn && runtime.page && !runtime.page.isClosed())
    } catch {
      runtimeReady = false
    }
    return {
      profileId,
      profileDir,
      loggedIn: runtimeReady,
      email: status?.email,
      warmed: status?.warmed ?? false,
      lastWarmedAt: status?.lastWarmedAt,
      stale: isProfileWarmingStale(profileDir),
    }
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

async function pollVeo3LoginState(entry: Veo3ProfileEntry): Promise<void> {
  const { profileId, profileDir } = entry
  if (entry.blockedByServer) {
    // Keep blocked profile state stable; avoid poll toggling back to "logged in".
    return
  }
  if (!entry.ctx) {
    writeVeo3Status(profileDir, false)
    const status = updateStableVeo3ProfileStatus(profileId, false)
    entry.loggedIn = status.stableLoggedIn
    if (status.changed) send('veo3-profile-status', status.emit)
    return
  }
  try {
    const observedLoggedIn = await resolveVeo3ProfileReady(entry)
    const email = observedLoggedIn && entry.page ? await tryGetEmailFromFlowPage(entry.page) : undefined
    const status = updateStableVeo3ProfileStatus(profileId, observedLoggedIn, email)
    entry.loggedIn = status.stableLoggedIn
    if (status.stableLoggedIn) {
      writeVeo3Status(profileDir, true, status.emit.email)
    } else {
      writeVeo3Status(profileDir, false)
    }
    if (status.changed) send('veo3-profile-status', status.emit)
  } catch {
    const status = updateStableVeo3ProfileStatus(profileId, false)
    entry.loggedIn = status.stableLoggedIn
    if (!status.stableLoggedIn) writeVeo3Status(profileDir, false)
    if (status.changed) send('veo3-profile-status', status.emit)
  }
}

function markVeo3ProfileBlocked(profileId: string, reasonMessage: string): void {
  const entry = veo3Profiles.find(v => v.profileId === profileId)
  if (!entry) return
  entry.blockedByServer = true
  entry.loggedIn = false
  veo3LoginStability.set(profileId, { stableLoggedIn: false, okStreak: 0, failStreak: VEO3_LOGIN_FAIL_STREAK_REQUIRED, lastEmail: undefined })
  writeVeo3Status(entry.profileDir, false)
  send('veo3-profile-status', { profileId, loggedIn: false })
  send('veo3-profile-blocked', {
    profileId,
    reason: 'SERVER_BLOCK_403',
    message: reasonMessage,
  })
}

ipcMain.handle('veo3-open-profiles', async (_event, count: number) => {
  const gate = requireLicenseFeature('veo', 'veo3-open-profiles')
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
      const { browser, ctx, page, chromeProcess, debugPort } = await openVeo3ProfileViaChromeCdp(profileId, profileDir)
      const entry: Veo3ProfileEntry = { profileId, profileDir, browser, ctx, page, chromeProcess, debugPort, loggedIn: false, blockedByServer: false }
      veo3Profiles.push(entry)
      ctx.on('close', () => removeVeo3Entry(profileId))
      browser.on('disconnected', () => removeVeo3Entry(profileId))
      writeVeo3Status(profileDir, false)
      send('veo3-profile-status', { profileId, loggedIn: false })
      const poll = () => pollVeo3LoginState(entry)
      setTimeout(poll, VEO3_FIRST_POLL_DELAY_MS)
      entry.loginPollTimer = setInterval(poll, VEO3_POLL_INTERVAL_MS)
    } catch (err: any) {
      appLog('error', `Veo3 open profile ${profileId}: ${err.message}`, 'main')
      send('veo3-profile-status', { profileId, loggedIn: false, error: err.message })
    }
  }
  return { opened: n }
})

ipcMain.handle('veo3-open-selected-profiles', async (_event, profileIds: string[]) => {
  const gate = requireLicenseFeature('veo', 'veo3-open-selected-profiles')
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
      const { browser, ctx, page, chromeProcess, debugPort } = await openVeo3ProfileViaChromeCdp(profileId, profileDir)
      const entry: Veo3ProfileEntry = { profileId, profileDir, browser, ctx, page, chromeProcess, debugPort, loggedIn: false, blockedByServer: false }
      veo3Profiles.push(entry)
      ctx.on('close', () => removeVeo3Entry(profileId))
      browser.on('disconnected', () => removeVeo3Entry(profileId))
      opened += 1
      writeVeo3Status(profileDir, false)
      send('veo3-profile-status', { profileId, loggedIn: false })
      const poll = () => pollVeo3LoginState(entry)
      setTimeout(poll, VEO3_FIRST_POLL_DELAY_MS)
      entry.loginPollTimer = setInterval(poll, VEO3_POLL_INTERVAL_MS)
    } catch (err: any) {
      appLog('error', `Veo3 open profile ${profileId}: ${err.message}`, 'main')
      send('veo3-profile-status', { profileId, loggedIn: false, error: err.message })
    }
  }
  return { opened }
})

ipcMain.handle('veo3-close-all', async () => {
  for (const v of veo3Profiles) {
    if (v.loginPollTimer) {
      clearInterval(v.loginPollTimer)
      v.loginPollTimer = undefined
    }
    v.browser?.close().catch(() => {})
    v.ctx?.close().catch(() => {})
    stopOwnedChromeProcess(v.chromeProcess)
  }
  veo3Profiles = []
  veo3LoginStability.clear()
})

ipcMain.handle('veo3-delete-profile', async (_event, profileId: string) => {
  const gate = requireLicenseFeature('veo', 'veo3-delete-profile')
  if (!gate.ok) return { success: false, error: gate.error }
  if (!/^profile-\d{3}$/.test(profileId)) return { success: false, error: 'Profile không hợp lệ.' }
  if (veo3QueueRunning) return { success: false, error: 'Queue Veo3 đang chạy. Hãy dừng queue trước khi xóa profile.' }

  const profileDir = getVeo3ProfileDirById(profileId)
  const entry = veo3Profiles.find(v => v.profileId === profileId)
  if (entry) {
    await entry.browser?.close().catch(() => {})
    await entry.ctx?.close().catch(() => {})
    stopOwnedChromeProcess(entry.chromeProcess)
    removeVeo3Entry(profileId)
  }

  try {
    if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true })
    send('veo3-profile-status', { profileId, loggedIn: false })
    appLog('info', `Deleted Veo3 profile: ${profileId}`, 'main')
    return { success: true }
  } catch (err: any) {
    appLog('error', `Delete Veo3 profile ${profileId}: ${err?.message ?? String(err)}`, 'main')
    return { success: false, error: err?.message ?? 'Không xóa được profile.' }
  }
})

// ─── Profile Warming IPC handlers ────────────────────────────────────────────

ipcMain.handle('veo3-warm-profile', async (_event, profileId: string) => {
  if (!/^profile-\d{3}$/.test(profileId)) return { success: false, error: 'Profile không hợp lệ.' }
  if (veo3WarmingInProgress.has(profileId)) return { success: false, error: 'Profile đang được warm.' }

  const entry = veo3Profiles.find(v => v.profileId === profileId && v.ctx)
  if (!entry?.ctx) return { success: false, error: 'Profile chưa mở. Mở profile trước khi warm.' }

  veo3WarmingInProgress.add(profileId)
  send('veo3-warming-status', { profileId, status: 'started', current: 0, total: 0 })

  try {
    const visited = await warmProfile(entry.ctx, (p: WarmingProgress) => {
      send('veo3-warming-status', { profileId, status: 'progress', ...p })
    })

    const profileDir = getVeo3ProfileDirById(profileId)
    writeVeo3Status(profileDir, entry.loggedIn ?? false, undefined, { lastWarmedAt: Date.now(), warmed: true })

    send('veo3-warming-status', { profileId, status: 'done', visited })
    appLog('info', `Veo3 profile ${profileId} warmed — visited ${visited} sites`, 'main')
    return { success: true, visited }
  } catch (err: any) {
    send('veo3-warming-status', { profileId, status: 'error', error: err?.message })
    appLog('error', `Veo3 warm profile ${profileId}: ${err?.message}`, 'main')
    return { success: false, error: err?.message ?? 'Warming thất bại.' }
  } finally {
    veo3WarmingInProgress.delete(profileId)
  }
})

ipcMain.handle('veo3-warm-all-profiles', async () => {
  const results: { profileId: string; success: boolean; visited?: number; error?: string }[] = []
  for (const entry of veo3Profiles) {
    if (!entry.ctx || veo3WarmingInProgress.has(entry.profileId)) continue

    veo3WarmingInProgress.add(entry.profileId)
    send('veo3-warming-status', { profileId: entry.profileId, status: 'started', current: 0, total: 0 })
    try {
      const visited = await warmProfile(entry.ctx, (p: WarmingProgress) => {
        send('veo3-warming-status', { profileId: entry.profileId, status: 'progress', ...p })
      })
      writeVeo3Status(entry.profileDir, entry.loggedIn ?? false, undefined, { lastWarmedAt: Date.now(), warmed: true })
      send('veo3-warming-status', { profileId: entry.profileId, status: 'done', visited })
      results.push({ profileId: entry.profileId, success: true, visited })
    } catch (err: any) {
      send('veo3-warming-status', { profileId: entry.profileId, status: 'error', error: err?.message })
      results.push({ profileId: entry.profileId, success: false, error: err?.message })
    } finally {
      veo3WarmingInProgress.delete(entry.profileId)
    }
  }
  return { results }
})

ipcMain.handle('veo3-get-warming-status', async (_event, profileId: string) => {
  const profileDir = getVeo3ProfileDirById(profileId)
  const status = readVeo3Status(profileDir)
  return {
    warmed: status?.warmed ?? false,
    lastWarmedAt: status?.lastWarmedAt,
    stale: isProfileWarmingStale(profileDir),
    isWarming: veo3WarmingInProgress.has(profileId),
  }
})

ipcMain.handle('veo3-refresh-stale-profiles', async () => {
  let refreshed = 0
  for (const entry of veo3Profiles) {
    if (!entry.ctx) continue
    if (!isProfileWarmingStale(entry.profileDir)) continue
    if (veo3WarmingInProgress.has(entry.profileId)) continue

    veo3WarmingInProgress.add(entry.profileId)
    try {
      const count = await refreshProfileCookies(entry.ctx)
      writeVeo3Status(entry.profileDir, entry.loggedIn ?? false, undefined, { lastWarmedAt: Date.now(), warmed: true })
      appLog('info', `Veo3 profile ${entry.profileId} cookies refreshed — ${count} sites`, 'main')
      refreshed++
    } catch (err: any) {
      appLog('warn', `Veo3 refresh cookies ${entry.profileId}: ${err?.message}`, 'main')
    } finally {
      veo3WarmingInProgress.delete(entry.profileId)
    }
  }
  return { refreshed }
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
  const gate = requireLicenseFeature('veo', 'veo3-run-job')
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
  const { end: endFlowLog, runDir } = beginVeo3FlowLogSession({ projectId, jobId })
  try {
    if (projectId && jobId && !debugUploadOnly) {
      send('job-progress', { projectId, jobId, progress: 5 })
    }
    await entry.page.goto(VEO3_FLOW_URL, { waitUntil: 'domcontentloaded' })
    if (projectId && jobId && !debugUploadOnly) {
      send('job-progress', { projectId, jobId, progress: 10 })
    }
    const result = await runVeo3CreateVideoFlow(entry.page, prompt, imagePaths, {
      logTag: `${entry.profileId}|${(projectId ?? jobId ?? 'single').slice(0, 8)}`,
      aiModel,
      videoMode,
      landscape,
      multiplier,
      debugUploadOnly,
    })
    if (result && 'uploadLog' in result && result.uploadLog) {
      const base = runDir ?? getLogDirectory()
      if (base) {
        const fp = path.join(base, 'veo3-upload-log.json')
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
    const { user, tech } = humanizePlaywrightError(err)
    const isClosed = /target page, context or browser has been closed|page.*closed|context.*closed/i.test(msg)
    if (isClosed) {
      removeVeo3Entry(profileIdUsed)
      return { success: false, error: 'Trình duyệt profile đã đóng. Vui lòng mở lại profile và thử lại.' }
    }
    const logDirErr = getLogDirectory()
    const screenshotPath = await captureVeo3FlowPageScreenshot(entry.page, runDir ?? logDirErr, jobId ?? 'veo3-run-job')
    if (screenshotPath) appLog('info', `Veo3 error screenshot: ${screenshotPath}`, 'veo3')
    if (projectId && jobId) {
      send('job-failed', {
        projectId,
        jobId,
        error: user,
        errorDetail: tech,
        stepLabel: describeFlowStepFromError(err),
        screenshotPath: screenshotPath ?? undefined,
      })
    }
    appLog('error', `Veo3 run job: ${msg}`, 'main')
    return { success: false, error: user, errorDetail: tech }
  } finally {
    endFlowLog()
    entry.page.off('request', onReq)
    entry.page.off('response', onRes)
    const baseNet = runDir ?? getLogDirectory()
    if (baseNet && networkLog.length > 0) {
      const fp = path.join(baseNet, 'veo3-network.json')
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

ipcMain.handle('veo3-run-queue', async (_event, queue: Array<{
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
  downloadResolution?: '720p' | '1080p' | '4k'
  imageDownloadResolution?: '1k' | '2k' | '4k'
  generationMode?: 'video' | 'image'
  imageModel?: string
}>, queueOptions?: { enableHumanBehavior?: boolean }) => {
  const enableHumanBehavior = queueOptions?.enableHumanBehavior ?? true
  if (veo3QueueRunning) {
    return { success: false, error: 'Veo3 queue đang chạy. Dừng phiên hiện tại trước khi chạy lại.' }
  }
  const gate = requireLicenseFeature('veo', 'veo3-run-queue')
  if (!gate.ok) return { success: false, error: gate.error }

  veo3QueueAbortRequested = false
  veo3QueueRunning = true
  try {
  pruneClosedVeo3Profiles()
  const profiles: Array<{ page: Page; profileId: string }> = []
  for (const v of veo3Profiles) {
    if (veo3QueueAbortRequested) break
    if (!v.ctx) continue
    if (v.blockedByServer) {
      send('veo3-profile-status', { profileId: v.profileId, loggedIn: false })
      continue
    }
    let ready = await resolveVeo3ProfileReady(v)
    if (!ready && v.page && !isOAuthOrGoogleSignInUrl(v.page.url())) {
      // Second chance before excluding this profile from run distribution.
      await v.page.goto(VEO3_FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null)
      await v.page.waitForTimeout(600).catch(() => null)
      ready = await resolveVeo3ProfileReady(v)
    }
    v.loggedIn = ready
    if (ready) {
      const readyPage = v.page
      if (!readyPage) {
        send('veo3-profile-status', { profileId: v.profileId, loggedIn: false })
        continue
      }
      const email = await tryGetEmailFromFlowPage(readyPage).catch(() => undefined)
      send('veo3-profile-status', { profileId: v.profileId, loggedIn: true, ...(email ? { email } : {}) })
      profiles.push({ page: readyPage, profileId: v.profileId })
    } else {
      send('veo3-profile-status', { profileId: v.profileId, loggedIn: false })
    }
  }
  if (profiles.length === 0) {
    veo3QueueRunning = false
    return { success: false, error: 'Không có profile Veo3 nào đang mở và đã đăng nhập.' }
  }
  const projectsWithPending = queue
    .map(q => ({
      ...q,
      pendingJobs: q.jobs.filter((j: { status: string }) => j.status === 'pending').sort((a: { index: number }, b: { index: number }) => a.index - b.index),
    }))
    .filter(q => q.pendingJobs.length > 0)
  if (projectsWithPending.length === 0) {
    veo3QueueRunning = false
    return { success: false, error: 'Queue trống hoặc không có job đang chờ.' }
  }
  const projectQueue: typeof projectsWithPending = [...projectsWithPending]

  async function runProjectOnEntry(
    entry: { page: any; profileId: string },
    project: typeof projectsWithPending[0]
  ): Promise<{ success: boolean; profileBlocked?: boolean; stopped?: boolean }> {
    if (veo3QueueAbortRequested) return { success: false, stopped: true }
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
    const { end: endFlowLog, runDir } = beginVeo3FlowLogSession({
      projectId: project.id,
      jobId: project.pendingJobs[0]?.id,
    })
    try {
      await entry.page.goto(VEO3_FLOW_URL, { waitUntil: 'domcontentloaded' })
      for (const job of project.pendingJobs) {
        send('job-progress', { projectId: project.id, jobId: job.id, progress: 10 })
      }
      const expectedCount = project.pendingJobs.length * Math.max(1, project.multiplier ?? 2)
      const outputDirForProject = path.join(project.outputDir, project.name.replace(/\s+/g, '_').toLowerCase())
      const savedPaths = await runVeo3ProjectFlowByGroups(entry.page, groups, {
        logTag: `${entry.profileId}|${project.id.slice(0, 8)}`,
        shouldStop: () => veo3QueueAbortRequested,
        aiModel: project.aiModel,
        videoMode: project.videoMode,
        landscape: project.landscape,
        multiplier: project.multiplier,
        downloadResolution: project.downloadResolution,
        generationMode: project.generationMode,
        imageModel: project.imageModel,
      }, {
        outputDir: outputDirForProject,
        expectedCount,
        downloadResolution: project.downloadResolution,
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
      if (/VEO3_QUEUE_STOPPED_BY_USER/i.test(msg)) {
        appLog('warn', `Veo3 queue project stopped by user: ${project.name} (${entry.profileId})`, 'main')
        return { success: false, stopped: true }
      }
      const { user, tech } = humanizePlaywrightError(err)
      const profileBlocked = /VEO3_PROFILE_BLOCKED_403|forbidden|recaptcha|bot detect|policy/i.test(msg)
      if (/target page, context or browser has been closed|page.*closed|context.*closed/i.test(msg)) removeVeo3Entry(entry.profileId)
      if (profileBlocked) {
        appLog('warn', `Veo3 profile ${entry.profileId} appears blocked (403/recaptcha). Stop using this profile for current queue run.`, 'veo3')
        markVeo3ProfileBlocked(
          entry.profileId,
          `${FLOW_VEO3_SERVER_BLOCK_HINT_VI} (Profile ${entry.profileId}: tool không gán thêm job tạo mới; có thể vẫn tải nốt video đã hoàn thành.)`
        )
      }
      const stepLabel = describeFlowStepFromError(err)
      const logDirErr = getLogDirectory()
      const screenshotPath = await captureVeo3FlowPageScreenshot(entry.page, runDir ?? logDirErr, project.id)
      if (screenshotPath) appLog('info', `Veo3 error screenshot: ${screenshotPath}`, 'veo3')
      for (const job of project.pendingJobs) {
        send('job-failed', {
          projectId: project.id,
          jobId: job.id,
          error: user,
          errorDetail: tech,
          stepLabel,
          screenshotPath: screenshotPath ?? undefined,
        })
      }
      appLog('error', `Veo3 queue project: ${msg}`, 'main')
      return { success: false, profileBlocked }
    } finally {
      endFlowLog()
      entry.page.off('request', onReq)
      entry.page.off('response', onRes)
      const baseNet = runDir ?? getLogDirectory()
      if (baseNet && networkLog.length > 0) {
        try {
          fs.writeFileSync(path.join(baseNet, 'veo3-network.json'), JSON.stringify(networkLog, null, 2), 'utf-8')
          appLog('info', `Veo3 network log: ${networkLog.length} entries → ${path.join(baseNet, 'veo3-network.json')}`, 'main')
        } catch (_) {}
      }
    }
  }

  // Auto-refresh stale profile cookies before queue starts (only when human behavior enabled)
  const behaviorHandles: HumanBehaviorHandle[] = []
  if (enableHumanBehavior) {
    for (const ent of profiles) {
      const v = veo3Profiles.find(p => p.profileId === ent.profileId)
      if (v?.ctx && isProfileWarmingStale(v.profileDir)) {
        try {
          appLog('info', `Veo3 auto-refreshing stale cookies for ${ent.profileId} before queue`, 'main')
          await refreshProfileCookies(v.ctx)
          writeVeo3Status(v.profileDir, v.loggedIn ?? false, undefined, { lastWarmedAt: Date.now(), warmed: true })
        } catch (err: any) {
          appLog('warn', `Veo3 auto-refresh cookies ${ent.profileId}: ${err?.message}`, 'main')
        }
      }
    }

    for (const ent of profiles) {
      const v = veo3Profiles.find(p => p.profileId === ent.profileId)
      if (v?.ctx && ent.page) {
        const flowPage = ent.page
        const handle = startHumanBehaviorLoop(v.ctx, flowPage, () => isFlowPageBusy(flowPage))
        behaviorHandles.push(handle)
        veo3HumanBehaviorHandles.set(ent.profileId, handle)
      }
    }
    appLog('info', `Veo3 human behavior enabled: auto-refresh cookies + random tab simulation`, 'main')
  }

  appLog('info', `Veo3 queue: ${projectQueue.length} project(s), ${profiles.length} profile(s) — human behavior: ${enableHumanBehavior ? 'ON' : 'OFF'}`, 'main')
  let stoppedByUser = false
  await Promise.all(
    profiles.map(async (ent) => {
      if (!ent.page) return
      const entry = { page: ent.page, profileId: ent.profileId }
      while (projectQueue.length > 0) {
        if (veo3QueueAbortRequested) {
          stoppedByUser = true
          break
        }
        const project = projectQueue.shift()!
        const result = await runProjectOnEntry(entry, project)
        if (result.stopped) {
          stoppedByUser = true
          break
        }
        if (result.profileBlocked) break
      }
    })
  )

  // Stop all human behavior loops when queue ends
  for (const handle of behaviorHandles) handle.stop()
  for (const ent of profiles) veo3HumanBehaviorHandles.delete(ent.profileId)

  const totalJobs = projectsWithPending.reduce((s, p) => s + p.pendingJobs.length, 0)
  if (stoppedByUser || veo3QueueAbortRequested) {
    send('session-done', { success: false, summary: { total: totalJobs, success: 0, failed: 0 } })
    veo3QueueAbortRequested = false
    veo3QueueRunning = false
    return { success: true, stopped: true }
  }
  send('session-done', { success: true, summary: { total: totalJobs, success: 0, failed: 0 } })
  veo3QueueRunning = false
  return { success: true }
  } finally {
    // Ensure all behavior loops stop even on exception
    for (const [, handle] of veo3HumanBehaviorHandles) handle.stop()
    veo3HumanBehaviorHandles.clear()
    veo3QueueRunning = false
  }
})
