import type { Metadata } from 'next'

// The invite page is a 'use client' component, so its robots metadata lives
// here. The route must stay public (pre-signup invite preview) and is not in
// robots.txt's disallow list or the sitemap, but without noindex it inherited
// indexability from the root layout — a content-free utility URL that could
// enter the index via forwarded invite emails (2026-07-06 SEO audit).
// `follow: true` keeps any rendered links crawlable.
export const metadata: Metadata = {
  title: 'Invitation · Spanlens',
  robots: { index: false, follow: true },
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children
}
