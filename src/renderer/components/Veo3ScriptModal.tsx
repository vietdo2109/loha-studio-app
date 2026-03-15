import { useState, useEffect } from 'react'
import type { Script } from '../types'
import { Modal, ModalRow, ModalLabel, Btn, Input } from './ui'
import { Icon } from './icons'

export function Veo3ScriptModal({ onClose, onSave, onDelete, scripts = [], initial }: {
  onClose: () => void
  onSave: (s: Script | Omit<Script, 'id'>) => void
  onDelete?: (id: string) => void
  scripts?: Script[]
  initial?: Script | null
}) {
  const [view, setView] = useState<'list' | 'form'>(initial ? 'form' : 'list')
  const [editing, setEditing] = useState<Script | null>(initial ?? null)
  const [name, setName] = useState(editing?.name ?? '')
  const [promptText, setPromptText] = useState(editing ? editing.prompts.join('\n\n') : '')

  useEffect(() => {
    if (initial) {
      setView('form')
      setEditing(initial)
      setName(initial.name)
      setPromptText(initial.prompts.join('\n\n'))
    } else {
      setView('list')
      setEditing(null)
      setName('')
      setPromptText('')
    }
  }, [initial?.id])

  useEffect(() => {
    if (editing) {
      setName(editing.name)
      setPromptText(editing.prompts.join('\n\n'))
    } else {
      setName('')
      setPromptText('')
    }
  }, [editing?.id])

  const prompts = promptText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const valid = name.trim() && prompts.length > 0

  const handleSave = () => {
    if (!valid) return
    if (editing) {
      onSave({ ...editing, name: name.trim(), prompts })
    } else {
      onSave({ name: name.trim(), prompts })
    }
    setView('list')
    setEditing(null)
  }

  if (view === 'list') {
    return (
      <Modal title="Kịch bản" onClose={onClose} width={480}>
        <div style={{ marginBottom: 12 }}>
          <Btn variant="primary" size="sm" onClick={() => { setEditing(null); setView('form'); setName(''); setPromptText('') }}>
            <Icon.Plus /> Thêm kịch bản
          </Btn>
        </div>
        {scripts.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text3)', padding: '16px 0' }}>
            Chưa có kịch bản. Nhấn "Thêm kịch bản" để tạo.
          </div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...scripts]
              .sort((a, b) => Number(b.id) - Number(a.id))
              .map(s => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--bg2)',
                  cursor: 'pointer', fontSize: 13, border: '1px solid transparent',
                }}
                onClick={() => { setEditing(s); setView('form') }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--bg3)'
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--bg2)'
                  e.currentTarget.style.borderColor = 'transparent'
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.prompts.length} prompt{s.prompts.length !== 1 ? 's' : ''}</span>
                <Icon.ChevronR style={{ color: 'var(--text3)' }} />
              </div>
            ))}
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal title={editing ? `Chỉnh sửa: ${editing.name}` : 'Kịch bản mới'} onClose={onClose} width={520}>
      <ModalRow>
        <ModalLabel>Tên kịch bản</ModalLabel>
        <Input value={name} onChange={setName} placeholder="VD: Quảng cáo sản phẩm A"/>
      </ModalRow>
      <ModalRow>
        <ModalLabel>Prompts (mỗi prompt cách nhau bởi dòng trắng)</ModalLabel>
        <Input
          value={promptText}
          onChange={setPromptText}
          multiline
          rows={8}
          placeholder="Prompt 1...\n\nPrompt 2...\n\nPrompt 3..."
        />
        {prompts.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text3)' }}>
            {prompts.length} prompt{prompts.length > 1 ? 's' : ''}
          </div>
        )}
      </ModalRow>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={() => { setView('list'); setEditing(null) }}>← Quay lại</Btn>
          {editing && onDelete && (
            <Btn variant="danger" onClick={() => { onDelete(editing.id); setView('list'); setEditing(null) }}>
              <Icon.Trash /> Xoá kịch bản
            </Btn>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={onClose}>Huỷ</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={!valid}>
            {editing ? 'Cập nhật' : <><Icon.Plus /> Tạo kịch bản</>}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
