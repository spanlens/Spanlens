import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { apiGetServer } from '@/lib/server/api'
import { organizationSpec, membersSpec, invitationsSpec } from '@/lib/server/queries/organization'
import { subscriptionSpec, quotaSpec } from '@/lib/server/queries/billing'
import { auditLogsSpec } from '@/lib/server/queries/audit-logs'
import { webhooksSpec } from '@/lib/server/queries/webhooks'
import { channelsSpec } from '@/lib/server/queries/alerts'
import type { ApiEnvelope, Organization } from '@/lib/queries/types'
import { SettingsClient } from './settings-client'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Streamed-in queries — populate the cache after critical content has rendered.
// Used by tabs further down the page (audit log, integrations, team).
async function DeferredHydration({ orgId }: { orgId: string | undefined }) {
  const specs: QuerySpec[] = [
    auditLogsSpec({ limit: 100 }),
    webhooksSpec(),
    channelsSpec(),
  ]
  if (orgId) {
    specs.push(membersSpec(orgId))
    specs.push(invitationsSpec(orgId))
  }
  const state = await prefetchAll(specs)
  return <HydrationBoundary state={state} />
}

export default async function SettingsPage() {
  // Fetch org first to get orgId — needed to build members/invitations query keys.
  // org is also included in the critical prefetch so it lands in the dehydrated cache.
  const orgRes = await apiGetServer<ApiEnvelope<Organization>>('/api/v1/organizations/me')
  const orgId = orgRes.data?.id

  // Above-the-fold critical path: org info + plan summary on the default tab.
  const state = await prefetchAll([
    organizationSpec(),
    subscriptionSpec(),
    quotaSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      {/* Suspense required because SettingsClient uses useSearchParams() */}
      <Suspense>
        <SettingsClient />
      </Suspense>
      <Suspense fallback={null}>
        <DeferredHydration orgId={orgId} />
      </Suspense>
    </HydrationBoundary>
  )
}
