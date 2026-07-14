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
export function Footer() {
  return (
    <footer className="border-t border-border px-4 sm:px-6 lg:px-10 pt-10 pb-[60px] text-text-muted text-[13px]">
      <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row sm:justify-between sm:items-end gap-8 sm:gap-0">
        {/* Left: logo + tagline */}
        <div>
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <LogoMark size={20} className="rounded-[5px]" />
            <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
          </Link>
          <div className="mt-3 font-mono text-[12px] text-text-faint">
            MIT · self-hostable · © {new Date().getFullYear()} Spanlens
          </div>
          {/* Korean e-commerce commercial-info disclosure — labels in
              English to match the customer-facing English surface; the
              numbers are the legally registered values. */}
          <div className="mt-3 font-mono text-[10.5px] text-text-faint space-y-0.5 max-w-xs leading-relaxed">
            <div>Oceancode · CEO: Haeseong Jeon</div>
            <div>Business Reg. No.: 676-71-00622 · Mail-Order Reg.: 2025-Gyeonggi-Gwangju-2133</div>
            <div>support@spanlens.io</div>
          </div>
        </div>

        {/* Right: 4-col link groups */}
        <div className="flex flex-wrap gap-8 sm:gap-12 font-mono text-[12px]">
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Product</div>
            <div className="flex flex-col gap-1.5">
              <Link href="/docs" className="hover:text-text transition-colors">Docs</Link>
              <Link href="/pricing" className="hover:text-text transition-colors">Pricing</Link>
              <Link href="/docs/quick-start" className="hover:text-text transition-colors">Quick start</Link>
              <Link href="/changelog" className="hover:text-text transition-colors">Changelog</Link>
              <Link href="/benchmarks" className="hover:text-text transition-colors">Benchmarks</Link>
              <a href="https://blog.spanlens.io" className="hover:text-text transition-colors">Blog</a>
              <a href="https://status.spanlens.io" target="_blank" rel="noopener noreferrer" className="hover:text-text transition-colors">Status</a>
            </div>
          </div>
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Compare</div>
            <div className="flex flex-col gap-1.5">
              <Link href="/compare/langfuse" className="hover:text-text transition-colors">Langfuse</Link>
              <Link href="/compare/helicone" className="hover:text-text transition-colors">Helicone</Link>
              <Link href="/compare/langsmith" className="hover:text-text transition-colors">LangSmith</Link>
              <Link href="/compare/braintrust" className="hover:text-text transition-colors">Braintrust</Link>
              <Link href="/compare/arize-phoenix" className="hover:text-text transition-colors">Arize Phoenix</Link>
            </div>
          </div>
          {/* Guides — the keyword landing pages had zero internal inbound
              links (sitemap-only orphans, 2026-07-06 SEO audit). Footer links
              from every marketing/docs page restore internal link equity. */}
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Guides</div>
            <div className="flex flex-col gap-1.5">
              <Link href="/llm-observability" className="hover:text-text transition-colors">LLM Observability</Link>
              <Link href="/agent-tracing" className="hover:text-text transition-colors">Agent Tracing</Link>
              <Link href="/llm-cost-tracking" className="hover:text-text transition-colors">LLM Cost Tracking</Link>
              <Link href="/alternatives" className="hover:text-text transition-colors">Alternatives</Link>
              <Link href="/tools/llm-cost-calculator" className="hover:text-text transition-colors">Cost Calculator</Link>
            </div>
          </div>
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Open Source</div>
            <div className="flex flex-col gap-1.5">
              <a href="https://github.com/spanlens/Spanlens" target="_blank" rel="noopener noreferrer" className="hover:text-text transition-colors">GitHub</a>
              <Link href="/self-hosting" className="hover:text-text transition-colors">Self-hosting</Link>
              <Link href="/docs/self-host" className="hover:text-text transition-colors">Self-host guide</Link>
            </div>
          </div>
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Company</div>
            <div className="flex flex-col gap-1.5">
              <Link href="/about" className="hover:text-text transition-colors">About</Link>
              <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-text transition-colors">Terms</Link>
              <Link href="/dpa" className="hover:text-text transition-colors">DPA</Link>
              <Link href="/subprocessors" className="hover:text-text transition-colors">Subprocessors</Link>
              <Link href="/refund" className="hover:text-text transition-colors">Refund policy</Link>
              <Link href="/accessibility" className="hover:text-text transition-colors">Accessibility</Link>
              <a href="mailto:support@spanlens.io" className="hover:text-text transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
