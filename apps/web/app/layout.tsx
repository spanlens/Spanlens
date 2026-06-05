import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import { QueryProvider } from '@/components/providers/query-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'

const SITE_URL = 'https://www.spanlens.io'
const SITE_DESCRIPTION =
  'Drop-in LLM observability for OpenAI, Anthropic, and Gemini. Request logging, cost tracking, and agent tracing in two lines of code. Open source, self-hostable.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Spanlens · LLM Observability', template: '%s | Spanlens' },
  description: SITE_DESCRIPTION,
  applicationName: 'Spanlens',
  keywords: [
    'LLM observability',
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
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'Spanlens',
    title: 'Spanlens · LLM Observability',
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
    title: 'Spanlens · LLM Observability',
    description: SITE_DESCRIPTION,
    images: ['/icon.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
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

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Spanlens',
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  description: SITE_DESCRIPTION,
  email: 'hi@spanlens.io',
  sameAs: ['https://github.com/spanlens'],
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
