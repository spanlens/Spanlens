import { Suspense } from 'react'
import { SessionsClient } from './sessions-client'

export const metadata = {
  title: 'Sessions · Spanlens',
}

export default function SessionsPage() {
  // List fetches client-side (useSessions). The default window is the last 30
  // days, so a server prefetch key can't match the client's dynamic `from` —
  // we skip prefetch and let the client query drive the first paint.
  return (
    <Suspense>
      <SessionsClient />
    </Suspense>
  )
}
