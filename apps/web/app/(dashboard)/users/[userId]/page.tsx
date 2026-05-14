import { Suspense } from 'react'
import { UserDetailClient } from './user-detail-client'

export const metadata = {
  title: 'User · Spanlens',
}

export default async function UserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const decoded = decodeURIComponent(userId)
  return (
    <Suspense>
      <UserDetailClient userId={decoded} />
    </Suspense>
  )
}
