'use client'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'

/**
 * Config fields for the non-LLM evaluator types. Each export renders exactly
 * the markup NewEvaluatorDialog used to inline, so the form's `space-y-3`
 * spacing is unchanged: single-element blocks stay single elements and the
 * multi-element embedding block still returns a fragment.
 */

export function RegexFields({
  pattern,
  setPattern,
  flags,
  setFlags,
}: {
  pattern: string
  setPattern: (value: string) => void
  flags: string
  setFlags: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-[1fr_120px] gap-3">
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
          Pattern
        </label>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="e.g. ^\\{.*\\}$"
          required
          className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
        />
      </div>
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
          Flags
        </label>
        <input
          type="text"
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="e.g. im"
          className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
        />
      </div>
    </div>
  )
}

export function JsonSchemaField({
  schemaText,
  setSchemaText,
}: {
  schemaText: string
  setSchemaText: (value: string) => void
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
        JSON Schema
      </label>
      <textarea
        value={schemaText}
        onChange={(e) => setSchemaText(e.target.value)}
        rows={8}
        spellCheck={false}
        required
        className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[11.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-y"
      />
      <p className="font-mono text-[10.5px] text-text-faint mt-1">
        Standard JSON Schema (draft-07). Default accepts any object.
      </p>
    </div>
  )
}

export function ExactMatchFields({
  value,
  setValue,
  caseSensitive,
  setCaseSensitive,
}: {
  value: string
  setValue: (value: string) => void
  caseSensitive: boolean
  setCaseSensitive: (value: boolean) => void
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
        Expected value
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. approved"
        required
        className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
      />
      <label className="flex items-center gap-2 mt-2 font-mono text-[11px] text-text-muted">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.target.checked)}
        />
        Case-sensitive
      </label>
      <p className="font-mono text-[10.5px] text-text-faint mt-1">
        Trimmed before comparing. Case-insensitive unless checked.
      </p>
    </div>
  )
}

export function ContainsFields({
  substring,
  setSubstring,
  caseSensitive,
  setCaseSensitive,
}: {
  substring: string
  setSubstring: (value: string) => void
  caseSensitive: boolean
  setCaseSensitive: (value: boolean) => void
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
        Substring
      </label>
      <input
        type="text"
        value={substring}
        onChange={(e) => setSubstring(e.target.value)}
        placeholder="e.g. order confirmed"
        required
        className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
      />
      <label className="flex items-center gap-2 mt-2 font-mono text-[11px] text-text-muted">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.target.checked)}
        />
        Case-sensitive
      </label>
      <p className="font-mono text-[10.5px] text-text-faint mt-1">
        Passes when the response contains this text. Case-insensitive unless checked.
      </p>
    </div>
  )
}

export function EmbeddingFields({
  provider,
  setProvider,
  model,
  setModel,
  referenceText,
  setReferenceText,
  threshold,
  setThreshold,
}: {
  provider: string
  setProvider: (value: string) => void
  model: string
  setModel: (value: string) => void
  referenceText: string
  setReferenceText: (value: string) => void
  threshold: string
  setThreshold: (value: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
            Embedding provider
          </label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="azure">Azure</SelectItem>
              <SelectItem value="mistral">Mistral</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
            Model
          </label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="text-embedding-3-small"
            required
            className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
          />
        </div>
      </div>
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
          Reference text
        </label>
        <textarea
          value={referenceText}
          onChange={(e) => setReferenceText(e.target.value)}
          rows={3}
          placeholder="The ideal answer to compare responses against…"
          className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
        />
        <p className="font-mono text-[10.5px] text-text-faint mt-1">
          Used for production runs. Dataset items use their own expected_output when present.
        </p>
      </div>
      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
          Pass threshold (optional, 0–1)
        </label>
        <input
          type="text"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder="e.g. 0.8"
          className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
        />
      </div>
    </>
  )
}
