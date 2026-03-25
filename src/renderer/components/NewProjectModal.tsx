import { useState, useEffect } from 'react'
import type { Project, Ratio, MediaType, Resolution, Duration, Script } from '../types'
import { deriveGrokProjectMode } from '../types'
import { Modal, ModalRow, ModalLabel, Btn, Input, Select, Seg, Checkbox } from './ui'
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

export function NewProjectModal({ onClose, onSave, initial, scripts = [] }: {
  onClose: () => void
  onSave: (p: Project | Omit<Project, "id" | "createdAt">) => void
  initial?: Project | null
  /** Kịch bản (dùng chung với Veo3) — 1 script + nhiều ảnh: mỗi ảnh chạy hết prompt */
  scripts?: Script[]
}) {
  const isEdit = !!initial
  const [name,       setName]       = useState(initial?.name ?? "")
  const [outputDir,  setOutputDir]  = useState(initial?.outputDir ?? "")
  const [mediaType,  setMediaType]  = useState<MediaType>(initial?.mediaType ?? "Video")
  const [ratio,      setRatio]      = useState<Ratio>(initial?.ratio ?? "16:9")
  const [resolution, setResolution] = useState<Resolution>(initial?.resolution ?? "480p")
  const [duration,   setDuration]   = useState<Duration>(initial?.duration ?? "6s")
  const [promptText, setPromptText] = useState(initial && !initial.useScripts ? initial.prompts.join("\n\n") : "")
  const [imageDir,   setImageDir]   = useState(initial?.imageDir ?? "")
  const [useScripts, setUseScripts] = useState(!!(initial?.useScripts && initial?.scriptIds?.length))
  const [selectedScriptId, setSelectedScriptId] = useState(initial?.scriptIds?.[0] ?? "")

  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setOutputDir(initial.outputDir)
      setMediaType(initial.mediaType)
      setRatio(initial.ratio)
      setResolution(initial.resolution)
      setDuration(initial.duration)
      setUseScripts(!!(initial.useScripts && initial.scriptIds?.length))
      setSelectedScriptId(initial.scriptIds?.[0] ?? "")
      if (!initial.useScripts) setPromptText(initial.prompts.join("\n\n"))
      setImageDir(initial.imageDir)
    }
  }, [initial?.id])

  const derivedMode = deriveGrokProjectMode(mediaType, imageDir)

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

  const scriptsSorted = [...scripts].sort((a, b) => Number(b.id) - Number(a.id))
  const selectedScript = scriptsSorted.find(s => s.id === selectedScriptId)
  const promptsFromScript = useScripts && selectedScript ? selectedScript.prompts : []
  const promptsFromText = promptText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const prompts = useScripts ? promptsFromScript : promptsFromText

  const scriptOk = !useScripts || (selectedScriptId && promptsFromScript.length > 0)
  const valid =
    name.trim() &&
    outputDir &&
    prompts.length > 0 &&
    scriptOk &&
    (derivedMode === "prompt_only" || !!imageDir.trim())

  const handleSave = () => {
    if (!valid) return
    const mode = deriveGrokProjectMode(mediaType, imageDir)
    const scriptPayload =
      useScripts && selectedScriptId
        ? { useScripts: true as const, scriptIds: [selectedScriptId] }
        : { useScripts: undefined, scriptIds: undefined }

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
        ...scriptPayload,
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
        ...scriptPayload,
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

      <ModalRow>
        <ModalLabel>Loại output</ModalLabel>
        <div style={{ marginBottom: 6 }}>
          <Seg value={mediaType} onChange={setMediaType} options={["Image", "Video"]}/>
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
          <b>Video</b> hoặc <b>Image</b> quyết định loại media tạo ra. Nếu chọn thêm <b>folder ảnh</b> bên dưới:
          Video → animate (ảnh → video), Image → chỉnh sửa/ghép ảnh. Để trống folder → chỉ tạo từ prompt.
        </div>
      </ModalRow>

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
            />
          </div>
          <div>
            <ModalLabel>Thời lượng</ModalLabel>
            <Seg
              value={duration}
              onChange={setDuration}
              options={["6s", "10s"]}
            />
          </div>
        </div>
      )}

      {scripts.length > 0 && (
        <ModalRow>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <Checkbox checked={useScripts} onChange={() => setUseScripts(v => !v)} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Dùng kịch bản</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, lineHeight: 1.45 }}>
                Prompts lấy từ kịch bản đã lưu. Mỗi ảnh trong folder chạy lần lượt <b>tất cả</b> prompt trong kịch bản (thứ tự ảnh = thứ tự file trong thư mục).
              </div>
            </div>
          </label>
          {useScripts && (
            <div style={{ marginTop: 10 }}>
              <ModalLabel>Kịch bản</ModalLabel>
              <Select
                value={selectedScriptId}
                onChange={setSelectedScriptId}
                options={[
                  { value: "", label: "— Chọn kịch bản —" },
                  ...scriptsSorted.map(s => ({ value: s.id, label: `${s.name} (${s.prompts.length} prompt)` })),
                ]}
              />
              {selectedScript && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--text3)" }}>
                  {selectedScript.prompts.length} prompt trong kịch bản
                </div>
              )}
            </div>
          )}
        </ModalRow>
      )}

      <ModalRow>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <ModalLabel>{useScripts ? "Prompts (từ kịch bản)" : "Prompts"}</ModalLabel>
          {!useScripts && <Btn size="sm" variant="ghost" onClick={handlePickTxt}><Icon.Upload /> Từ file .txt</Btn>}
        </div>
        {useScripts ? (
          <div style={{
            padding: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)",
            fontSize: 12, color: "var(--text2)", maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap",
          }}>
            {selectedScript ? selectedScript.prompts.join("\n\n") : "Chọn kịch bản…"}
          </div>
        ) : (
          <Input
            value={promptText} onChange={setPromptText} multiline rows={5}
            placeholder={"Prompt 1...\n\nPrompt 2...\n\nPrompt 3..."}
          />
        )}
        {prompts.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)" }}>
            {prompts.length} prompt{prompts.length > 1 ? "s" : ""}
            {!useScripts && " (cách nhau bởi dòng trắng)"}
          </div>
        )}
      </ModalRow>

      <ModalRow>
        <ModalLabel>Folder ảnh</ModalLabel>
        <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 8 }}>
          {useScripts
            ? "Mỗi ảnh × tất cả prompt trong kịch bản; thứ tự = thứ tự file trong folder."
            : mediaType === "Video"
              ? "Tuỳ chọn: để trống = video chỉ từ prompt; có folder = ảnh → video (1.png, 2.png... theo prompt)."
              : "Tuỳ chọn: để trống = ảnh chỉ từ prompt; có folder = chỉnh sửa ảnh (1.png, 2.png...)."}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={imageDir} onChange={setImageDir} placeholder="Chọn thư mục..." style={{ flex: 1 }}/>
          <Btn onClick={handlePickImages}><Icon.Folder /> Chọn</Btn>
        </div>
        {!imageDir && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)" }}>
            Có thể để trống nếu chỉ dùng prompt.
          </div>
        )}
        {!!imageDir && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)", wordBreak: "break-all" }}>
            → {imageDir}
          </div>
        )}
      </ModalRow>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Btn onClick={onClose}>Huỷ</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!valid}>
          {isEdit ? "Cập nhật" : <><Icon.Plus /> Tạo dự án</>}
        </Btn>
      </div>
    </Modal>
  )
}
