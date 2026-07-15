import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'

export const metadata = {
  alternates: { canonical: '/accessibility' },
  title: 'Accessibility Statement · Spanlens',
  description:
    'Spanlens accessibility statement: our WCAG 2.1 Level AA conformance target, the measures we take, known limitations, and how to report an accessibility barrier.',
}

const EFFECTIVE_DATE = '2026-07-14'

export default function AccessibilityPage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <MarketingNav />
      <BreadcrumbJsonLd trail={[{ name: 'Accessibility', path: '/accessibility' }]} />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 prose prose-stone
        prose-headings:scroll-mt-20
        prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80">
        <h1>Accessibility Statement</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Effective date:</strong> {EFFECTIVE_DATE}
        </p>

        <p>
          Spanlens, operated by <strong>Oceancode</strong>, is committed to making its
          website, documentation, and dashboard usable by as many people as possible,
          including people who rely on assistive technologies. This statement describes
          the accessibility standard we work toward, the steps we have taken, the
          limitations we are aware of, and how to reach us if you encounter a barrier.
        </p>

        <h2 id="target">Conformance target</h2>
        <p>
          We aim to meet the{' '}
          <a
            href="https://www.w3.org/TR/WCAG21/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Web Content Accessibility Guidelines (WCAG) 2.1
          </a>{' '}
          at <strong>Level AA</strong>. WCAG defines requirements for making digital
          content more accessible to people with a wide range of disabilities, including
          visual, motor, auditory, and cognitive differences.
        </p>

        <h2 id="status">Conformance status</h2>
        <p>
          Spanlens is <strong>partially conformant</strong> with WCAG 2.1 Level AA.
          Partially conformant means that most of the content meets the standard, but some
          parts do not yet fully conform. We assess conformance through our own internal
          testing. We have <strong>not yet completed an independent third-party audit</strong>,
          and we will update this statement when we do.
        </p>

        <h2 id="measures">Measures we take</h2>
        <p>Accessibility is part of how we build and review the product. Current measures include:</p>
        <ul>
          <li>
            <strong>Semantic structure.</strong> Pages use landmark regions, ordered
            headings, and native HTML controls so that screen readers can convey structure.
          </li>
          <li>
            <strong>Keyboard operability.</strong> Interactive controls are reachable and
            operable with a keyboard, and visible focus indicators show the current position.
          </li>
          <li>
            <strong>Color and contrast.</strong> Text and essential UI aim to meet the
            WCAG AA contrast ratios in both light and dark themes, and we do not rely on
            color alone to convey meaning.
          </li>
          <li>
            <strong>Reduced motion.</strong> Non-essential animation respects the operating
            system <code>prefers-reduced-motion</code> setting.
          </li>
          <li>
            <strong>Responsive, zoomable layouts.</strong> Content reflows for small
            viewports and remains usable at increased browser zoom.
          </li>
          <li>
            <strong>Text alternatives.</strong> Meaningful images carry text alternatives,
            and decorative images are hidden from assistive technologies.
          </li>
        </ul>

        <h2 id="limitations">Known limitations</h2>
        <p>
          We want to be honest about where we fall short. We are actively working on the
          following areas:
        </p>
        <ul>
          <li>
            <strong>Data visualizations.</strong> Some charts and waterfall trace views
            convey information primarily through visuals. We provide underlying data in
            tables where possible, but screen-reader parity for every chart is still in
            progress.
          </li>
          <li>
            <strong>Interactive demo pages.</strong> The live product demos are optimized
            for a visual walkthrough and may not yet meet the same conformance level as the
            rest of the site.
          </li>
          <li>
            <strong>Third-party embedded content.</strong> Content served by third parties
            (for example, payment checkout and status pages) is governed by those providers
            and may not fully match our target.
          </li>
        </ul>

        <h2 id="compatibility">Compatibility</h2>
        <p>
          Spanlens is designed to work with recent versions of major browsers (Chrome,
          Firefox, Safari, and Edge) on desktop and mobile, together with the assistive
          technologies commonly used on those platforms. Because we cannot test every
          combination of browser, operating system, and assistive technology, some
          differences in experience are possible.
        </p>

        <h2 id="self-hosting">Self-hosted deployments</h2>
        <p>
          Spanlens is open source and can be self-hosted. This statement describes the
          hosted service at spanlens.io. Self-hosted deployments may modify the interface,
          so their accessibility is the responsibility of the operator running them. See
          our <Link href="/self-hosting">self-hosting</Link> page for details.
        </p>

        <h2 id="feedback">Feedback and contact</h2>
        <p>
          We welcome reports of accessibility barriers. If you encounter a problem, or need
          content in a different format, please contact us and include the page address and
          a short description of the issue:
        </p>
        <ul>
          <li>
            Email:{' '}
            <a href="mailto:support@spanlens.io">support@spanlens.io</a>
          </li>
        </ul>
        <p>
          We aim to acknowledge accessibility reports within five business days and will
          work with you on a resolution or a reasonable alternative.
        </p>

        <h2 id="roadmap">Ongoing work</h2>
        <p>
          We treat accessibility as continuous rather than a one-time project. Planned steps
          include broader automated and manual testing across pages, improved
          screen-reader support for data visualizations, and an independent third-party
          audit. We will revise the effective date above when this statement is updated.
        </p>
      </main>

      <Footer />
    </div>
  )
}
