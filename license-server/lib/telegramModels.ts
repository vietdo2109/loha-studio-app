/** Parse veo / grok / sora cho Telegram bot (webhook). */

export type ModelFlags = { veoActive: boolean; grokActive: boolean; soraActive: boolean }

export function parseDefaultModelsFromEnv(): ModelFlags {
  const raw = (process.env.DEFAULT_MODELS ?? 'veo,grok').trim().toLowerCase()
  if (!raw) return { veoActive: true, grokActive: true, soraActive: false }
  const tokens = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  return parseModelTokens(tokens)
}

export function parseModelTokens(tokens: string[]): ModelFlags {
  let veoActive = false
  let grokActive = false
  let soraActive = false
  for (const t of tokens) {
    const n = t.toLowerCase()
    if (n === 'veo' || n === 'veo3') veoActive = true
    else if (n === 'grok') grokActive = true
    else if (n === 'sora') soraActive = true
  }
  return { veoActive, grokActive, soraActive }
}

export function formatModelsLine(f: ModelFlags): string {
  const parts: string[] = []
  if (f.veoActive) parts.push('Veo3')
  if (f.grokActive) parts.push('Grok')
  if (f.soraActive) parts.push('Sora')
  return parts.length ? parts.join(', ') : '(chưa bật model nào)'
}
