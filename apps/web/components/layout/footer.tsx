import Link from 'next/link'

/**
 * Shared marketing footer. Applied to landing, /pricing, /docs/*, /terms, /privacy.
 *
 * The bottom row contains the Korean e-commerce commercial-info disclosure
 * required by 전자상거래법 — 상호, 대표자, 사업자번호, 통신판매업신고번호.
 * Do not remove these fields without a replacement compliance path.
 */
export function Footer() {
  return (
    <footer className="border-t border-border px-10 pt-10 pb-[60px] text-text-muted text-[13px]">
      <div className="max-w-[1200px] mx-auto flex justify-between items-end">
        {/* Left — logo + tagline */}
        <div>
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <svg width="17" height="17" viewBox="0 0 20 20" className="shrink-0">
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="3.5" fill="var(--accent)" />
            </svg>
            <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
          </Link>
          <div className="mt-3 font-mono text-[12px] text-text-faint">
            MIT · self-hostable · © {new Date().getFullYear()} Spanlens
          </div>
          {/* Korean legal disclosure (전자상거래법) */}
          <div className="mt-3 font-mono text-[10.5px] text-text-faint space-y-0.5 max-w-xs leading-relaxed">
            <div>Oceancode (오션코드) · 대표: 전해성</div>
            <div>사업자번호: 676-71-00622 · 통신판매업: 2025-경기광주-2133</div>
            <div>support@spanlens.io</div>
          </div>
        </div>

        {/* Right — 3-col link groups */}
        <div className="flex gap-12 font-mono text-[12px]">
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Product</div>
            <div className="flex flex-col gap-1.5">
              <Link href="/docs" className="hover:text-text transition-colors">Docs</Link>
              <Link href="/pricing" className="hover:text-text transition-colors">Pricing</Link>
              <Link href="/docs/quick-start" className="hover:text-text transition-colors">Quick start</Link>
            </div>
          </div>
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Open Source</div>
            <div className="flex flex-col gap-1.5">
              <a href="https://github.com/sunes26/Spanlens" target="_blank" rel="noopener noreferrer" className="hover:text-text transition-colors">GitHub</a>
              <Link href="/docs/self-host" className="hover:text-text transition-colors">Self-host</Link>
            </div>
          </div>
          <div>
            <div className="text-text-faint mb-2 tracking-[0.05em] uppercase text-[10px]">Company</div>
            <div className="flex flex-col gap-1.5">
              <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-text transition-colors">Terms</Link>
              <a href="mailto:support@spanlens.io" className="hover:text-text transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
