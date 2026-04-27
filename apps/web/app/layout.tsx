import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { QueryProvider } from '@/components/providers/query-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { CommandPaletteProvider } from '@/components/command-palette'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'swap',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
})

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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryProvider>
          <ThemeProvider>
            <CommandPaletteProvider>
              {children}
            </CommandPaletteProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
