import { DatasetDetailClient } from './dataset-detail-client'

export default async function DatasetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DatasetDetailClient datasetId={id} />
}
