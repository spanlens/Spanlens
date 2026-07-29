import { openGraphFor } from '@/lib/page-metadata'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'
import { DocsSectionIndex } from '@/app/docs/_components/section-index'
import { getDocsSection } from '@/app/docs/_lib/sections'

const SECTION = getDocsSection('tutorials')

export const metadata = {
  alternates: { canonical: '/docs/tutorials' },
  openGraph: openGraphFor('/docs/tutorials'),
  title: 'Tutorials · Spanlens Docs',
  description: SECTION.description,
}

export default function TutorialsIndex() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <DocsSectionIndex section={SECTION} />
    </div>
  )
}
