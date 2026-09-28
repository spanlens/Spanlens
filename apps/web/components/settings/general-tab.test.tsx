// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Settings → General (app/(dashboard)/settings/_sections/general-tab.tsx).
 * The test lives under components/ because vitest only collects lib/ and
 * components/; the component itself stays with the settings route.
 *
 * Two regressions are pinned here:
 *
 *   1. Retention was a hard-coded table (7 / 30 / 90 days) that under-reported
 *      every plan against what the server enforces, printed "7 days" before
 *      the org loaded, and showed the internal id "starter plan" instead of
 *      the plan's name, Pro.
 *   2. At 360-375px the workspace-name row overflowed its card and the Save
 *      button was clipped: the input kept its intrinsic width (flex items
 *      default to min-width: auto) inside an overflow-hidden card, and the
 *      settings body is zoomed to 125%. The fix is class-level, so that is
 *      what is asserted.
 */

let org: { id: string; name: string; plan: string; hide_powered_by_badge: boolean; body_sample_rate: number } | undefined
let role: 'admin' | 'viewer' = 'admin'

const mutation = { mutateAsync: vi.fn(), isPending: false }

vi.mock('@/lib/queries/use-organization', () => ({
  useOrganization: () => ({ data: org }),
  useUpdateOrganization: () => mutation,
  useUpdateBrandingSettings: () => mutation,
  useUpdateLoggingSettings: () => mutation,
}))
vi.mock('@/lib/queries/use-members', () => ({
  useCurrentMember: () => ({ role }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

const { GeneralTab } = await import('@/app/(dashboard)/settings/_sections/general-tab')

function orgOn(plan: string) {
  return { id: 'org-1', name: 'Acme', plan, hide_powered_by_badge: false, body_sample_rate: 1 }
}

beforeEach(() => {
  org = undefined
  role = 'admin'
})

describe('data retention', () => {
  test.each([
    ['free', '14 days', 'Free plan'],
    ['starter', '90 days', 'Pro plan'],
    ['team', '365 days', 'Team plan'],
    ['enterprise', '365 days', 'Enterprise plan'],
  ])('%s shows %s and the plan name', (plan, days, planName) => {
    org = orgOn(plan)
    render(<GeneralTab />)
    expect(screen.getByText(days)).toBeInTheDocument()
    expect(screen.getByText(`· ${planName}`)).toBeInTheDocument()
  })

  test('the plan pill shows the display name, not the internal id', () => {
    org = orgOn('starter')
    render(<GeneralTab />)
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.queryByText('starter')).not.toBeInTheDocument()
    expect(screen.queryByText(/starter plan/)).not.toBeInTheDocument()
  })

  test('shows no retention figure before the organization loads', () => {
    org = undefined
    render(<GeneralTab />)
    expect(screen.queryByText(/\d+ days/)).not.toBeInTheDocument()
  })
})

describe('workspace name row at phone widths', () => {
  test('the input may shrink below its intrinsic width and the Save button may not', () => {
    org = orgOn('free')
    render(<GeneralTab />)
    const input = screen.getByDisplayValue('Acme')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(input).toHaveClass('min-w-0')
    expect(save).toHaveClass('shrink-0')
    // The row's column also has to be allowed to shrink inside the grid cell.
    expect(input.parentElement?.parentElement).toHaveClass('min-w-0')
  })
})
