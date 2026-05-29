// ─────────────────────────────────────────────────────────────────────────────
// Outbound webhook event emitter.
//
// Fans an event out to every active webhook of an org that subscribes to it,
// reusing dispatchWebhookEvent (HMAC signing + delivery record + retry).
//
// WHY THE CACHE
// -------------
// `request.created` fires on EVERY proxied LLM call. A DB lookup per call to
// find "does this org have a webhook?" would put one extra Supabase query on
// the hot logging path. Since the overwhelming majority of orgs have zero
// webhooks, we cache the per-org active-webhook list in module memory with a
// short TTL (stale-while-revalidate): the common no-webhook case costs a single
// Map lookup. Per Vercel serverless, each instance has its own cache; webhook
// CRUD calls invalidateWebhookCache so the originating instance reflects
// changes immediately, and other instances catch up within CACHE_TTL_MS.
//
// Best-effort by design: a failed dispatch is recorded in webhook_deliveries
// (the retry cron picks it up) and never propagates to the caller — emitting an
// event must never break logging, ingest, or alert evaluation.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from './db.js'
import { dispatchWebhookEvent } from './webhook-dispatch.js'

export type WebhookEventType = 'request.created' | 'trace.completed' | 'alert.triggered'

interface ActiveWebhook {
  id: string
  url: string
  secret: string
  events: string[]
}

const CACHE_TTL_MS = 60 * 1000

interface CacheEntry {
  hooks: ActiveWebhook[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const refreshInFlight = new Map<string, Promise<void>>()

async function fetchActiveWebhooks(orgId: string): Promise<ActiveWebhook[]> {
  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .select('id, url, secret, events')
    .eq('organization_id', orgId)
    .eq('is_active', true)

  if (error) throw new Error(`webhooks fetch failed: ${error.message}`)

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: row['id'] as string,
      url: row['url'] as string,
      secret: row['secret'] as string,
      events: Array.isArray(row['events']) ? (row['events'] as string[]) : [],
    }
  })
}

async function getActiveWebhooksForOrg(orgId: string): Promise<ActiveWebhook[]> {
  const now = Date.now()
  const entry = cache.get(orgId)

  if (entry) {
    // Stale-while-revalidate: return what we have, refresh in the background.
    if (now - entry.fetchedAt > CACHE_TTL_MS && !refreshInFlight.has(orgId)) {
      const p = fetchActiveWebhooks(orgId)
        .then((hooks) => {
          cache.set(orgId, { hooks, fetchedAt: Date.now() })
        })
        .catch((err) => {
          console.warn('[webhook-emit] background refresh failed:', err instanceof Error ? err.message : err)
        })
        .finally(() => {
          refreshInFlight.delete(orgId)
        })
      refreshInFlight.set(orgId, p)
    }
    return entry.hooks
  }

  // Cold miss — await once, then cache. On error return empty (best-effort).
  try {
    const hooks = await fetchActiveWebhooks(orgId)
    cache.set(orgId, { hooks, fetchedAt: now })
    return hooks
  } catch (err) {
    console.warn('[webhook-emit] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Drop an org's cached webhook list. Called from webhook CRUD so the
 *  originating serverless instance reflects changes without waiting for TTL. */
export function invalidateWebhookCache(orgId: string): void {
  cache.delete(orgId)
}

/** Test helper — clears all cached state. */
export function _resetWebhookCacheForTests(): void {
  cache.clear()
  refreshInFlight.clear()
}

/**
 * Emit `eventType` to every active webhook of `orgId` subscribed to it.
 * Best-effort and non-throwing: safe to call (and await) from hot paths,
 * request handlers, and cron alike.
 */
export async function emitWebhookEvent(
  orgId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!orgId) return

  const hooks = await getActiveWebhooksForOrg(orgId)
  const matching = hooks.filter((h) => h.events.includes(eventType))
  if (matching.length === 0) return

  await Promise.all(
    matching.map((h) =>
      dispatchWebhookEvent({ id: h.id, url: h.url, secret: h.secret }, eventType, payload).catch(
        (err) => {
          console.error(
            '[webhook-emit] dispatch failed:',
            err instanceof Error ? err.message : err,
          )
        },
      ),
    ),
  )
}
