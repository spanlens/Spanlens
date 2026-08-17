'use client'
import { Section, FormRow, GhostBtn } from '@/components/ui/primitives'
import { NativeInput, TabHeader, PILL_SECONDARY } from '../_shared/ui'

// ─── DESTINATIONS tab ─────────────────────────────────────────────────────────

export function DestinationsTab() {
  const destinations = [
    {
      id: 'bigquery',
      name: 'BigQuery',
      description: 'Export requests and traces to a Google BigQuery dataset for custom analytics.',
      placeholder: 'project-id.dataset_id',
      label: 'Dataset ID',
    },
    {
      id: 's3',
      name: 'Amazon S3',
      description: 'Archive raw request logs to an S3 bucket for long-term retention.',
      placeholder: 's3://my-bucket/spanlens-exports/',
      label: 'Bucket URL',
    },
    {
      id: 'snowflake',
      name: 'Snowflake',
      description: 'Sync data to a Snowflake table for your data warehouse pipelines.',
      placeholder: 'account.region.snowflakecomputing.com',
      label: 'Account URL',
    },
  ]

  return (
    <div>
      <TabHeader
        title="Destinations"
        description="Export data to external data warehouses and storage systems."
      />

      <div className="space-y-4">
        {destinations.map((dest) => (
          <Section key={dest.id} title={dest.name} description={dest.description} className="mb-0">
            <div className="px-6 pb-5 space-y-4">
              <FormRow label={dest.label}>
                <div className="flex items-center gap-3 w-full max-w-[460px]">
                  <NativeInput
                    placeholder={dest.placeholder}
                    className="flex-1 font-mono text-[12px]"
                  />
                  <GhostBtn className={PILL_SECONDARY}>Save configuration</GhostBtn>
                </div>
              </FormRow>
            </div>
          </Section>
        ))}
      </div>
    </div>
  )
}
