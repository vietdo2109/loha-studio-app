import type { Veo3Project, Veo3VideoMode } from '../types'
import { Btn, Tag, Checkbox } from './ui'
import { Icon } from './icons'

const MODE_LABEL: Record<Veo3VideoMode, string> = {
  frames:      'Frames',
  ingredients: 'Ingredients',
}

function modelLabel(model: string): string {
  if (model === 'veo-3.1-fast-lower-priority') return '3.1 Fast LP'
  if (model === 'veo-3.1-quality') return '3.1 Quality'
  return '3.1 Fast'
}

export function Veo3ProjectRow({ project, checked, onCheck, onEdit }: {
  project: Veo3Project
  checked: boolean
  onCheck: () => void
  onEdit?: (p: Veo3Project) => void
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
      borderRadius: "var(--radius)",
      background: checked ? "var(--accent-bg)" : "var(--surface)",
      border: `1px solid ${checked ? "#bfdbfe" : "var(--border)"}`,
      transition: "all .12s", cursor: "pointer",
      animation: "slideIn .15s ease",
    }} onClick={onCheck}>
      <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexShrink: 0 }}>
        <Checkbox checked={checked} onChange={onCheck}/>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: "var(--text)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {project.name}
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          <Tag color="blue">{MODE_LABEL[project.videoMode]}</Tag>
          <Tag>{modelLabel(project.aiModel)}</Tag>
          <Tag>{project.landscape ? "Ngang" : "Dọc"}</Tag>
          <Tag>×{project.multiplier}</Tag>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{project.prompts.length} prompt{project.prompts.length !== 1 ? "s" : ""}</span>
          {(project.startFramesDir || project.imageDir) && <Tag color="green">Có ảnh</Tag>}
        </div>
      </div>
      {onEdit && (
        <Btn
          size="sm"
          variant="ghost"
          title="Chỉnh sửa dự án"
          onClick={(e) => { e?.stopPropagation(); onEdit(project) }}
          style={{ padding: "4px 8px" }}
        >
          <Icon.Edit /> Sửa
        </Btn>
      )}
    </div>
  )
}
