import type { Project, Mode } from '../types'
import { Btn, Tag, Checkbox } from './ui'
import { Icon } from './icons'

export function ProjectRow({ project, checked, onCheck, onEdit }: {
  project: Project; checked: boolean; onCheck: () => void; onEdit?: (p: Project) => void
}) {
  const modeLabel: Record<Mode, string> = {
    prompt_only:   "Prompt",
    edit_image:    "Edit",
    animate_image: "Animate",
  }
  const modeColor: Record<Mode, "blue"|"green"|"orange"> = {
    prompt_only:   "blue",
    edit_image:    "orange",
    animate_image: "green",
  }
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
          <Tag color={modeColor[project.mode]}>{modeLabel[project.mode]}</Tag>
          <Tag>{project.mediaType}</Tag>
          <Tag>{project.ratio}</Tag>
          {project.mediaType === "Video" && <Tag>{project.resolution}</Tag>}
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{project.prompts.length} prompts</span>
        </div>
      </div>
      {onEdit && (
        <Btn
          size="sm"
          variant="ghost"
          title="Chỉnh sửa dự án trước khi đưa vào queue"
          onClick={(e) => { e?.stopPropagation(); onEdit(project) }}
          style={{ padding: "4px 8px" }}
        >
          <Icon.Edit /> Sửa
        </Btn>
      )}
    </div>
  )
}
