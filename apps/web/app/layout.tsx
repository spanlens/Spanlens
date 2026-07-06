import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import { QueryProvider } from '@/components/providers/query-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'

const SITE_URL = 'https://www.spanlens.io'
const SITE_DESCRIPTION =
  'Open source LLM observability and monitoring for OpenAI, Anthropic, and Gemini. Request logging, cost tracking, agent tracing. Self-hostable, MIT licensed.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // No title template: every page already self-brands ("Pricing · Spanlens",
  // "Quick start · Spanlens Docs"), so a '%s | Spanlens' template rendered
  // double-branded titles like "Pricing · Spanlens | Spanlens" in SERPs.
  title: 'Spanlens · Open Source LLM Observability & Monitoring',
  description: SITE_DESCRIPTION,
  applicationName: 'Spanlens',
  keywords: [
    'LLM observability',
    'open source LLM observability',
    'LLM monitoring',
    'open source LLM monitoring',
    'self-hosted LLM observability',
    'OpenAI logging',
    'Anthropic logging',
    'AI cost tracking',
    'agent tracing',
    'LLM proxy',
    'OpenTelemetry LLM',
    'Langfuse alternative',
    'Helicone alternative',
    'AI monitoring',
  ],
  authors: [{ name: 'Spanlens' }],
  creator: 'Spanlens',
  publisher: 'Spanlens',
  // NOTE: no `alternates.canonical` here. Next.js metadata is inherited by
  // every child page that doesn't declare its own `alternates`, so a root
  // canonical of '/' silently canonicalises the whole site to the homepage
  // (ScreamingFrog 2026-06-11 audit: 61 pages / 76% de-indexed). Each
  // indexable page must declare its own canonical instead.
  openGraph: {
    type: 'website',
    siteName: 'Spanlens',
    title: 'Spanlens · Open Source LLM Observability & Monitoring',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'en_US',
    images: [
      {
        url: '/icon.png',
        width: 512,
        height: 512,
        alt: 'Spanlens',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spanlens · Open Source LLM Observability & Monitoring',
    description: SITE_DESCRIPTION,
    images: ['/icon.png'],
  },
  // NOTE: no top-level `index`/`follow` here. Explicit `index, follow` is the
  // crawler default (zero SEO value), and on dynamic routes with an async
  // `generateMetadata` (e.g. /share/[token]) Next.js streams the page-level
  // metadata separately from the shell head — so the root's
  // `<meta name="robots" content="index, follow">` and the page's `noindex`
  // both ended up in the same document (2026-07-06 audit: duplicate robots
  // tags on every /share URL, defeating the noindex). Omitting the directive
  // at the root leaves page-level `robots` overrides as the only
  // `name="robots"` tag. googleBot preview prefs carry no index directive,
  // so they can't conflict with a page-level noindex.
  robots: {
    googleBot: {
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
    shortcut: '/favicon.ico',
  },
}

// Canonical Organization entity for the whole site. Every other JSON-LD block
// that needs the org (e.g. /about's AboutPage.mainEntity) must reference it by
// `@id` instead of declaring a second Organization node — two divergent nodes
// (different sameAs / foundingDate) break entity reconciliation in Google and
// LLM crawlers (2026-07-06 schema audit).
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: 'Spanlens',
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  description: SITE_DESCRIPTION,
  email: 'hi@spanlens.io',
  foundingDate: '2026-04',
  founder: {
    '@type': 'Person',
    name: 'Haeseong Jeon',
  },
  sameAs: [
    'https://github.com/spanlens/Spanlens',
    'https://www.npmjs.com/package/@spanlens/sdk',
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on the <html> tag silences hydration mismatch
  // warnings that come from third-party browser extensions injecting their
  // own attributes (e.g. screen-capture tools adding `extension-installed`,
  // dark-reader injecting `data-darkreader-*`). The warning then cascades
  // into the React minified errors #418/#423/#425 — all because of an
  // attribute we don't own. The flag is scoped to direct children of the
  // tagged element only, so it does NOT hide real hydration bugs in the
  // app tree below `<body>`. This is the same pattern Next.js' theme docs
  // recommend.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        {/* Pre-paint theme application — prevents a flash of the wrong theme.
            Emitted from the server <head> (real HTML), NOT from a client
            component, so React 19 doesn't warn about a <script> in the tree.
            Logic mirrors ThemeProvider (localStorage 'theme' → .dark class). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(d?'dark':'light');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <QueryProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  )
}
