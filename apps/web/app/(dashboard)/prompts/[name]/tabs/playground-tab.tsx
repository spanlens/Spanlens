'use client'
import { useState, useMemo } from 'react'
import { Play, Loader2, AlertTriangle, CheckCircle2, Key } from 'lucide-react'
import { usePlaygroundRun, type PromptVersion, type PlaygroundResult } from '@/lib/queries/use-prompts'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'
import { useModels, type ModelsByProvider } from '@/lib/queries/use-models'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'
import { CONTROL, Well } from '../../../_board/surfaces'

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function extractVars(content: string): string[] {
  const names = new Set<string>()
  for (const match of content.matchAll(VAR_RE)) {
    names.add(match[1]!)
  }
  return [...names]
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

/** Pick the model strings for a provider out of the catalog. */
function modelsForProvider(
  catalog: ModelsByProvider | undefined,
  provider: string | undefined | null,
): string[] {
  if (!catalog || !provider) return []
  const key = provider as keyof ModelsByProvider
  return (catalog[key] ?? []).map((m) => m.model)
}

function fmtUsd(v: number): string {
  return v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(6)}`
}

/** Small figure tile used for the run's model / tokens / cost / latency. */
function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-sunk px-3 py-2.5">
      <p className="micro-label mb-1 tracking-[0.1em]">{label}</p>
      <p className="truncate font-mono text-[12px] text-text" title={value}>{value}</p>
    </div>
  )
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
  const { data: modelsCatalog } = useModels()
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
    () => modelsForProvider(modelsCatalog, selectedKey?.provider),
    [modelsCatalog, selectedKey],
  )

  // Reset model when key changes
  function handleKeyChange(keyId: string) {
    setSelectedKeyId(keyId)
    setResult(null)
    const key = activeKeys.find((k) => k.id === keyId)
    const models = modelsForProvider(modelsCatalog, key?.provider)
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
      <div className="card-surface rounded-card flex h-56 flex-col items-center justify-center gap-2 text-text-muted">
        <p className="text-[12.5px]">No versions available to run.</p>
      </div>
    )
  }

  return (
    /* D4 lays a fixed-width panel beside a filling one; the config column keeps
       its 320px and the transcript takes the rest, stacking below lg. */
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Config panel */}
      <Card className="flex flex-col gap-5 px-5 py-[18px]">
        <div className="flex flex-col gap-1.5">
          <label className="micro-label tracking-[0.1em]">Version</label>
          <Select {...(selectedVersionId ? { value: selectedVersionId } : {})} onValueChange={(v) => { setSelectedVersionId(v); setResult(null) }}>
            <SelectTrigger className="h-[34px] rounded-md"><SelectValue /></SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  v{v.version}{v.id === latestVersion?.id ? ' (latest)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="micro-label flex items-center gap-1.5 tracking-[0.1em]">
            <Key className="h-3 w-3" />
            Provider key
          </label>
          {keysLoading ? (
            <div className="h-[34px] animate-pulse rounded-md bg-bg-chip" />
          ) : activeKeys.length === 0 ? (
            <p className="font-mono text-[11px] leading-[1.65] text-warn">
              No active keys found. Create one in{' '}
              <a href="/projects" className="underline">Projects &amp; Keys</a>.
            </p>
          ) : (
            <Select {...(selectedKeyId ? { value: selectedKeyId } : {})} onValueChange={handleKeyChange}>
              <SelectTrigger className="h-[34px] rounded-md"><SelectValue placeholder="Select a key…" /></SelectTrigger>
              <SelectContent>
                {activeKeys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name} · {PROVIDER_LABELS[k.provider ?? ''] ?? k.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Model, only shown once a key is selected */}
        {selectedKey && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <label className="micro-label tracking-[0.1em]">Model</label>
              <StatusPill>{PROVIDER_LABELS[selectedKey.provider ?? ''] ?? selectedKey.provider}</StatusPill>
            </span>
            <Select {...(model ? { value: model } : {})} onValueChange={setModel}>
              <SelectTrigger className="h-[34px] rounded-md"><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="micro-label tracking-[0.1em]" htmlFor="pg-temperature">Temperature</label>
            <span className="font-mono text-[11px] tabular-nums text-text-muted">{temperature.toFixed(1)}</span>
          </div>
          <input
            id="pg-temperature"
            type="range"
            min="0" max="2" step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between font-mono text-[10px] text-text-faint">
            <span>0 precise</span>
            <span>2 creative</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="micro-label tracking-[0.1em]" htmlFor="pg-max-tokens">Max tokens</label>
          <input
            id="pg-max-tokens"
            type="number"
            min="1" max="8192"
            value={maxTokens}
            onChange={(e) =>
              setMaxTokens(Math.min(8192, Math.max(1, parseInt(e.target.value, 10) || 1)))
            }
            className={cn(CONTROL, 'w-full px-3 font-mono text-[12.5px] tabular-nums text-text focus:border-border-strong focus:outline-none')}
          />
        </div>

        {detectedVars.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className="micro-label tracking-[0.1em]">Variables</span>
            {detectedVars.map((varName) => (
              <div key={varName} className="flex flex-col gap-1">
                <label
                  className="font-mono text-[11px] text-accent"
                  htmlFor={`pg-var-${varName}`}
                >
                  {`{{${varName}}}`}
                </label>
                <input
                  id={`pg-var-${varName}`}
                  type="text"
                  placeholder={`Value for ${varName}…`}
                  value={variables[varName] ?? ''}
                  onChange={(e) =>
                    setVariables((prev) => ({ ...prev, [varName]: e.target.value }))
                  }
                  className={cn(CONTROL, 'w-full px-3 font-mono text-[12.5px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
                />
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={runMutation.isPending || !canRun}
          className="inline-flex h-[34px] w-full items-center justify-center gap-2 rounded-full bg-accent text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-40"
        >
          {runMutation.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
          ) : (
            <><Play className="h-3.5 w-3.5" />Run</>
          )}
        </button>

        {!selectedKeyId && !keysLoading && activeKeys.length > 0 && (
          <p className="text-center font-mono text-[11px] text-text-faint">
            Select a provider key to run.
          </p>
        )}

        {runMutation.isError && (
          <div className="flex min-w-0 items-start gap-2 rounded-lg bg-bad-bg px-3.5 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />
            <p className="min-w-0 break-all font-mono text-[11px] leading-[1.65] text-bad">
              {runMutation.error instanceof Error ? runMutation.error.message : 'Failed to run'}
            </p>
          </div>
        )}
      </Card>

      {/* Preview + result */}
      <Card className="flex min-w-0 flex-col gap-3.5 px-5 py-[18px]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[13px] leading-[1.45] text-text">
            {selectedVersion ? `v${selectedVersion.version}` : 'Prompt'} preview
          </span>
        </div>
        <Well className="max-h-52 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.65] text-text-muted">
            {selectedVersion?.content ?? '—'}
          </pre>
        </Well>

        {!result && !runMutation.isPending && !runMutation.isError && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-muted">
            <Play className="h-5 w-5 text-text-faint" />
            <p className="font-mono text-[12px]">Run the prompt to see results here.</p>
          </div>
        )}

        {runMutation.isPending && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
            <p className="font-mono text-[12px]">Waiting for response…</p>
          </div>
        )}

        {result && !runMutation.isPending && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ResultStat label="Model" value={result.model} />
              <ResultStat label="Tokens" value={result.totalTokens.toLocaleString()} />
              <ResultStat label="Cost" value={result.costUsd != null ? fmtUsd(result.costUsd) : '—'} />
              <ResultStat
                label="Latency"
                value={result.latencyMs >= 1000
                  ? `${(result.latencyMs / 1000).toFixed(2)}s`
                  : `${result.latencyMs}ms`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-text-faint">
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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="micro-label tracking-[0.1em]">Response</span>
                <CheckCircle2 className="h-3 w-3 text-good" />
              </div>
              <Well>
                <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-text">
                  {result.responseText}
                </pre>
              </Well>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
