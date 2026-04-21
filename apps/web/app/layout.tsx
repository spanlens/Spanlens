import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { QueryProvider } from '@/components/providers/query-provider'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: { default: 'Spanlens', template: '%s | Spanlens' },
  description:
    'LLM observability platform. Drop-in proxy for request logging, cost tracking, and agent tracing.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
