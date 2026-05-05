import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Spanlens onboarding test',
  description: 'Dummy app for verifying the new-customer flow.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
