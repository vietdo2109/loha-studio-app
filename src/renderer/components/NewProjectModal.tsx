import { useState, useEffect } from 'react'
import type { Project, Ratio, Mode, MediaType, Resolution, Duration } from '../types'
import { Modal, ModalRow, ModalLabel, Btn, Input, Select, Seg } from './ui'
import { Icon } from './icons'

const RATIOS: Ratio[] = ["2:3", "3:2", "1:1", "9:16", "16:9"]

function RatioPicker({ value, onChange }: { value: Ratio; onChange: (v: Ratio) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {RATIOS.map(r => {
        const [w, h] = r.split(":").map(Number)
        const scale  = Math.min(22 / w, 22 / h)
        const active = value === r
        return (
          <button key={r} onClick={() => onChange(r)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            padding: "8px 10px", borderRadius: "var(--radius)",
            border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
            background: active ? "var(--accent-bg)" : "var(--bg)",
            color: active ? "var(--accent)" : "var(--text2)",
            transition: "all .12s",
          }}>
            <div style={{
              width: w * scale, height: h * scale,
              background: active ? "var(--accent)" : "var(--border2)",
              borderRadius: 2, transition: "background .12s",
            }}/>
            <span style={{ fontSize: 11, fontWeight: 500 }}>{r}</span>
          </button>
        )
      })}
    </div>
  )
}

export function NewProjectModal({ onClose, onSave, initial }: {
  onClose: () => void
  onSave: (p: Project | Omit<Project, "id" | "createdAt">) => void
  initial?: Project | null
}) {
  const isEdit = !!initial
  const [name,       setName]       = useState(initial?.name ?? "")
  const [outputDir,  setOutputDir]  = useState(initial?.outputDir ?? "")
  const [mode,       setMode]       = useState<Mode>(initial?.mode ?? "prompt_only")
  const [mediaType,  setMediaType]  = useState<MediaType>(initial?.mediaType ?? "Video")
  const [ratio,      setRatio]      = useState<Ratio>(initial?.ratio ?? "16:9")
  const [resolution, setResolution] = useState<Resolution>(initial?.resolution ?? "480p")
  const [duration,   setDuration]   = useState<Duration>(initial?.duration ?? "6s")
  const [promptText, setPromptText] = useState(initial ? initial.prompts.join("\n\n") : "")
  const [imageDir,   setImageDir]   = useState(initial?.imageDir ?? "")

  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setOutputDir(initial.outputDir)
      setMode(initial.mode)
      setMediaType(initial.mediaType)
      setRatio(initial.ratio)
      setResolution(initial.resolution)
      setDuration(initial.duration)
      setPromptText(initial.prompts.join("\n\n"))
      setImageDir(initial.imageDir)
    }
  }, [initial?.id])

  const hasImage = mode !== "prompt_only"

  const handlePickDir = async () => {
    const dir = await (window as any).electronAPI?.selectDirectory()
    if (dir) setOutputDir(dir)
  }

  const handlePickTxt = async () => {
    const content = await (window as any).electronAPI?.selectTextFile?.()
    if (content) setPromptText(content)
  }

  const handlePickImages = async () => {
    const dir = await (window as any).electronAPI?.selectDirectory?.()
    if (dir) setImageDir(dir)
  }

  const prompts = promptText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)

  const valid = name.trim() && outputDir && prompts.length > 0 && (!hasImage || imageDir)

  const handleSave = () => {
    if (!valid) return
    if (isEdit && initial) {
      onSave({
        ...initial,
        name: name.trim(),
        outputDir,
        mode,
        mediaType,
        ratio,
        resolution,
        duration,
        prompts,
        imageDir,
      })
    } else {
      onSave({
        name: name.trim(),
        outputDir,
        mode,
        mediaType,
        ratio,
        resolution,
        duration,
        prompts,
        imageDir,
      })
    }
  }

  return (
    <Modal title={isEdit ? "Chỉnh sửa dự án" : "Dự án mới"} onClose={onClose} width={540}>
      <ModalRow>
        <ModalLabel>Tên dự án</ModalLabel>
        <Input value={name} onChange={(v) => setName(v)} placeholder="VD: Video quần bò"/>
      </ModalRow>

      <ModalRow>
        <ModalLabel>Thư mục tải về</ModalLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={outputDir} onChange={setOutputDir} placeholder="Chọn thư mục..." style={{ flex: 1 }}/>
          <Btn onClick={handlePickDir}><Icon.Folder /> Chọn</Btn>
        </div>
        {outputDir && name && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>
            → {outputDir}/{name.replace(/\s+/g, "_").toLowerCase()}/
          </div>
        )}
      </ModalRow>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <ModalLabel>Mode</ModalLabel>
          <Select value={mode} onChange={setMode} options={[
            { value: "prompt_only",   label: "Prompt only"   },
            { value: "edit_image",    label: "Edit image"    },
            { value: "animate_image", label: "Animate image" },
          ]}/>
        </div>
        <div>
          <ModalLabel>Loại output</ModalLabel>
          <Seg value={mediaType} onChange={setMediaType} options={["Image", "Video"]}/>
        </div>
      </div>

      <ModalRow>
        <ModalLabel>Tỉ lệ khung hình</ModalLabel>
        <RatioPicker value={ratio} onChange={setRatio}/>
      </ModalRow>

      {mediaType === "Video" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <ModalLabel>Độ phân giải</ModalLabel>
            <Seg
              value={resolution}
              onChange={setResolution}
              options={["480p", "720p"]}
              disabledOptions={["720p"]}
            />
          </div>
          <div>
            <ModalLabel>Thời lượng</ModalLabel>
            <Seg
              value={duration}
              onChange={setDuration}
              options={["6s", "10s"]}
              disabledOptions={["10s"]}
            />
          </div>
        </div>
      )}

      <ModalRow>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <ModalLabel>Prompts</ModalLabel>
          <Btn size="sm" variant="ghost" onClick={handlePickTxt}><Icon.Upload /> Từ file .txt</Btn>
        </div>
        <Input
          value={promptText} onChange={setPromptText} multiline rows={5}
          placeholder={"Prompt 1...\n\nPrompt 2...\n\nPrompt 3..."}
        />
        {prompts.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)" }}>
            {prompts.length} prompt{prompts.length > 1 ? "s" : ""} (cách nhau bởi dòng trắng)
          </div>
        )}
      </ModalRow>

      {hasImage && (
        <ModalRow>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <ModalLabel>folder ảnh đính kèm (đặt tên ảnh: 1.png, 2.png, 3.png... tương ứng với prompt)</ModalLabel>
            <Btn size="sm" variant="ghost" onClick={handlePickImages}><Icon.Upload /> Chọn folder ảnh</Btn>
          </div>
          {!imageDir ? (
            <div style={{
              padding: "14px", border: "1.5px dashed var(--border2)", borderRadius: "var(--radius)",
              textAlign: "center", color: "var(--text3)", fontSize: 12, background: "var(--bg)",
            }}>
              Chưa chọn thư mục ảnh.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)", lineHeight: 1.7 }}>
              <div>Thư mục ảnh: {imageDir}</div>
            </div>
          )}
        </ModalRow>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Btn onClick={onClose}>Huỷ</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!valid}>
          {isEdit ? "Cập nhật" : <><Icon.Plus /> Tạo dự án</>}
        </Btn>
      </div>
    </Modal>
  )
}
