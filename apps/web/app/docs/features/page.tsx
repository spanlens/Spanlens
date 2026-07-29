import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'
import { DocsSectionIndex } from '@/app/docs/_components/section-index'
import { getDocsSection } from '@/app/docs/_lib/sections'

const SECTION = getDocsSection('features')

export const metadata = {
  alternates: { canonical: '/docs/features' },
  title: 'Features · Spanlens Docs',
  description: SECTION.description,
}

export default function FeaturesIndex() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <DocsSectionIndex section={SECTION} />
    </div>
  )
}
