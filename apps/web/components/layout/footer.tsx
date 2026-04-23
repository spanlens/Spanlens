import Link from 'next/link'
import { Zap } from 'lucide-react'

/**
 * Shared marketing footer. Applied to landing, /pricing, /docs/*, /signup,
 * /login, /terms, /privacy — every user-facing surface outside the app
 * dashboard (Linear/Stripe pattern: clean app, detailed marketing footer).
 *
 * The bottom row contains the Korean e-commerce commercial-info disclosure
 * required by 전자상거래법 — 상호, 대표자, 사업자번호, 통신판매업신고번호, 주소,
 * 연락처. Do not remove these fields without a replacement compliance path.
 */
export function Footer() {
  return (
    <footer className="border-t bg-gray-50 mt-24">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Top row — links grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-3">
              <Zap className="h-5 w-5 text-blue-600" />
              <span className="font-bold text-lg">Spanlens</span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs">
              LLM observability in 30 seconds. Proxy, trace, bill-aware — for OpenAI,
              Anthropic, and Gemini.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-sm mb-3">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
              <li><Link href="/docs" className="hover:text-foreground">Docs</Link></li>
              <li><Link href="/docs/quick-start" className="hover:text-foreground">Quick start</Link></li>
              <li><Link href="/docs/self-host" className="hover:text-foreground">Self-host</Link></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold text-sm mb-3">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://github.com/sunes26/Spanlens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a href="mailto:support@spanlens.io" className="hover:text-foreground">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-sm mb-3">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/terms" className="hover:text-foreground">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom row — commercial info (전자상거래법 mandatory disclosure) */}
        <div className="border-t pt-6 text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">Oceancode</span> (오션코드) ·
            Sole proprietorship registered in the Republic of Korea
          </p>
          <p>
            Representative (대표자): Jeon Haesung (전해성) ·
            Business Registration No.: 676-71-00622 ·
            E-commerce Registration No. (통신판매업신고): 2025-경기광주-2133
          </p>
          <p>Email: support@spanlens.io</p>
          <p className="pt-2">© {new Date().getFullYear()} Oceancode. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
