import { SessionDetailClient } from './session-detail-client'

export default async function SessionDetailPage() {
  // Detail view fetches client-side via useSession(); the (dashboard) layout
  // handles the shared prefetch (sidebar, etc).
  return <SessionDetailClient />
}
