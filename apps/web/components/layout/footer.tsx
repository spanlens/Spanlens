import Link from 'next/link'
import { LogoMark } from '@/components/ui/logo'

/**
 * Shared marketing footer. Applied to landing, /pricing, /docs/*, /terms,
 * /privacy, /dpa, /subprocessors, /refund.
 *
 * The bottom row carries the e-commerce commercial-info disclosure
 * required by the Korean Act on the Consumer Protection in Electronic
 * Commerce: legal entity name, CEO, business registration number,
 * and mail-order business registration number. The values are the
 * legally registered ones; only the labels are translated to English
 * for our customer-facing English-only surface.
 * Do not remove these fields without a replacement compliance path.
 */

interface FooterLink {
  label: string
  href: string
  external?: boolean
}

/*
 * Every column here also does internal-linking work. The Guides and
 * Integrations groups exist because those pages were sitemap-only orphans in
 * the 2026-07 SEO audits, and the Compare group is the main internal path into
 * the comparison set. Links may be regrouped, but dropping one costs that page
 * its inbound equity.
 */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Quick start', href: '/docs/quick-start' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Benchmarks', href: '/benchmarks' },
      { label: 'Blog', href: 'https://blog.spanlens.io', external: true },
      { label: 'Status', href: 'https://status.spanlens.io', external: true },
    ],
  },
  {
    title: 'Compare',
    links: [
      { label: 'Langfuse', href: '/compare/langfuse' },
      { label: 'Helicone', href: '/compare/helicone' },
      { label: 'LangSmith', href: '/compare/langsmith' },
      { label: 'Braintrust', href: '/compare/braintrust' },
      { label: 'Arize Phoenix', href: '/compare/arize-phoenix' },
      { label: 'Comet Opik', href: '/compare/opik' },
      { label: 'LiteLLM', href: '/compare/litellm' },
      { label: 'Portkey', href: '/compare/portkey' },
      { label: 'All tools', href: '/best-llm-observability-tools' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { label: 'LLM Observability', href: '/llm-observability' },
      { label: 'Agent Tracing', href: '/agent-tracing' },
      { label: 'LLM Cost Tracking', href: '/llm-cost-tracking' },
      { label: 'Alternatives', href: '/alternatives' },
      { label: 'Cost Calculator', href: '/tools/llm-cost-calculator' },
    ],
  },
  {
    title: 'Integrations',
    links: [
      { label: 'OpenAI', href: '/integrations/openai' },
      { label: 'Anthropic', href: '/integrations/anthropic' },
      { label: 'Gemini', href: '/integrations/gemini' },
    ],
  },
  {
    title: 'Open Source',
    links: [
      { label: 'GitHub', href: 'https://github.com/spanlens/Spanlens', external: true },
      { label: 'Self-hosting', href: '/self-hosting' },
      { label: 'Self-host guide', href: '/docs/self-host' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'DPA', href: '/dpa' },
      { label: 'Subprocessors', href: '/subprocessors' },
      { label: 'Refund policy', href: '/refund' },
      { label: 'Accessibility', href: '/accessibility' },
      { label: 'Contact', href: 'mailto:support@spanlens.io', external: true },
    ],
  },
]

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className = 'text-[13.5px] leading-[1.4] text-text-muted transition-colors hover:text-text'
  if (link.external) {
    const isHttp = link.href.startsWith('https://')
    return (
      <a
        href={link.href}
        {...(isHttp ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={className}
      >
        {link.label}
      </a>
    )
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  )
}

export function Footer() {
  return (
    <footer className="px-4 pb-11 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-col gap-10 border-t border-border pb-10 pt-12 lg:flex-row lg:justify-between">
          {/* Brand */}
          <div className="lg:w-[207px] lg:shrink-0">
            <Link
              href="/"
              className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
            >
              <LogoMark size={22} className="rounded-chip" />
              <span className="font-display track-h3 text-[16px] leading-none text-text">
                Spanlens
              </span>
            </Link>
            <p className="mt-3.5 text-[13.5px] leading-[1.62] text-text-muted">
              Observability for people who ship LLM features, not dashboards.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-9 sm:grid-cols-3 lg:flex lg:gap-x-12">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="text-[12.5px] font-semibold leading-[1.4] text-text">
                  {col.title}
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <FooterLinkItem key={link.label} link={link} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Legal */}
        <div className="flex flex-col gap-4 border-t border-border pb-2 pt-5 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-[12.5px] leading-[1.4] text-text-faint">
            © {new Date().getFullYear()} Spanlens. MIT licensed.
          </p>
          {/* Korean e-commerce commercial-info disclosure — labels in
              English to match the customer-facing English surface; the
              numbers are the legally registered values. */}
          <div className="space-y-0.5 font-mono text-[10.5px] leading-relaxed text-text-faint sm:text-right">
            <div>Oceancode · CEO: Haeseong Jeon</div>
            <div>Business Reg. No.: 676-71-00622 · Mail-Order Reg.: 2025-Gyeonggi-Gwangju-2133</div>
            <div>support@spanlens.io</div>
          </div>
        </div>
      </div>
    </footer>
  )
}
