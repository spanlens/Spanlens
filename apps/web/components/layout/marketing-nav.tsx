import Image from 'next/image'
import Link from 'next/link'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'

interface MarketingNavProps {
  /** Label for the signup CTA. Defaults to "Start free →" */
  signupLabel?: string
  /** Optional subtitle shown after the logo, e.g. "Docs". Hidden on mobile. */
  subtitle?: string
}

/**
 * Shared top navigation for all marketing pages (home, pricing, docs, terms, privacy).
 *
 * Links: Product (/#product) · Docs · Pricing · GitHub
 * Mobile: links hidden (sm:flex), only logo + auth buttons visible.
 */
export function MarketingNav({ signupLabel = 'Start free →', subtitle }: MarketingNavProps) {
  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur-sm">
      <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 sm:px-6 lg:px-10 h-[56px]">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" priority />
          <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
          {subtitle && (
            <span className="text-[13px] text-text-faint hidden sm:inline">/ {subtitle}</span>
          )}
        </Link>

        {/* Links — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-5 lg:gap-7 font-mono text-[13px] text-text-muted tracking-[0.015em]">
          <Link href="/#product" className="hover:text-text transition-colors">Product</Link>
          <Link href="/docs" className="hover:text-text transition-colors">Docs</Link>
          <Link href="/pricing" className="hover:text-text transition-colors">Pricing</Link>
          <a
            href="https://github.com/sunes26/Spanlens"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text transition-colors"
          >
            GitHub
          </a>
        </div>

        {/* Auth buttons */}
        <div className="flex items-center gap-2">
          <AuthNavButtons signupLabel={signupLabel} />
        </div>
      </div>
    </nav>
  )
}
