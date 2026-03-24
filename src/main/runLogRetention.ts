/**
 * Mỗi phiên Veo3: logs/runs/<runId>/ — giữ tối đa N thư mục mới nhất.
 */
import * as fs from 'fs'
import * as path from 'path'

export const MAX_VEO3_RUN_RECORDS = 10

function runSortKey(name: string): number {
  const head = name.split(/[-_]/)[0] ?? ''
  const n = Number(head)
  return Number.isFinite(n) ? n : 0
}

/** Xóa các thư mục run cũ trong logs/runs, chỉ giữ maxKeep thư mục mới nhất (theo runId). */
export function pruneVeo3RunDirectories(logDir: string, maxKeep: number = MAX_VEO3_RUN_RECORDS): void {
  const runsRoot = path.join(logDir, 'runs')
  if (!fs.existsSync(runsRoot)) return
  let names: string[]
  try {
    names = fs.readdirSync(runsRoot)
  } catch {
    return
  }
  const dirs = names
    .filter((n) => {
      try {
        return fs.statSync(path.join(runsRoot, n)).isDirectory()
      } catch {
        return false
      }
    })
    .sort((a, b) => runSortKey(b) - runSortKey(a))

  if (dirs.length <= maxKeep) return
  for (let i = maxKeep; i < dirs.length; i++) {
    try {
      fs.rmSync(path.join(runsRoot, dirs[i]), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/** Tạo runId duy nhất + thư mục runs/<runId> (chưa prune — gọi prune sau khi tạo xong file đầu tiên). */
export function createVeo3RunDirectory(logDir: string): { runId: string; runDir: string } {
  const runId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 9)}`
  const runDir = path.join(logDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  return { runId, runDir }
}
