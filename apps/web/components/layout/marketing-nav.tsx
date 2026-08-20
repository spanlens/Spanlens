import Link from 'next/link'
import { LogoMark } from '@/components/ui/logo'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'

interface MarketingNavProps {
  /** Label for the signup CTA. Defaults to "Start free →" */
  signupLabel?: string
  /** Optional subtitle shown after the logo, e.g. "Docs". Hidden on mobile. */
  subtitle?: string
}

const LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: '/#product', label: 'Platform' },
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/changelog', label: 'Changelog' },
  { href: 'https://blog.spanlens.io', label: 'Blog', external: true },
  { href: 'https://github.com/spanlens/Spanlens', label: 'GitHub', external: true },
]

/**
 * Shared top navigation for all marketing pages (home, pricing, docs, terms, privacy).
 *
 * The bar is a floating capsule rather than a full-width rule, so the hero
 * artwork runs behind and beside it. The sticky wrapper is transparent and
 * click-through; only the capsule itself takes pointer events.
 *
 * Mobile: links hidden (md:flex), only logo + auth buttons visible.
 */
export function MarketingNav({ signupLabel = 'Start free →', subtitle }: MarketingNavProps) {
  return (
    <div className="pointer-events-none sticky top-0 z-50 px-4 py-3 sm:px-6 lg:px-10 lg:py-[30px]">
      <nav className="pointer-events-auto mx-auto flex max-w-[1200px] items-center justify-between gap-4 rounded-full border border-border bg-bg/85 py-2 pl-5 pr-2 backdrop-blur-md lg:w-fit">
        {/* Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <LogoMark size={22} className="rounded-chip" />
          <span className="font-display track-h3 text-[16px] leading-none text-text">Spanlens</span>
          {subtitle && (
            <span className="hidden text-[13px] text-text-faint sm:inline">/ {subtitle}</span>
          )}
        </Link>

        {/* Links appear only once the capsule goes `w-fit` at lg. Showing them
            from md pushed the logo, six links and the auth cluster past a 768px
            viewport, which scrolled the whole page sideways. */}
        <div className="hidden items-center gap-6 pl-6 text-[13.5px] font-medium text-text lg:flex lg:gap-[26px]">
          {LINKS.map((l) =>
            l.external ? (
              <a
                key={l.label}
                href={l.href}
                {...(l.href.startsWith('https://github.com')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
                className="transition-colors hover:text-text-muted"
              >
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className="transition-colors hover:text-text-muted">
                {l.label}
              </Link>
            ),
          )}
        </div>

        {/* Auth buttons */}
        <div className="flex shrink-0 items-center gap-2">
          <AuthNavButtons signupLabel={signupLabel} />
        </div>
      </nav>
    </div>
  )
}
