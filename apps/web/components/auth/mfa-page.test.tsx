// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * /auth/mfa (app/auth/mfa/page.tsx) and the Profile settings copy. Tests live
 * under components/ because vitest only collects lib/ and components/.
 *
 * The MFA page offered two controls that did nothing: "Remember this device
 * for 30 days" set a state value no code read, and "Use a recovery code"
 * linked back to /login with no recovery flow behind it (the pitch also
 * promised recovery codes). The Profile tab claimed two-factor setup runs
 * through Supabase's auth flows, but the app has no enrollment path. The
 * user's decision was to remove what does not work rather than build it.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ factor_id: 'f-1', challenge_id: 'c-1' }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { mfa: { verify: vi.fn() } } }),
}))
vi.mock('@/lib/queries/use-current-user', () => ({
  useCurrentUser: () => ({
    data: { id: 'user-1', email: 'dev@example.com', created_at: '2026-01-01T00:00:00.000Z' },
    isLoading: false,
  }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

const { default: MfaPage } = await import('@/app/auth/mfa/page')
const { ProfileTab } = await import('@/app/(dashboard)/settings/_sections/profile-tab')

describe('MFA challenge page', () => {
  test('still verifies a six-digit code', () => {
    render(<MfaPage />)
    expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Verify and continue' })).toBeInTheDocument()
  })

  test('has no "remember this device" control, since nothing honours it', () => {
    render(<MfaPage />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/remember this device/i)).not.toBeInTheDocument()
  })

  test('does not offer recovery codes, since there is no recovery flow', () => {
    render(<MfaPage />)
    expect(screen.queryByText(/recovery code/i)).not.toBeInTheDocument()
  })
})

describe('Profile settings copy', () => {
  test('does not claim two-factor setup is available', () => {
    render(<ProfileTab />)
    expect(screen.queryByText(/two-factor setup go through/i)).not.toBeInTheDocument()
    expect(screen.getByText(/two-factor authentication (is|are) not available/i)).toBeInTheDocument()
  })
})
