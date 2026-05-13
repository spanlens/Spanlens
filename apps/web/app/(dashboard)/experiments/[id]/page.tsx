import { ExperimentDetailClient } from './experiment-detail-client'

export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ExperimentDetailClient experimentId={id} />
}
