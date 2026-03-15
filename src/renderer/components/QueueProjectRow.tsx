import type { QueueProject, QueueJob, JobStatus } from '../types'
import { Btn, Tag, ProgressBar } from './ui'
import { Icon } from './icons'

export function QueueProjectRow({ qp, onToggle, onJobClick }: { qp: QueueProject; onToggle: () => void; onJobClick?: (qp: QueueProject, job: QueueJob) => void }) {
  const total   = qp.jobs.length
  const done    = qp.jobs.filter(j => j.status === "done").length
  const running = qp.jobs.filter(j => j.status === "running").length
  const failed  = qp.jobs.filter(j => j.status === "failed").length
  const pct     = total ? Math.round((done / total) * 100) : 0

  const overallStatus: JobStatus =
    done === total ? "done" :
    running > 0   ? "running" :
    failed === total ? "failed" : "pending"

  const statusColor = { done: "var(--accent2)", running: "var(--accent)", pending: "var(--border2)", failed: "var(--danger)" }
  const statusDot   = { done: "#22c55e", running: "#3b82f6", pending: "#d1d5db", failed: "#ef4444" }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", animation: "slideIn .15s ease" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        background: "var(--surface)", cursor: "pointer",
      }} onClick={onToggle}>
        <span style={{ color: "var(--text3)", display: "flex" }}>
          {qp.expanded ? <Icon.ChevronD /> : <Icon.ChevronR />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <Icon.Dot color={statusDot[overallStatus]}/>
            <span style={{ fontWeight: 500, fontSize: 13 }}>{qp.name}</span>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>{done}/{total}</span>
            {failed > 0 && <Tag color="orange">{failed} lỗi</Tag>}
          </div>
          <ProgressBar value={pct} color={statusColor[overallStatus]}/>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor[overallStatus], minWidth: 32, textAlign: "right" }}>
          {pct}%
        </span>
      </div>

      {qp.expanded && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          {qp.jobs.map(job => {
            const jcolor = { done: "var(--accent2)", running: "var(--accent)", pending: "var(--border2)", failed: "var(--danger)" }
            const jdot   = { done: "#22c55e", running: "#3b82f6", pending: "#d1d5db", failed: "#ef4444" }
            return (
              <div
                key={job.id}
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onJobClick?.(qp, job) }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJobClick?.(qp, job) } }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 12px 7px 28px",
                  borderBottom: "1px solid var(--border)",
                  cursor: onJobClick ? "pointer" : "default",
                  background: onJobClick ? "transparent" : "transparent",
                }}
                title={onJobClick ? "Click để xem cấu hình / prompt (để chạy lại nếu lỗi)" : undefined}
              >
                <Icon.Dot color={jdot[job.status]}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    #{job.index + 1} — {job.prompt.slice(0, 60)}{job.prompt.length > 60 ? "…" : ""}
                  </div>
                  {job.status === "pending" ? (
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>Chờ xử lý</span>
                  ) : job.status === "failed" ? (
                    <span style={{ fontSize: 11, color: "var(--danger)" }}>{job.error ?? "Thất bại"}</span>
                  ) : (
                    <ProgressBar value={job.progress} color={jcolor[job.status]}/>
                  )}
                </div>
                {(job.status === "running" || job.status === "done") && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: jcolor[job.status], minWidth: 32, textAlign: "right" }}>
                    {job.status === "done" ? "100%" : `${job.progress}%`}
                  </span>
                )}
                {job.status === "running" && (
                  <span style={{ color: "var(--accent)" }}><Icon.Spin /></span>
                )}
                {onJobClick && (
                  <Btn size="sm" variant="ghost" style={{ padding: "2px 6px" }} title="Xem cấu hình / prompt">
                    <Icon.Info />
                  </Btn>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
