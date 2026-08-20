import { openGraphFor } from '@/lib/page-metadata'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'
import { DocsSectionIndex } from '@/app/docs/_components/section-index'
import { getDocsSection } from '@/app/docs/_lib/sections'

const SECTION = getDocsSection('production')

export const metadata = {
  alternates: { canonical: '/docs/production' },
  openGraph: openGraphFor('/docs/production'),
  title: 'Production · Spanlens Docs',
  description: SECTION.description,
}

export default function ProductionIndex() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <DocsSectionIndex section={SECTION} />
    </div>
  )
}
