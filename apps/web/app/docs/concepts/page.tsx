import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'
import { DocsSectionIndex } from '@/app/docs/_components/section-index'
import { getDocsSection } from '@/app/docs/_lib/sections'

const SECTION = getDocsSection('concepts')

export const metadata = {
  alternates: { canonical: '/docs/concepts' },
  title: 'Concepts · Spanlens Docs',
  description: SECTION.description,
}

export default function ConceptsIndex() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <DocsSectionIndex section={SECTION} />
    </div>
  )
}
