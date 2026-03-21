import type { QueueProject, QueueJob } from '../types'
import { Modal, ModalRow, ModalLabel, Btn, Tag } from './ui'

export function JobDetailModal({ qp, job, onClose }: {
  qp: QueueProject; job: QueueJob; onClose: () => void
}) {
  const hasImage = qp.mode !== "prompt_only"
  const imageHint = hasImage && qp.imageDir
    ? qp.mode === "animate_image"
      ? `Ảnh cho job #${job.index + 1}: ${qp.imageDir}\\${job.index + 1}.png (hoặc .jpg)`
      : `Ảnh cho job #${job.index + 1}: thư mục trên, có thể dùng 1.png, 2.png... (tương ứng prompt)`
    : null

  return (
    <Modal title={`Cấu hình job #${job.index + 1} — ${qp.name}`} onClose={onClose} width={520}>
      <ModalRow>
        <ModalLabel>Dự án</ModalLabel>
        <div style={{ fontSize: 12, color: "var(--text)" }}>{qp.name}</div>
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Tag>{qp.mediaType}</Tag>
          {qp.mode === "prompt_only" ? (
            <Tag>Chỉ prompt</Tag>
          ) : (
            <Tag>{qp.mode === "animate_image" ? "Ảnh → video" : "Chỉnh ảnh"}</Tag>
          )}
          <Tag>{qp.ratio}</Tag>
          {qp.mediaType === "Video" && <Tag>{qp.resolution} · {qp.duration}</Tag>}
        </div>
      </ModalRow>
      <ModalRow>
        <ModalLabel>Thư mục tải về</ModalLabel>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text2)", wordBreak: "break-all" }}>
          {qp.outputDir}
        </div>
      </ModalRow>
      {hasImage && qp.imageDir && (
        <ModalRow>
          <ModalLabel>Thư mục ảnh</ModalLabel>
          <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text2)", wordBreak: "break-all" }}>
            {qp.imageDir}
          </div>
          {imageHint && (
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--accent)" }}>{imageHint}</div>
          )}
        </ModalRow>
      )}
      <ModalRow>
        <ModalLabel>Prompt (job #{job.index + 1})</ModalLabel>
        <div style={{
          padding: "10px 12px", background: "var(--bg)", borderRadius: "var(--radius)",
          border: "1px solid var(--border)", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto",
        }}>
          {job.prompt || "(trống)"}
        </div>
      </ModalRow>
      <ModalRow>
        <ModalLabel>Trạng thái</ModalLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: job.status === "done" ? "var(--accent2)" : job.status === "failed" ? "var(--danger)" : job.status === "running" ? "var(--accent)" : "var(--text2)",
          }}>
            {job.status === "done" ? "Hoàn thành" : job.status === "failed" ? "Thất bại" : job.status === "running" ? "Đang chạy" : "Chờ xử lý"}
          </span>
          {job.status === "failed" && job.error && (
            <span style={{ fontSize: 11, color: "var(--danger)" }}>{job.error}</span>
          )}
        </div>
      </ModalRow>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Btn onClick={onClose}>Đóng</Btn>
      </div>
    </Modal>
  )
}
