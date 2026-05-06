import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { QueryProvider } from '@/components/providers/query-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'

export const metadata: Metadata = {
  title: { default: 'Spanlens', template: '%s | Spanlens' },
  description:
    'LLM observability platform. Drop-in proxy for request logging, cost tracking, and agent tracing.',
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
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <QueryProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
