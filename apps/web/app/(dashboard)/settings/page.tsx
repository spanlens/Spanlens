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

export default async function SettingsPage() {
  // Fetch org first to get orgId — needed to build members/invitations query keys.
  // org is also included in the prefetchAll batch below so it lands in the
  // dehydrated cache (double server-side fetch is intentional and cheap).
  const orgRes = await apiGetServer<ApiEnvelope<Organization>>('/api/v1/organizations/me')
  const orgId = orgRes.data?.id

  const specs: QuerySpec[] = [
    organizationSpec(),
    subscriptionSpec(),
    quotaSpec(),
    auditLogsSpec({ limit: 100 }),
    webhooksSpec(),
    channelsSpec(),
  ]

  if (orgId) {
    specs.push(membersSpec(orgId))
    specs.push(invitationsSpec(orgId))
  }

  const state = await prefetchAll(specs)

  return (
    <HydrationBoundary state={state}>
      {/* Suspense required because SettingsClient uses useSearchParams() */}
      <Suspense>
        <SettingsClient />
      </Suspense>
    </HydrationBoundary>
  )
}
