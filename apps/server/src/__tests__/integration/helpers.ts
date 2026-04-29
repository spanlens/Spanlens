import { supabaseAdmin } from '../../lib/db.js'

export interface InsertRequestsArgs {
  orgId: string
  projectId: string
  apiKeyId: string
  provider?: string
  model?: string
  count: number
  latencyMs: number
  costUsd?: number | null
  statusCode?: number
  /** How many milliseconds before now to set created_at. */
  createdAtMsAgo: number
}

export async function insertRequests(args: InsertRequestsArgs): Promise<void> {
  const createdAt = new Date(Date.now() - args.createdAtMsAgo).toISOString()
  const rows = Array.from({ length: args.count }, () => ({
    organization_id: args.orgId,
    project_id: args.projectId,
    api_key_id: args.apiKeyId,
    provider: args.provider ?? 'openai',
    model: args.model ?? 'gpt-4o-mini',
    latency_ms: args.latencyMs,
    cost_usd: args.costUsd ?? null,
    status_code: args.statusCode ?? 200,
    created_at: createdAt,
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  }))
  const { error } = await supabaseAdmin.from('requests').insert(rows)
  if (error) throw new Error(`insertRequests failed: ${error.message}`)
}

export async function cleanupRequests(orgId: string): Promise<void> {
  await supabaseAdmin.from('requests').delete().eq('organization_id', orgId)
}

export async function cleanupAnomalyEvents(orgId: string): Promise<void> {
  await supabaseAdmin.from('anomaly_events').delete().eq('organization_id', orgId)
}
