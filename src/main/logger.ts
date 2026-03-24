/**
 * File-based app logger for debugging and support.
 * Writes to {userData}/logs/app-YYYY-MM-DD.log and echoes to console.
 */

import * as fs from 'fs'
import * as path from 'path'
import { logAsciiVi } from '../automation/logAsciiVi'

const LEVELS = ['info', 'warn', 'error'] as const
export type LogLevel = typeof LEVELS[number]

let logDir: string | null = null

function getLogFilePath(): string {
  if (!logDir) return ''
  const today = new Date().toISOString().slice(0, 10)
  return path.join(logDir, `app-${today}.log`)
}

function ensureLogDir(): void {
  if (!logDir) return
  try {
    fs.mkdirSync(logDir, { recursive: true })
  } catch (_) {}
}

function formatLine(level: string, message: string, source?: string): string {
  const ts = new Date().toISOString()
  const src = source ? ` [${source}]` : ''
  return `${ts} ${level.toUpperCase().padEnd(5)}${src} ${message}\n`
}

export function initAppLogger(userDataPath: string, appName?: string): void {
  logDir = path.join(userDataPath, 'logs')
  ensureLogDir()
  const fp = getLogFilePath()
  if (fp) {
    try {
      fs.appendFileSync(fp, formatLine('info', `App started (${appName ?? 'Loha Studio'})`, 'main'))
    } catch (_) {}
  }
}

export function getLogDirectory(): string {
  return logDir ?? ''
}

export function appLog(level: LogLevel, message: string, source?: string): void {
  const line = formatLine(level, logAsciiVi(message), source)
  const fp = getLogFilePath()
  if (fp) {
    try {
      ensureLogDir()
      fs.appendFileSync(fp, line)
    } catch (e) {
      console.error('[logger] write failed', e)
    }
  }
  const prefix = `[${new Date().toLocaleTimeString()}][${(source ?? 'main').slice(0, 12)}][${level.toUpperCase().slice(0, 3)}]`
  if (level === 'error') console.error(prefix, message)
  else if (level === 'warn') console.warn(prefix, message)
  else console.log(prefix, message)
}
