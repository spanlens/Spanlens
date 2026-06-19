/**
 * Generate a response for a dataset item by running the supplied prompt
 * content + the item's input through the chosen provider. Extracted from
 * eval-runner.ts (4B).
 *
 * Returns the assistant text on success, null on any failure (network,
 * 4xx/5xx, empty output). Callers should filter nulls.
 */
import { fetchWithRetry } from './shared.js'
import { buildOpenAIBody } from '../playground-runner.js'

export type EvalProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'

export async function generateForItem(
  promptContent: string,
  itemInput: Record<string, unknown>,
  provider: EvalProvider,
  model: string,
  apiKey: string,
  /** Azure resource origin (provider_keys.provider_metadata.resource_url).
   * Required when provider === 'azure'; ignored otherwise. */
  resourceUrl: string | null,
  /** Generation temperature (P1-5). Defaults to 0 at the run boundary for a
   * reproducible eval; was a hardcoded 0.7 before. */
  temperature: number,
): Promise<string | null> {
  // The dataset-item shape allows either `variables` (template substitution)
  // or `messages` (already-formatted chat). Translate to a single user
  // message string for the LLM call.
  let userContent: string
  if (itemInput['variables'] && typeof itemInput['variables'] === 'object') {
    // Variables are substituted into the prompt content. The judge sees
    // the response, not the substituted prompt — so this branch produces a
    // response based on the variable values + the prompt's template.
    const vars = itemInput['variables'] as Record<string, string>
    userContent = Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('\n')
  } else if (Array.isArray(itemInput['messages'])) {
    const msgs = itemInput['messages'] as Array<{ role: string; content: string }>
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    userContent = lastUser?.content ?? ''
  } else {
    return null
  }
  if (!userContent) return null

  try {
    if (provider === 'openai') {
      const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature, maxTokens: 1024 },
        )),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    if (provider === 'mistral' || provider === 'openrouter') {
      const url = provider === 'mistral'
        ? 'https://api.mistral.ai/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions'
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature, maxTokens: 1024 },
        )),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    if (provider === 'anthropic') {
      const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          temperature,
          system: promptContent,
          messages: [{ role: 'user', content: userContent }],
        }),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { content: Array<{ type: string; text: string }> }
      return json.content?.find((b) => b.type === 'text')?.text ?? null
    }

    if (provider === 'azure') {
      // Azure OpenAI v1 endpoint (Aug 2025+) is OpenAI-compatible: same body
      // shape, but the base URL is the per-key resource origin and auth uses
      // the `api-key` header instead of Bearer. Mirrors proxy/azure.ts.
      if (!resourceUrl) return null
      const res = await fetchWithRetry(`${resourceUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature, maxTokens: 1024 },
        )),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    // Gemini
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: promptContent }] },
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: { temperature, maxOutputTokens: 1024 },
        }),
      },
    )
    if (!res || !res.ok) return null
    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  } catch {
    return null
  }
}
