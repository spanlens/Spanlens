const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function interpolate(
  content: string,
  vars: Record<string, string>,
): { result: string; missingVars: string[] } {
  const missing: string[] = []
  const result = content.replace(VAR_RE, (_, name: string) => {
    if (name in vars) return vars[name]!
    missing.push(name)
    return ''
  })
  return { result, missingVars: [...new Set(missing)] }
}

export function inferProvider(model: string): 'openai' | 'anthropic' {
  if (model.startsWith('claude-')) return 'anthropic'
  return 'openai'
}
