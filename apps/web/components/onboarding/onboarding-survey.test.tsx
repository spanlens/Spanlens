// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * /onboarding survey step (app/onboarding/page.tsx). The test lives under
 * components/ because vitest only collects lib/ and components/.
 *
 * The survey's primary button promised "Continue to the snippet" to everyone.
 * Two paths reach the survey without a key the dashboard can show:
 *
 *   - bootstrap answered 409 "Already onboarded" (a partial earlier signup),
 *     so no key came back at all;
 *   - the key came back but sessionStorage refused the write.
 *
 * On both, the welcome banner renders nothing and the user was left looking
 * for a snippet that never appears. Keys are shown once, so the only way
 * forward is issuing a new one under Projects, and the page now says so.
 */

const apiPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({ apiPost }))
vi.mock('@/lib/queries/use-pending-invitations', () => ({
  usePendingInvitations: () => ({ isFetched: true, data: [] }),
  useAcceptPendingInvitation: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/workspace-cookie', () => ({ writeWorkspaceCookie: vi.fn() }))
vi.mock('@/components/track-once', () => ({ TrackOnce: () => null }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

const { default: OnboardingPage } = await import('@/app/onboarding/page')

async function reachSurvey(): Promise<void> {
  const user = userEvent.setup()
  render(<OnboardingPage />)
  await user.type(screen.getByLabelText('Workspace name'), 'Acme')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Tell us about your project')
}

beforeEach(() => {
  sessionStorage.clear()
  apiPost.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('survey call to action', () => {
  test('with a fresh key it promises the snippet', async () => {
    apiPost.mockResolvedValue({ data: { apiKey: 'sl_live_fresh', userId: 'user-1' } })
    await reachSurvey()
    expect(screen.getByRole('button', { name: 'Continue to the snippet' })).toBeInTheDocument()
    expect(screen.queryByText(/create a new key/i)).not.toBeInTheDocument()
  })

  test('after a 409 recovery it points to Projects instead', async () => {
    apiPost.mockRejectedValue(new Error('Already onboarded'))
    await reachSurvey()
    expect(screen.queryByRole('button', { name: 'Continue to the snippet' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to the dashboard' })).toBeInTheDocument()
    expect(screen.getByText(/create a new key/i)).toBeInTheDocument()
    expect(screen.getByText(/Projects/)).toBeInTheDocument()
  })

  test('when the browser refused to store the key it points to Projects too', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    apiPost.mockResolvedValue({ data: { apiKey: 'sl_live_fresh', userId: 'user-1' } })
    await reachSurvey()
    expect(screen.getByRole('button', { name: 'Continue to the dashboard' })).toBeInTheDocument()
    expect(screen.getByText(/create a new key/i)).toBeInTheDocument()
  })
})
