// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState, FilterEmptyState, FirstInstallEmptyState } from './empty-state.js'

/**
 * EmptyState is the shared blank-data shell used across every list page
 * (requests, traces, prompts, evals, datasets, …). A regression here changes
 * the empty UX for every page at once, so it's worth pinning the rendered
 * shape + the two callback wrappers (FilterEmptyState/FirstInstallEmptyState).
 *
 * These are the first @testing-library/react tests in apps/web — the
 * `// @vitest-environment jsdom` pragma at the top opts this file into the
 * DOM environment without affecting the pure-helper tests in lib/.
 */

describe('EmptyState — base shell', () => {
  test('renders the title text', () => {
    render(<EmptyState title="No results" />)
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  test('renders description when supplied', () => {
    render(<EmptyState title="No results" description="Try a wider time range." />)
    expect(screen.getByText('Try a wider time range.')).toBeInTheDocument()
  })

  test('omits the description block entirely when not supplied (not an empty <p>)', () => {
    const { container } = render(<EmptyState title="No results" />)
    // Only the title <p> should be in the tree — there must be no orphan
    // description paragraph that would create vertical space and a screen-reader
    // pause for a missing description.
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
  })

  test('renders action node when supplied', () => {
    render(
      <EmptyState
        title="No results"
        action={<button type="button">Retry</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  test('merges custom className with default layout classes', () => {
    const { container } = render(
      <EmptyState title="No results" className="custom-empty-marker" />,
    )
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('custom-empty-marker')
    // The default centering classes are still applied — cn() must merge, not replace.
    expect(root).toHaveClass('flex')
    expect(root).toHaveClass('text-center')
  })
})

describe('FilterEmptyState — filter-specific variant', () => {
  test('uses the "No results" copy with a filter-clear hint', () => {
    render(<FilterEmptyState onClear={() => undefined} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(
      screen.getByText(/no results\. try adjusting your filters/i),
    ).toBeInTheDocument()
  })

  test('fires onClear when the clear-filters button is clicked', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    render(<FilterEmptyState onClear={onClear} />)

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('FirstInstallEmptyState — onboarding variant', () => {
  test('renders the connect-first-project CTA pointing to /projects', () => {
    render(<FirstInstallEmptyState />)
    const cta = screen.getByRole('link', { name: /connect your first project/i })
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveAttribute('href', '/projects')
  })
})
