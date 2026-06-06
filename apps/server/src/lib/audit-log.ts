import type { Context } from 'hono'
import { supabaseAdmin } from './db.js'

/**
 * Single entry point for writing to `audit_logs`. Every mutation route in
 * the server should call this so the audit trail captures consistent
 * actor + IP + timestamp data without each handler reinventing the
 * extraction.
 *
 * Contract:
 *   • Fire-and-forget by default. The caller awaits the returned promise
 *     only if it specifically wants insertion ordering (most don't).
 *   • Errors are swallowed and logged. We never let an audit failure
 *     abort the user-facing mutation — auditability is best-effort, not
 *     a precondition for state change.
 *   • The audit_logs table is INSERT-by-service-role only (RLS); we use
 *     supabaseAdmin throughout.
 *
 * Action naming convention: `<resource>.<verb>` lowercase, dot-separated.
 *   resource is the table name (api_keys, provider_keys, prompt_versions, …)
 *   verb is one of: create, update, delete, rotate, invite, accept, ...
 *
 * Severity tier mapping (UI consumer side):
 *   high — delete | revoke | rotate, billing.*, workspace.*, member.remove
 *   med  — create | add | update | change | invite
 *   low  — everything else
 *
 * Keep verbs aligned with these regex buckets in lib/audit-logs.ts.
 */

export interface AuditLogContext {
  organizationId: string | null
  userId: string | null
  ipAddress?: string | null
}

export interface AuditLogPayload {
  action: string
  resourceType: string
  resourceId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Extract the audit fields the server middleware has already resolved.
 * Pass the Hono context directly when calling from a route handler;
 * `recordAuditLog` will pull orgId/userId/IP off it automatically.
 */
export function auditContextFromHono(c: Context): AuditLogContext {
  // `c.get(...)` is loosely typed in Hono's surface; the actual values are
  // set by authJwt / authApiKey middleware.
  const organizationId =
    (c.get('orgId') as string | undefined) ??
    (c.get('organizationId') as string | undefined) ??
    null
  const userId = (c.get('userId') as string | undefined) ?? null

  // Vercel sets x-forwarded-for. The first hop is the client; later hops
  // are the proxy chain. We deliberately take only the first to avoid
  // logging Spanlens infrastructure IPs as the actor.
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  const xrealIp = c.req.header('x-real-ip')?.trim()
  const cfIp = c.req.header('cf-connecting-ip')?.trim()
  const ipAddress = xff || xrealIp || cfIp || null

  return { organizationId, userId, ipAddress }
}

/**
 * Insert one audit_logs row. Resolves to true on success, false on any
 * failure (caller still continues — audit is advisory, not blocking).
 *
 * If you have the Hono context, prefer {@link recordAuditEvent} below which
 * extracts the actor/IP fields for you. Use this lower-level signature only
 * when called from cron jobs, webhook receivers, or other non-HTTP code
 * paths that don't have a Hono context.
 */
export async function recordAuditLog(
  context: AuditLogContext,
  payload: AuditLogPayload,
): Promise<boolean> {
  // We do not enforce organizationId here even though the column is NOT
  // NULL — the server has multiple cron-driven writers that legitimately
  // resolve orgId at call time. Bail with a logged warning rather than
  // crash the caller.
  if (!context.organizationId) {
    console.warn('[audit-log] dropping row with missing organization_id', {
      action: payload.action,
      resource_type: payload.resourceType,
    })
    return false
  }

  const { error } = await supabaseAdmin.from('audit_logs').insert({
    organization_id: context.organizationId,
    user_id: context.userId,
    action: payload.action,
    resource_type: payload.resourceType,
    resource_id: payload.resourceId ?? null,
    metadata: payload.metadata ?? {},
    ip_address: context.ipAddress ?? null,
  })

  if (error) {
    console.error('[audit-log] insert failed:', error.message, {
      action: payload.action,
    })
    return false
  }

  return true
}

/**
 * Hono-aware wrapper. Most route handlers should use this — it extracts
 * orgId/userId/IP from the context and forwards to {@link recordAuditLog}.
 *
 * The handler should typically NOT await this; treat it as fire-and-forget
 * so a slow audit write never delays a 2xx response. The returned promise
 * is provided in case the caller wants to chain a follow-up insert or
 * await in tests.
 *
 * Example:
 *   recordAuditEvent(c, {
 *     action: 'api_key.create',
 *     resourceType: 'api_keys',
 *     resourceId: newKey.id,
 *     metadata: { scope: 'full', project_id: projectId },
 *   })
 */
export function recordAuditEvent(
  c: Context,
  payload: AuditLogPayload,
): Promise<boolean> {
  return recordAuditLog(auditContextFromHono(c), payload)
}
