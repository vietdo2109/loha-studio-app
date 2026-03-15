import { useState, useEffect } from 'react'
import type { Veo3Project, Veo3VideoMode, Veo3Multiplier, Veo3AiModel, Script } from '../types'
import { Modal, ModalRow, ModalLabel, Btn, Input, Checkbox } from './ui'
import { Icon } from './icons'

export function Veo3NewProjectModal({ onClose, onSave, initial, scripts = [] }: {
  onClose: () => void
  onSave: (p: Veo3Project | Omit<Veo3Project, "id" | "createdAt">) => void
  initial?: Veo3Project | null
  scripts?: Script[]
}) {
  const MODEL_OPTIONS: Array<{ value: Veo3AiModel; label: string }> = [
    { value: 'veo-3.1-fast', label: 'Veo 3.1 - Fast' },
    { value: 'veo-3.1-fast-lower-priority', label: 'Veo 3.1 - Fast [Lower Priority]' },
    { value: 'veo-3.1-quality', label: 'Veo 3.1 - Quality' },
  ]
  const isEdit = !!initial
  const [name,       setName]       = useState(initial?.name ?? "")
  const [outputDir,  setOutputDir]  = useState(initial?.outputDir ?? "")
  const [aiModel,    setAiModel]    = useState<Veo3AiModel>(initial?.aiModel ?? 'veo-3.1-fast')
  const [videoMode,  setVideoMode]  = useState<Veo3VideoMode>(initial?.videoMode ?? "frames")
  const [landscape,  setLandscape]  = useState(initial?.landscape ?? false)
  const [multiplier, setMultiplier] = useState<Veo3Multiplier>(initial?.multiplier ?? 2)
  const [promptText, setPromptText] = useState(initial && !initial.useScripts ? initial.prompts.join("\n\n") : "")
  const [startFramesDir, setStartFramesDir] = useState(initial?.startFramesDir ?? initial?.imageDir ?? "")
  const [endFramesDir, setEndFramesDir] = useState(initial?.endFramesDir ?? "")
  const [useScripts, setUseScripts] = useState(!!(initial?.useScripts && initial?.scriptIds?.length))
  const [selectedScriptIds, setSelectedScriptIds] = useState<Set<string>>(new Set(initial?.scriptIds ?? []))

  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setOutputDir(initial.outputDir)
      setAiModel(initial.aiModel ?? 'veo-3.1-fast')
      setVideoMode(initial.videoMode)
      setLandscape(initial.landscape)
      setMultiplier(initial.multiplier)
      setStartFramesDir(initial.startFramesDir ?? initial.imageDir ?? "")
      setEndFramesDir(initial.endFramesDir ?? "")
      setUseScripts(!!(initial.useScripts && initial.scriptIds?.length))
      setSelectedScriptIds(new Set(initial.scriptIds?.length ? [initial.scriptIds[0]] : []))
      if (!initial.useScripts) setPromptText(initial.prompts.join("\n\n"))
    }
  }, [initial?.id])

  const handlePickDir = async () => {
    const dir = await (window as any).electronAPI?.selectDirectory()
    if (dir) setOutputDir(dir)
  }

  const handlePickStartFrames = async () => {
    const dir = await (window as any).electronAPI?.selectDirectory?.()
    if (dir) setStartFramesDir(dir)
  }

  const handlePickEndFrames = async () => {
    const dir = await (window as any).electronAPI?.selectDirectory?.()
    if (dir) setEndFramesDir(dir)
  }

  const handlePickTxt = async () => {
    const content = await (window as any).electronAPI?.selectTextFile?.()
    if (content) setPromptText(content)
  }

  const promptsFromText = promptText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const scriptsNewestFirst = [...scripts].sort((a, b) => Number(b.id) - Number(a.id))
  const promptsFromScripts = useScripts && selectedScriptIds.size > 0
    ? scriptsNewestFirst.filter(s => selectedScriptIds.has(s.id)).flatMap(s => s.prompts)
    : []
  const prompts = useScripts ? promptsFromScripts : promptsFromText
  const valid = name.trim() && outputDir && prompts.length > 0 && (!useScripts || selectedScriptIds.size > 0)

  const handleSave = () => {
    if (!valid) return
    const payload = {
      name: name.trim(),
      outputDir,
      aiModel,
      videoMode,
      landscape,
      multiplier,
      prompts,
      startFramesDir: startFramesDir || undefined,
      endFramesDir: endFramesDir || undefined,
      ...(startFramesDir && { imageDir: startFramesDir }),
      ...(useScripts && selectedScriptIds.size > 0 && {
        useScripts: true,
        scriptIds: [Array.from(selectedScriptIds)[0]],
      }),
    }
    if (isEdit && initial) {
      onSave({ ...initial, ...payload })
    } else {
      onSave(payload)
    }
  }

  return (
    <Modal title={isEdit ? "Chỉnh sửa dự án Veo3" : "Dự án Veo3 (Google Flow) mới"} onClose={onClose} width={520}>
      <ModalRow>
        <ModalLabel>Tên dự án</ModalLabel>
        <Input value={name} onChange={setName} placeholder="VD: Video quảng cáo"/>
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
        <ModalLabel>Chế độ video (Flow)</ModalLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setVideoMode("ingredients")}
            style={{
              padding: "8px 14px", borderRadius: "var(--radius)", fontSize: 12, fontWeight: 500,
              border: `1.5px solid ${videoMode === "ingredients" ? "var(--accent)" : "var(--border)"}`,
              background: videoMode === "ingredients" ? "var(--accent-bg)" : "var(--bg)",
              color: videoMode === "ingredients" ? "var(--accent)" : "var(--text2)",
            }}
          >
            Ingredients (tối đa 3 ảnh/prompt)
          </button>
          <button
            type="button"
            onClick={() => setVideoMode("frames")}
            style={{
              padding: "8px 14px", borderRadius: "var(--radius)", fontSize: 12, fontWeight: 500,
              border: `1.5px solid ${videoMode === "frames" ? "var(--accent)" : "var(--border)"}`,
              background: videoMode === "frames" ? "var(--accent-bg)" : "var(--bg)",
              color: videoMode === "frames" ? "var(--accent)" : "var(--text2)",
            }}
          >
            Frames (ảnh đầu / ảnh cuối)
          </button>
        </div>
      </ModalRow>

      <ModalRow>
        <ModalLabel>AI Model</ModalLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {MODEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAiModel(opt.value)}
              style={{
                padding: "8px 14px", borderRadius: "var(--radius)", fontSize: 12, fontWeight: 500,
                border: `1.5px solid ${aiModel === opt.value ? "var(--accent)" : "var(--border)"}`,
                background: aiModel === opt.value ? "var(--accent-bg)" : "var(--bg)",
                color: aiModel === opt.value ? "var(--accent)" : "var(--text2)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </ModalRow>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <ModalLabel>Hướng khung hình</ModalLabel>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setLandscape(true)}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: "var(--radius)", fontSize: 12,
                border: `1.5px solid ${landscape ? "var(--accent)" : "var(--border)"}`,
                background: landscape ? "var(--accent-bg)" : "var(--bg)",
                color: landscape ? "var(--accent)" : "var(--text2)",
              }}
            >
              Ngang (16:9)
            </button>
            <button
              type="button"
              onClick={() => setLandscape(false)}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: "var(--radius)", fontSize: 12,
                border: `1.5px solid ${!landscape ? "var(--accent)" : "var(--border)"}`,
                background: !landscape ? "var(--accent-bg)" : "var(--bg)",
                color: !landscape ? "var(--accent)" : "var(--text2)",
              }}
            >
              Dọc (9:16)
            </button>
          </div>
        </div>
        <div>
          <ModalLabel>Số lượng (×)</ModalLabel>
          <div style={{ display: "flex", gap: 4 }}>
            {([1, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMultiplier(n)}
                style={{
                  flex: 1, padding: "6px 8px", borderRadius: "var(--radius)", fontSize: 12,
                  border: `1.5px solid ${multiplier === n ? "var(--accent)" : "var(--border)"}`,
                  background: multiplier === n ? "var(--accent-bg)" : "var(--bg)",
                  color: multiplier === n ? "var(--accent)" : "var(--text2)",
                }}
              >
                ×{n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ModalRow>
        <ModalLabel>Thư mục ảnh đầu (start frame). 1.png, 2.png... theo thứ tự kịch bản hoặc prompt bên dưới</ModalLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={startFramesDir} onChange={setStartFramesDir} placeholder="Chọn thư mục..." style={{ flex: 1 }}/>
          <Btn onClick={handlePickStartFrames}><Icon.Folder /> Chọn</Btn>
        </div>
        {startFramesDir && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>
            → 1.png, 2.png... trong thư mục này
          </div>
        )}
      </ModalRow>

      <ModalRow>
        <ModalLabel>Thư mục ảnh cuối (end frame, tùy chọn). 1.png, 2.png... cùng thứ tự như ảnh đầu</ModalLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={endFramesDir} onChange={setEndFramesDir} placeholder="Không dùng ảnh cuối" style={{ flex: 1 }}/>
          <Btn onClick={handlePickEndFrames}><Icon.Folder /> Chọn</Btn>
        </div>
        {endFramesDir && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>
            → 1.png, 2.png... trong thư mục này
          </div>
        )}
      </ModalRow>

      <ModalRow>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Checkbox
            checked={useScripts}
            onChange={() => setUseScripts(v => !v)}
          />
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            1 dự án = 1 kịch bản; nhiều ảnh (1.png, 2.png...) — mỗi ảnh chạy qua tất cả prompt trong kịch bản
          </span>
        </div>
        {useScripts ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scripts.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text3)" }}>Chưa có kịch bản. Tạo kịch bản trước (Thêm kịch bản).</div>
            ) : (
              scriptsNewestFirst.map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="radio"
                    name="veo3-script"
                    checked={selectedScriptIds.has(s.id)}
                    onChange={() => setSelectedScriptIds(new Set([s.id]))}
                  />
                  <span style={{ fontSize: 13 }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>({s.prompts.length} prompt{s.prompts.length !== 1 ? "s" : ""})</span>
                </div>
              ))
            )}
            {prompts.length > 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: "var(--text3)" }}>
                Thư mục ảnh đầu bên trên: 1.png, 2.png... — mỗi ảnh chạy qua {prompts.length} prompt. Tổng: {prompts.length} × (số ảnh) job.
              </div>
            )}
          </div>
        ) : null}
      </ModalRow>

      {!useScripts && (
      <ModalRow>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <ModalLabel>Prompts</ModalLabel>
          <Btn size="sm" variant="ghost" onClick={handlePickTxt}><Icon.Upload /> Từ file .txt</Btn>
        </div>
        <Input
          value={promptText}
          onChange={setPromptText}
          multiline
          rows={5}
          placeholder={"Prompt 1...\n\nPrompt 2...\n\nPrompt 3..."}
        />
        {prompts.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text3)" }}>
            {prompts.length} prompt{prompts.length > 1 ? "s" : ""} (cách nhau bởi dòng trắng)
          </div>
        )}
      </ModalRow>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Btn onClick={onClose}>Huỷ</Btn>
        <Btn variant="primary" onClick={handleSave} disabled={!valid}>
          {isEdit ? "Cập nhật" : <><Icon.Plus /> Tạo dự án Veo3</>}
        </Btn>
      </div>
    </Modal>
  )
}
