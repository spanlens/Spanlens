import { Suspense } from 'react'
import { UsersClient } from './users-client'

export const metadata = {
  title: 'Users · Spanlens',
  description: 'Per-end-user usage, cost, and behaviour — derived from x-spanlens-user tagged requests.',
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersClient />
    </Suspense>
  )
}
