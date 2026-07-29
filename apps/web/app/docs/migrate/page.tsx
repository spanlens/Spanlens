import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'
import { DocsSectionIndex } from '@/app/docs/_components/section-index'
import { getDocsSection } from '@/app/docs/_lib/sections'

const SECTION = getDocsSection('migrate')

export const metadata = {
  alternates: { canonical: '/docs/migrate' },
  title: 'Migrate to Spanlens · Spanlens Docs',
  description: SECTION.description,
}

export default function MigrateIndex() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <DocsSectionIndex section={SECTION} />
    </div>
  )
}
