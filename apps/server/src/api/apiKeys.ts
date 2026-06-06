import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex, sha256Hex } from '../lib/crypto.js'
import { enqueueDeletion } from '../lib/pending-deletions.js'
import { recordAuditEvent } from '../lib/audit-log.js'

/**
 * Spanlens keys come in two shapes:
 *
 *   scope='full'   sl_live_<hex>        project-scoped (1:1 with a project).
 *                                       Used for proxy calls, ingest, and
 *                                       read endpoints. Provider AI keys hang
 *                                       off these via /api/v1/provider-keys.
 *
 *   scope='public' sl_live_pub_<hex>    workspace-scoped. Cannot be used for
 *                                       proxy or ingest (requireFullScope
 *                                       middleware enforces). Safe to drop
 *                                       into IDE config files, BI dashboards,
 *                                       and public read embeds — leak is
 *                                       capped to "competitor sees my LLM
 *                                       usage stats", no cost exposure.
 *
 * The DB CHECK constraint `api_keys_scope_owner_consistency` enforces that
 * full keys carry a project_id and public keys carry an organization_id
 * (and exactly one of those is set per row). This router just routes the
 * `scope` value to the right insert.
 */

export const apiKeysRouter = new Hono<JwtContext>()

apiKeysRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

async function projectBelongsToOrg(projectId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()
  return data !== null
}

// GET /api/v1/api-keys?projectId=xxx — list Spanlens keys for a project,
// or `?scope=public` to list workspace-level public keys, or (default)
// every key the user can see across the org.
apiKeysRouter.get('/', async (c) => {
  const projectId = c.req.query('projectId')
  const scopeFilter = c.req.query('scope')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let query = supabaseAdmin
    .from('api_keys')
    .select(
      'id, project_id, organization_id, name, key_prefix, scope, is_active, last_used_at, created_at',
    )
    .order('created_at', { ascending: false })

  if (scopeFilter === 'public') {
    // Workspace-level public keys live directly under the org.
    query = query.eq('organization_id', orgId).eq('scope', 'public')
  } else if (projectId) {
    const belongs = await projectBelongsToOrg(projectId, orgId)
    if (!belongs) return c.json({ error: 'Project not found' }, 404)
    query = query.eq('project_id', projectId)
  } else {
    // No filter: every key on every project in the org PLUS workspace-level
    // public keys. The two are unioned via .or() because they live under
    // different ownership columns.
    const { data: projects } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('organization_id', orgId)
    const projectIds = (projects ?? []).map((p) => p.id as string)
    if (projectIds.length === 0) {
      // Org has no projects yet — only public keys are possible.
      query = query.eq('organization_id', orgId)
    } else {
      const ids = projectIds.map((id) => `"${id}"`).join(',')
      query = query.or(`project_id.in.(${ids}),organization_id.eq.${orgId}`)
    }
  }

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to fetch API keys' }, 500)

  return c.json({ success: true, data: data ?? [] })
})

// POST /api/v1/api-keys/issue — mint a new sl_live_* key.
// Body:
//   { name, projectId }                — full key, project-scoped (default)
//   { name, scope: 'public' }          — public key, workspace-scoped
apiKeysRouter.post('/issue', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { name?: unknown; projectId?: unknown; scope?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }

  const scope: 'full' | 'public' = body.scope === 'public' ? 'public' : 'full'

  // Prefix encodes scope so a user can spot leaked permissions at a glance
  // (and grep for them in logs). `key_prefix` stays 15 chars so existing UI
  // columns line up.
  //   full   → sl_live_<24 hex>
  //   public → sl_live_pub_<24 hex>
  const rawKey =
    scope === 'public' ? `sl_live_pub_${randomHex(24)}` : `sl_live_${randomHex(24)}`
  const keyHash = await sha256Hex(rawKey)
  const keyPrefix = rawKey.slice(0, 15)

  // Branch on scope so we satisfy the DB's owner-consistency CHECK:
  //   full   → project_id required, organization_id null
  //   public → organization_id from JWT, project_id null
  let insertRow: {
    name: string
    key_hash: string
    key_prefix: string
    scope: 'full' | 'public'
    project_id?: string
    organization_id?: string
  }

  if (scope === 'full') {
    if (typeof body.projectId !== 'string') {
      return c.json({ error: 'projectId is required for full-access keys' }, 400)
    }
    const belongs = await projectBelongsToOrg(body.projectId, orgId)
    if (!belongs) return c.json({ error: 'Project not found' }, 404)
    insertRow = {
      project_id: body.projectId,
      name: body.name.trim(),
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scope: 'full',
    }
  } else {
    insertRow = {
      organization_id: orgId,
      name: body.name.trim(),
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scope: 'public',
    }
  }

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .insert(insertRow)
    .select(
      'id, project_id, organization_id, name, key_prefix, scope, is_active, created_at',
    )
    .single()

  if (error || !data) return c.json({ error: 'Failed to create API key' }, 500)

  void recordAuditEvent(c, {
    action: 'api_key.create',
    resourceType: 'api_keys',
    resourceId: data.id,
    metadata: {
      name: data.name,
      scope: data.scope,
      project_id: data.project_id,
      organization_id: data.organization_id,
      key_prefix: data.key_prefix,
    },
  })

  return c.json(
    {
      success: true,
      data: {
        ...data,
        key: rawKey, // shown to the user once — never persisted in plaintext
      },
    },
    201,
  )
})

/**
 * PATCH / DELETE need to resolve the key's owning organization regardless of
 * whether the key is project-scoped or workspace-scoped. This helper centralises
 * that logic so the two handlers can share the same access check.
 */
async function loadKeyOwnership(
  keyId: string,
): Promise<{ orgId: string | null } | null> {
  const { data: keyRow } = await supabaseAdmin
    .from('api_keys')
    .select('project_id, organization_id, scope')
    .eq('id', keyId)
    .single()
  if (!keyRow) return null

  if (keyRow.organization_id) {
    return { orgId: keyRow.organization_id as string }
  }
  if (keyRow.project_id) {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('organization_id')
      .eq('id', keyRow.project_id)
      .single()
    return { orgId: (project?.organization_id as string) ?? null }
  }
  return { orgId: null }
}

// PATCH /api/v1/api-keys/:id — toggle is_active
apiKeysRouter.patch('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { is_active?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body.is_active !== 'boolean') {
    return c.json({ error: 'is_active (boolean) is required' }, 400)
  }

  const ownership = await loadKeyOwnership(keyId)
  if (!ownership) return c.json({ error: 'API key not found' }, 404)
  if (ownership.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)

  const { error } = await supabaseAdmin
    .from('api_keys')
    .update({ is_active: body.is_active })
    .eq('id', keyId)
  if (error) return c.json({ error: 'Failed to update API key' }, 500)

  void recordAuditEvent(c, {
    action: body.is_active ? 'api_key.enable' : 'api_key.disable',
    resourceType: 'api_keys',
    resourceId: keyId,
    metadata: { is_active: body.is_active },
  })

  return c.json({ success: true })
})

// DELETE /api/v1/api-keys/:id — soft delete via pending_deletions queue.
//
// The key is immediately deactivated (is_active=false) so proxy traffic
// stops within the next authApiKey check, but the row stays around for
// ~72 hours so an accidental deletion can be undone from
// /settings/pending-deletions. Cron in apps/server/api/cron.ts walks the
// queue and hard-deletes due rows.
apiKeysRouter.delete('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const ownership = await loadKeyOwnership(keyId)
  if (!ownership) return c.json({ error: 'API key not found' }, 404)
  if (ownership.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)

  // Snapshot the row before deactivation so the audit log and any restore
  // attempt have the full original state to work with.
  const { data: snapshot } = await supabaseAdmin
    .from('api_keys')
    .select('*')
    .eq('id', keyId)
    .maybeSingle()
  if (!snapshot) return c.json({ error: 'API key not found' }, 404)

  const enqueued = await enqueueDeletion({
    organizationId: orgId,
    resourceType: 'api_key',
    resourceId: keyId,
    resourceSnapshot: snapshot as Record<string, unknown>,
    requestedBy: userId ?? null,
  })

  if (!enqueued.ok) {
    if (enqueued.code === 'ALREADY_PENDING') {
      return c.json({ error: 'Already queued for deletion' }, 409)
    }
    return c.json({ error: enqueued.error ?? 'Failed to queue deletion' }, 500)
  }

  void recordAuditEvent(c, {
    action: 'api_key.delete',
    resourceType: 'api_keys',
    resourceId: keyId,
    metadata: {
      name: (snapshot as { name?: string }).name,
      scope: (snapshot as { scope?: string }).scope,
      pending_deletion_id: enqueued.pendingId,
      scheduled_for: enqueued.scheduledFor,
    },
  })

  return c.json({
    success: true,
    pendingDeletionId: enqueued.pendingId,
    scheduledFor: enqueued.scheduledFor,
  })
})
