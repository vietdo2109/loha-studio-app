import { Icon } from './icons'

export function ErrorPanel({ errors, expanded, onToggle }: {
  errors: string[]; expanded: boolean; onToggle: () => void
}) {
  if (errors.length === 0) return null
  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
          cursor: "pointer", color: "var(--danger)", fontSize: 12, fontWeight: 500,
        }}
      >
        <Icon.Dot color="var(--danger)"/>
        {errors.length} lỗi
        <span style={{ marginLeft: "auto", color: "var(--text3)" }}>
          {expanded ? <Icon.ChevronD/> : <Icon.ChevronR/>}
        </span>
      </div>
      {expanded && (
        <div style={{
          maxHeight: 140, overflowY: "auto", padding: "0 14px 10px",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {errors.map((e, i) => (
            <div key={i} style={{
              fontSize: 12, color: "var(--danger)", fontFamily: "var(--mono)",
              padding: "4px 8px", background: "var(--danger-bg)", borderRadius: 4,
            }}>{e}</div>
          ))}
        </div>
      )}
    </div>
  )
}
