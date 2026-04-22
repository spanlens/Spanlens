import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

interface AuthNavButtonsProps {
  /** Label for the signup CTA when logged out. Defaults to "Start free". */
  signupLabel?: string
}

/**
 * Server component that renders auth-aware navigation buttons for marketing pages.
 *
 * - Logged out: [Sign in] [Start free]
 * - Logged in:  [Go to dashboard →]
 *
 * Reads the Supabase session server-side on every render — these pages become
 * dynamic rather than statically generated, which is fine for nav chrome.
 * The check is a single cookie read + decode; no DB roundtrip.
 */
export async function AuthNavButtons({ signupLabel = 'Start free' }: AuthNavButtonsProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    return (
      <Link href="/dashboard">
        <Button size="sm" className="gap-1.5">
          Go to dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </Link>
    )
  }

  return (
    <>
      <Link href="/login">
        <Button variant="outline" size="sm">
          Sign in
        </Button>
      </Link>
      <Link href="/signup">
        <Button size="sm">{signupLabel}</Button>
      </Link>
    </>
  )
}
