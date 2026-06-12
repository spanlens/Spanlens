// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, buttonVariants } from './button.js'

/**
 * Button is the most widely-reused interactive primitive in the dashboard.
 * The tests pin:
 *   1. variants × sizes produce the expected utility classes (so a Tailwind
 *      purge regression that drops one would be caught),
 *   2. asChild forwards props to the child element (Slot semantics),
 *   3. onClick fires, and disabled blocks both onClick + visual state.
 */

describe('Button — variants + sizes', () => {
  test('default variant + size renders as a <button> with the primary classes', () => {
    render(<Button>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveClass('bg-primary')
    expect(btn).toHaveClass('h-9')
  })

  test('destructive variant gets the destructive background class', () => {
    render(<Button variant="destructive">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-destructive')
  })

  test('outline variant gets the border class', () => {
    render(<Button variant="outline">Cancel</Button>)
    expect(screen.getByRole('button')).toHaveClass('border')
  })

  test('size=sm gets compact height + text', () => {
    render(<Button size="sm">Small</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('h-8')
    expect(btn).toHaveClass('text-xs')
  })

  test('size=icon gets equal width/height for square hit target', () => {
    render(<Button size="icon" aria-label="Settings">⚙</Button>)
    const btn = screen.getByRole('button', { name: 'Settings' })
    expect(btn).toHaveClass('h-9')
    expect(btn).toHaveClass('w-9')
  })

  test('custom className is merged via cn() — base classes survive', () => {
    render(<Button className="my-custom-class">Save</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('my-custom-class')
    expect(btn).toHaveClass('bg-primary') // default still applied
  })
})

describe('Button — asChild (Slot)', () => {
  test('asChild renders the child element (e.g. <a>) with the button styling applied', () => {
    render(
      <Button asChild>
        <a href="/dest">Go</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/dest')
    // The button styling must reach the child via Slot
    expect(link).toHaveClass('bg-primary')
  })
})

describe('Button — interaction', () => {
  test('onClick fires when clicked', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick}>Click me</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('disabled prevents onClick and applies the disabled styling', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick} disabled>Disabled</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveClass('disabled:opacity-50')
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('buttonVariants — class helper export', () => {
  test('exported variant generator returns deterministic strings (consumers reuse it for non-button slots)', () => {
    const cls = buttonVariants({ variant: 'outline', size: 'sm' })
    expect(cls).toContain('border')
    expect(cls).toContain('h-8')
  })
})
