import { createClient } from '@supabase/supabase-js'
import type { TestProject } from 'vitest/node'
import { LOCAL_SERVICE_ROLE_KEY, LOCAL_SUPABASE_URL } from './local-stack.js'

// Extend Vitest's ProvidedContext so inject() is fully typed in test files.
declare module 'vitest' {
  export interface ProvidedContext {
    fixtures: {
      orgId: string
      projectId: string
      apiKeyId: string
      userId: string
    }
  }
}

let userId = ''

function adminClient() {
  return createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function setup(testProject: TestProject) {
  const admin = adminClient()

  // 1. Auth user — needed for organizations.owner_id FK
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: `integration-${Date.now()}@test.local`,
    password: 'IntegrationTest123!',
    email_confirm: true,
  })
  if (authErr || !authData.user) {
    throw new Error(`setup: createUser failed — ${authErr?.message ?? 'no user returned'}`)
  }
  userId = authData.user.id

  // 2. Organization
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({ name: 'Integration Test Org', owner_id: userId, plan: 'free' })
    .select('id')
    .single()
  if (orgErr || !org) throw new Error(`setup: create org failed — ${orgErr?.message}`)

  // 3. Project
  const { data: project, error: projErr } = await admin
    .from('projects')
    .insert({ organization_id: org.id, name: 'Integration Test Project' })
    .select('id')
    .single()
  if (projErr || !project) throw new Error(`setup: create project failed — ${projErr?.message}`)

  // 4. API key
  const { data: apiKey, error: keyErr } = await admin
    .from('api_keys')
    .insert({
      project_id: project.id,
      name: 'Integration Test Key',
      key_hash: `integration-hash-${Date.now()}`,
      key_prefix: 'sk-intgr',
    })
    .select('id')
    .single()
  if (keyErr || !apiKey) throw new Error(`setup: create api_key failed — ${keyErr?.message}`)

  testProject.provide('fixtures', {
    orgId: org.id,
    projectId: project.id,
    apiKeyId: apiKey.id,
    userId,
  })
}

export async function teardown() {
  if (!userId) return
  // Deleting the user cascades: user → org → project → api_keys → requests
  // anomaly_events / anomaly_acks also cascade from org.
  await adminClient().auth.admin.deleteUser(userId)
}
