'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DashboardCTALink } from '@/components/layout/dashboard-cta-link'
import { useCurrentUser } from '@/lib/queries/use-current-user'

interface AuthNavButtonsProps {
  /** Label for the signup CTA when logged out. Defaults to "Start free". */
  signupLabel?: string
}

/**
 * Whether a browser Supabase client can be constructed at all.
 *
 * Both vars are NEXT_PUBLIC_*, so Next.js inlines their values at build time —
 * this is a plain module-level constant in the client bundle, evaluated
 * identically during the server render and during every client render. That is
 * what makes branching on it hydration-safe (unlike a runtime `typeof window`
 * check, which by definition differs between the two passes).
 */
const HAS_SUPABASE_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

/**
 * Width reserved for the button group so the nav does not jump when the
 * signed-in variant replaces the signed-out one after hydration.
 *
 * Measured against the widest variant at each breakpoint (Geist Sans, `size="sm"`
 * buttons = text-xs + px-3, gap-2 between them):
 *   - below sm ("Live demo" is hidden): signed out [Sign in][Start free →] ≈ 162px,
 *     signed in [Go to dashboard →] ≈ 138px  →  reserve 168px
 *   - sm and up: signed out [Live demo][Sign in][Start free →] ≈ 254px,
 *     signed in [Live demo][Go to dashboard →] ≈ 229px  →  reserve 264px
 * Both values sit a few px above the widest variant so small font-metric
 * differences (fallback font before Geist loads) still cannot make the group
 * outgrow its reservation and shift the nav. `justify-end` keeps the buttons
 * pinned to the right edge, so the slack shows up as whitespace on their left
 * rather than as a visible offset.
 */
const BUTTON_GROUP_CLASS = 'flex items-center justify-end gap-2 min-w-[168px] sm:min-w-[264px]'

/** Signed-out CTAs: browse the demo, sign in, or sign up. */
function SignedOutButtons({ signupLabel }: { signupLabel: string }) {
  return (
    <>
      <Link href="/demo/dashboard" className="hidden sm:inline-flex">
        <Button variant="outline" size="sm">
          Live demo
        </Button>
      </Link>
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

/**
 * Reads the session client-side and swaps the CTAs once a real user is known.
 *
 * `useCurrentUser()` is a TanStack Query hook, so `data` is `undefined` on the
 * server render AND on the first client render (the QueryClient starts with an
 * empty cache — there is no persister and no HydrationBoundary for this key).
 * Rendering the signed-out variant for both `undefined` (still loading) and
 * `null` (resolved: nobody logged in) therefore guarantees the first client
 * render produces byte-identical markup to the server render, which is the
 * whole hydration contract. The signed-in variant only ever appears in a later
 * render, once the query has resolved to an actual user — a normal React
 * update, not a hydration diff. See gotcha #22 in CLAUDE.md for the class of
 * bug this avoids.
 *
 * PostHogIdentify already mounts `useCurrentUser()` on every page, so this
 * shares that cache entry rather than issuing a second `auth.getUser()` call.
 */
function SessionAwareNavButtons({ signupLabel }: { signupLabel: string }) {
  const { data: user } = useCurrentUser()

  if (!user) {
    return (
      <div className={BUTTON_GROUP_CLASS}>
        <SignedOutButtons signupLabel={signupLabel} />
      </div>
    )
  }

  return (
    <div className={BUTTON_GROUP_CLASS}>
      <Link href="/demo/dashboard" className="hidden sm:inline-flex">
        <Button variant="outline" size="sm">
          Live demo
        </Button>
      </Link>
      <DashboardCTALink>
        <Button size="sm" className="gap-1.5">
          Go to dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </DashboardCTALink>
    </div>
  )
}

/**
 * Auth-aware navigation buttons for marketing pages.
 *
 * - Logged out: [Live demo] [Sign in] [Start free]
 * - Logged in:  [Live demo] [Go to dashboard →]
 *
 * This is a CLIENT component on purpose. It used to be an async server
 * component that read the Supabase session from `cookies()`, which opted every
 * page rendering `MarketingNav` — the whole marketing site plus all of /docs,
 * ~90 routes — out of static prerendering and made Vercel serve them with
 * `Cache-Control: private, no-cache, no-store`. Nav chrome is not worth that:
 * moving the session read to the client lets the pages be prerendered and
 * CDN-cached again, and the buttons resolve a beat later on the client.
 */
export function AuthNavButtons({ signupLabel = 'Start free' }: AuthNavButtonsProps) {
  // No Supabase configured (self-host build, local dev without env): there is no
  // session to read, so render the plain signed-out CTAs and never mount the
  // query hook — a `createClient()` with undefined credentials would just throw
  // inside the queryFn and retry on a backoff for nothing. Branching before the
  // hook rather than around it also keeps the rules-of-hooks invariant intact:
  // `SessionAwareNavButtons` is either always mounted or never mounted, because
  // HAS_SUPABASE_ENV is fixed at build time.
  if (!HAS_SUPABASE_ENV) {
    return (
      <div className={BUTTON_GROUP_CLASS}>
        <Link href="/login">
          <Button variant="outline" size="sm">Sign in</Button>
        </Link>
        <Link href="/signup">
          <Button size="sm">{signupLabel}</Button>
        </Link>
      </div>
    )
  }

  return <SessionAwareNavButtons signupLabel={signupLabel} />
}
