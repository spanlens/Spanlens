/**
 * Poll Spanlens /api/v1/requests until a row matching `predicate` appears.
 * Returns the elapsed time (ms) between `since` and arrival.
 *
 * Used by benchmark.ts to measure ingest latency: time from upstream
 * provider 200 OK to the row being queryable in the dashboard.
 */

interface RequestRow {
  id: string
  provider: string
  model: string
  created_at: string
  total_tokens: number
}

interface PollOptions {
  jwt: string
  apiBase: string
  /** Reference time — only rows created strictly after this are considered. */
  since: Date
  /** Function to identify the row we're waiting for. */
  predicate: (row: RequestRow) => boolean
  /** Max wait before giving up (ms). Default 30 000. */
  timeoutMs?: number
  /** Poll interval (ms). Default 250. */
  intervalMs?: number
}

export interface PollResult {
  ok: boolean
  /** Wall-clock ms between `since` and the row appearing. */
  latencyMs: number
  row: RequestRow | null
  attempts: number
}

export async function pollUntilRowAppears(opts: PollOptions): Promise<PollResult> {
  const { jwt, apiBase, since, predicate, timeoutMs = 30_000, intervalMs = 250 } = opts
  const deadline = Date.now() + timeoutMs
  let attempts = 0

  while (Date.now() < deadline) {
    attempts++
    const res = await fetch(`${apiBase}/api/v1/requests?limit=20`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`[poll] ${res.status} ${text.slice(0, 200)}`)
    }

    const json = (await res.json()) as { data?: RequestRow[] }
    const rows = json.data ?? []
    const fresh = rows.filter((r) => new Date(r.created_at) > since)
    const match = fresh.find(predicate)

    if (match) {
      return {
        ok: true,
        latencyMs: Date.now() - since.getTime(),
        row: match,
        attempts,
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  return { ok: false, latencyMs: Date.now() - since.getTime(), row: null, attempts }
}
