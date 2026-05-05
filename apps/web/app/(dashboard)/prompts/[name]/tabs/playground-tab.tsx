'use client'
import { useState, useMemo } from 'react'
import { Play, Loader2, AlertTriangle, CheckCircle2, Key } from 'lucide-react'
import { usePlaygroundRun, type PromptVersion, type PlaygroundResult } from '@/lib/queries/use-prompts'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function extractVars(content: string): string[] {
  const names = new Set<string>()
  for (const match of content.matchAll(VAR_RE)) {
    names.add(match[1]!)
  }
  return [...names]
}

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: [
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

function fmtUsd(v: number): string {
  return v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(6)}`
}

interface Props {
  versions: PromptVersion[]
}

export function PlaygroundTab({ versions }: Props) {
  const latestVersion = versions[0] ?? null
  const [selectedVersionId, setSelectedVersionId] = useState<string>(latestVersion?.id ?? '')
  const [selectedKeyId, setSelectedKeyId] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [result, setResult] = useState<PlaygroundResult | null>(null)

  const { data: allKeys, isLoading: keysLoading } = useProviderKeys()
  const runMutation = usePlaygroundRun()

  // Playground runs against a provider key directly — no Spanlens key here.
  const activeKeys = useMemo(
    () => (allKeys ?? []).filter((k) => k.is_active),
    [allKeys],
  )

  const selectedKey = useMemo(
    () => activeKeys.find((k) => k.id === selectedKeyId) ?? null,
    [activeKeys, selectedKeyId],
  )

  const availableModels = useMemo(
    () => (selectedKey?.provider ? (MODELS_BY_PROVIDER[selectedKey.provider] ?? []) : []),
    [selectedKey],
  )

  // Reset model when key changes
  function handleKeyChange(keyId: string) {
    setSelectedKeyId(keyId)
    setResult(null)
    const key = activeKeys.find((k) => k.id === keyId)
    const models = key?.provider ? (MODELS_BY_PROVIDER[key.provider] ?? []) : []
    setModel(models[0] ?? '')
  }

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? latestVersion,
    [versions, selectedVersionId, latestVersion],
  )

  const detectedVars = useMemo(
    () => (selectedVersion ? extractVars(selectedVersion.content) : []),
    [selectedVersion],
  )

  const canRun = selectedVersion && selectedKeyId && model

  async function handleRun() {
    if (!canRun) return
    try {
      const res = await runMutation.mutateAsync({
        promptVersionId: selectedVersion.id,
        providerKeyId: selectedKey?.id ?? '',
        model,
        variables,
        temperature,
        maxTokens,
      })
      setResult(res ?? null)
    } catch {
      // error shown via runMutation.isError
    }
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-muted">
        <p className="text-[13px]">No versions available to run.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Config panel */}
      <div className="w-[320px] shrink-0 border-r border-border overflow-y-auto p-[18px] space-y-5">

        {/* Version */}
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Version</label>
          <select
            value={selectedVersionId}
            onChange={(e) => { setSelectedVersionId(e.target.value); setResult(null) }}
            className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}{v.id === latestVersion?.id ? ' (latest)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Provider Key */}
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint flex items-center gap-1.5">
            <Key className="h-3 w-3" />
            Provider Key
          </label>
          {keysLoading ? (
            <div className="h-8 bg-bg-elev rounded-[4px] animate-pulse" />
          ) : activeKeys.length === 0 ? (
            <p className="font-mono text-[11px] text-warn">
              No active keys found. Create one in{' '}
              <a href="/projects" className="underline">Projects &amp; Keys</a>.
            </p>
          ) : (
            <select
              value={selectedKeyId}
              onChange={(e) => handleKeyChange(e.target.value)}
              className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
            >
              <option value="">Select a key…</option>
              {activeKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} · {PROVIDER_LABELS[k.provider ?? ''] ?? k.provider}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Model — only shown once a key is selected */}
        {selectedKey && (
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
              Model
              <span className="ml-2 px-[5px] py-[1px] rounded-[3px] bg-bg-elev border border-border text-text-muted normal-case tracking-normal">
                {PROVIDER_LABELS[selectedKey.provider ?? ''] ?? selectedKey.provider}
              </span>
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {/* Temperature */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Temperature</label>
            <span className="font-mono text-[11px] text-text-muted">{temperature.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0" max="2" step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-text"
          />
          <div className="flex justify-between font-mono text-[10px] text-text-faint">
            <span>0 precise</span>
            <span>2 creative</span>
          </div>
        </div>

        {/* Max tokens */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Max tokens</label>
            <span className="font-mono text-[11px] text-text-muted">{maxTokens}</span>
          </div>
          <input
            type="number"
            min="1" max="8192"
            value={maxTokens}
            onChange={(e) =>
              setMaxTokens(Math.min(8192, Math.max(1, parseInt(e.target.value, 10) || 1)))
            }
            className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
          />
        </div>

        {/* Variables */}
        {detectedVars.length > 0 && (
          <div className="space-y-2.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Variables</label>
            {detectedVars.map((varName) => (
              <div key={varName} className="space-y-1">
                <label className="font-mono text-[11px] text-text-muted">
                  {`{{${varName}}}`}
                </label>
                <input
                  type="text"
                  placeholder={`Value for ${varName}…`}
                  value={variables[varName] ?? ''}
                  onChange={(e) =>
                    setVariables((prev) => ({ ...prev, [varName]: e.target.value }))
                  }
                  className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                />
              </div>
            ))}
          </div>
        )}

        {/* Run */}
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={runMutation.isPending || !canRun}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-[5px] bg-text text-bg font-mono text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {runMutation.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
          ) : (
            <><Play className="h-3.5 w-3.5" />Run</>
          )}
        </button>

        {!selectedKeyId && !keysLoading && activeKeys.length > 0 && (
          <p className="font-mono text-[11px] text-text-faint text-center">
            Select a provider key to run.
          </p>
        )}

        {runMutation.isError && (
          <div className="flex items-start gap-2 p-3 rounded-[5px] bg-bad/10 border border-bad/30 min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 text-bad shrink-0 mt-0.5" />
            <p className="font-mono text-[11px] text-bad leading-relaxed break-all min-w-0">
              {runMutation.error instanceof Error ? runMutation.error.message : 'Failed to run'}
            </p>
          </div>
        )}
      </div>

      {/* Preview + Result */}
      <div className="flex-1 min-w-0 overflow-y-auto flex flex-col">
        <div className="p-[18px] border-b border-border space-y-2 shrink-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Prompt preview</p>
          <div className="bg-bg-muted rounded-[6px] border border-border p-4 max-h-52 overflow-y-auto">
            <pre className="font-mono text-[12px] text-text-muted whitespace-pre-wrap leading-relaxed">
              {selectedVersion?.content ?? '—'}
            </pre>
          </div>
        </div>

        <div className="p-[18px] space-y-4 flex-1">
          {!result && !runMutation.isPending && !runMutation.isError && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
              <Play className="h-5 w-5 text-text-faint" />
              <p className="font-mono text-[12px]">Run the prompt to see results here.</p>
            </div>
          )}

          {runMutation.isPending && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
              <p className="font-mono text-[12px]">Waiting for response…</p>
            </div>
          )}

          {result && !runMutation.isPending && (
            <>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Model',   value: result.model },
                  { label: 'Tokens',  value: result.totalTokens.toLocaleString() },
                  { label: 'Cost',    value: result.costUsd != null ? fmtUsd(result.costUsd) : '—' },
                  {
                    label: 'Latency',
                    value: result.latencyMs >= 1000
                      ? `${(result.latencyMs / 1000).toFixed(2)}s`
                      : `${result.latencyMs}ms`,
                  },
                ].map((s) => (
                  <div key={s.label} className="bg-bg-elev rounded-[5px] border border-border px-3 py-2.5">
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-1">{s.label}</p>
                    <p className="font-mono text-[12px] text-text font-medium truncate" title={s.value}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-faint">
                <span><span className="text-text-muted">{result.promptTokens}</span> prompt</span>
                <span>+</span>
                <span><span className="text-text-muted">{result.completionTokens}</span> completion</span>
                <span>=</span>
                <span><span className="text-text-muted">{result.totalTokens}</span> total</span>
                {result.missingVars.length > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-warn">
                    <AlertTriangle className="h-3 w-3" />
                    missing: {result.missingVars.join(', ')}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Response</p>
                  <CheckCircle2 className="h-3 w-3 text-good" />
                </div>
                <div className="bg-bg-muted rounded-[6px] border border-border p-4">
                  <pre className="font-mono text-[12.5px] text-text whitespace-pre-wrap leading-relaxed">
                    {result.responseText}
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
