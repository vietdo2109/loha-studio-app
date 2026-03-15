import React, { useRef, useEffect } from 'react'
import { Icon } from './icons'

export function Btn({
  children, onClick, variant = "default", size = "md", disabled, style: sx, title,
}: {
  children: React.ReactNode; onClick?: (e?: React.MouseEvent) => void
  variant?: "default"|"primary"|"danger"|"ghost"|"success"
  size?: "sm"|"md"|"lg"; disabled?: boolean
  style?: React.CSSProperties; title?: string
}) {
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    fontWeight: 500, borderRadius: "var(--radius)", border: "1px solid transparent",
    transition: "all .15s", whiteSpace: "nowrap", flexShrink: 0,
    opacity: disabled ? .45 : 1, pointerEvents: disabled ? "none" : "auto",
    ...(size === "sm"  ? { padding: "4px 10px",  fontSize: 12 } :
        size === "lg"  ? { padding: "8px 18px",  fontSize: 13 } :
                         { padding: "6px 13px",  fontSize: 13 }),
    ...(variant === "primary" ? {
      background: "var(--accent)", color: "#fff", borderColor: "var(--accent)",
    } : variant === "danger" ? {
      background: "var(--danger-bg)", color: "var(--danger)", borderColor: "#fca5a5",
    } : variant === "success" ? {
      background: "var(--accent2-bg)", color: "var(--accent2)", borderColor: "#86efac",
    } : variant === "ghost" ? {
      background: "transparent", color: "var(--text2)", borderColor: "transparent",
    } : {
      background: "var(--surface)", color: "var(--text)", borderColor: "var(--border)",
    }),
    ...sx,
  }
  return <button onClick={onClick} style={base} title={title}>{children}</button>
}

export function Tag({ children, color = "default" }: { children: React.ReactNode; color?: "blue"|"green"|"orange"|"default" }) {
  const colors = {
    blue:    { bg: "var(--accent-bg)",  text: "var(--accent)" },
    green:   { bg: "var(--accent2-bg)", text: "var(--accent2)" },
    orange:  { bg: "var(--warn-bg)",    text: "var(--warn)" },
    default: { bg: "var(--bg2)",        text: "var(--text2)" },
  }
  const c = colors[color]
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 500, padding: "2px 7px",
      borderRadius: 99, background: c.bg, color: c.text,
    }}>{children}</span>
  )
}

export function ProgressBar({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  return (
    <div style={{ flex: 1, height: 5, background: "var(--bg3)", borderRadius: 99, overflow: "hidden", minWidth: 60 }}>
      <div style={{
        height: "100%", width: `${value}%`, background: color,
        borderRadius: 99, transition: "width .3s ease",
      }}/>
    </div>
  )
}

export function Checkbox({ checked, onChange, indeterminate }: { checked: boolean; onChange: () => void; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate }, [indeterminate])
  return (
    <div onClick={onChange} style={{
      width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${checked || indeterminate ? "var(--accent)" : "var(--border2)"}`,
      background: checked || indeterminate ? "var(--accent)" : "var(--surface)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, transition: "all .12s", cursor: "pointer",
    }}>
      {(checked || indeterminate) && <span style={{ color: "#fff", lineHeight: 1 }}>{indeterminate ? "−" : <Icon.Check />}</span>}
    </div>
  )
}

export function Input({ value, onChange, placeholder, style: sx, multiline, rows }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; style?: React.CSSProperties
  multiline?: boolean; rows?: number
}) {
  const inputRef = useRef<any>(null)
  const base: React.CSSProperties = {
    width: "100%", padding: "7px 10px",
    background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", fontSize: 13, color: "var(--text)",
    transition: "border-color .15s", resize: multiline ? "vertical" : undefined,
    ...sx,
  }
  const handleMouseDown: React.MouseEventHandler = (e) => { e.stopPropagation() }
  const handleBlur: React.FocusEventHandler = (e) => {
    if (!e.relatedTarget) {
      setTimeout(() => {
        if (document.activeElement === document.body && inputRef.current) {
          inputRef.current.focus()
        }
      }, 0)
    }
  }
  return multiline
    ? (
      <textarea
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows ?? 4}
        style={base}
        onMouseDown={handleMouseDown}
        onBlur={handleBlur}
      />
    ) : (
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={base}
        onMouseDown={handleMouseDown}
        onBlur={handleBlur}
      />
    )
}

export function Select<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} style={{
      padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", fontSize: 13, color: "var(--text)", width: "100%", cursor: "pointer",
    }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Seg<T extends string>({ value, onChange, options, disabledOptions }: {
  value: T; onChange: (v: T) => void; options: T[]; disabledOptions?: T[]
}) {
  return (
    <div style={{ display: "flex", background: "var(--bg2)", borderRadius: "var(--radius)", padding: 2, gap: 2 }}>
      {options.map(o => (
        <button
          key={o}
          onClick={() => {
            if (disabledOptions?.includes(o)) return
            onChange(o)
          }}
          style={{
          flex: 1, padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: value === o ? "var(--surface)" : "transparent",
          color: disabledOptions?.includes(o)
            ? "var(--text3)"
            : value === o
              ? "var(--text)"
              : "var(--text3)",
          boxShadow: value === o ? "var(--shadow)" : "none",
          transition: "all .12s",
        }}>{o}</button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, width = 520 }: {
  title: string; onClose: () => void
  children: React.ReactNode; width?: number
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,.25)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width, maxHeight: "85vh", background: "var(--surface)",
        borderRadius: 'var(--radius-lg)', boxShadow: "var(--shadow-lg)",
        display: "flex", flexDirection: "column",
        animation: "fadeIn .15s ease",
        border: "1px solid var(--border)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
          <Btn variant="ghost" size="sm" onClick={onClose}><Icon.X /></Btn>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
      {children}
    </div>
  )
}

export function ModalRow({ children, style: sx }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ marginBottom: 16, ...sx }}>{children}</div>
}
