// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInViewport } from '@/app/docs/_components/use-in-viewport'

/**
 * Behaviour lock for the /docs figure viewport gate.
 *
 * WHY THIS TEST EXISTS RATHER THAN A BROWSER CHECK:
 *
 * The gate's whole job is "do not fetch the recharts chunk until the figure
 * nears the viewport". That is exactly the kind of claim a browser session
 * cannot settle here: IntersectionObserver does not fire in a tab Chrome is not
 * compositing, which is the state every automated tab is in. During the change
 * that added this hook, a manually-armed observer on a 360x638 in-viewport
 * element reported nothing — the environment, not the code. So the contract is
 * pinned here instead, where it also survives into CI.
 *
 * The properties below are the ones the docs figures actually depend on. If any
 * of them regress, either the charts never appear (gate stuck closed) or the
 * deferral silently stops working (gate opens on mount, which is the bug this
 * hook was written to fix — `ssr: false` alone left the 136 KB chart chunk
 * starting at 54 ms against a 658 ms DOMContentLoaded).
 *
 * The hook is exercised through a probe component rather than `renderHook` so
 * the ref actually lands on a DOM node, which is the part that matters: the
 * observer needs a real element to watch.
 */

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void

interface FakeObserver {
  callback: IOCallback
  options: IntersectionObserverInit | undefined
  observed: Element[]
  disconnected: boolean
}

let observers: FakeObserver[] = []
const OriginalIO = globalThis.IntersectionObserver

function installFakeIO() {
  class FakeIntersectionObserver {
    constructor(cb: IOCallback, options?: IntersectionObserverInit) {
      this.record = { callback: cb, options, observed: [], disconnected: false }
      observers.push(this.record)
    }
    private record: FakeObserver
    observe(el: Element) {
      this.record.observed.push(el)
    }
    disconnect() {
      this.record.disconnected = true
    }
    unobserve() {}
    takeRecords() {
      return []
    }
  }
  // Cast through unknown: the fake implements only the surface the hook uses.
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver
}

/** Renders the two states the real gate renders, so assertions read like the UI. */
function Probe() {
  const { ref, inViewport } = useInViewport<HTMLDivElement>()
  return (
    <div ref={ref} data-testid="box">
      {inViewport ? <span>chart</span> : <span>placeholder</span>}
    </div>
  )
}

beforeEach(() => {
  observers = []
  installFakeIO()
})

afterEach(() => {
  globalThis.IntersectionObserver = OriginalIO
  vi.restoreAllMocks()
})

describe('useInViewport', () => {
  it('renders the placeholder on mount and does not open the gate', () => {
    render(<Probe />)

    expect(screen.getByText('placeholder')).toBeTruthy()
    expect(screen.queryByText('chart')).toBeNull()
  })

  it('observes the ref element, not the document', () => {
    render(<Probe />)

    expect(observers).toHaveLength(1)
    expect(observers[0]!.observed).toHaveLength(1)
    expect(observers[0]!.observed[0]).toBe(screen.getByTestId('box'))
  })

  it('passes a rootMargin so the fetch starts before the figure is on screen', () => {
    render(<Probe />)

    // The exact value is a tuning knob, but it must be a positive vertical
    // margin — a zero margin would mean the user watches the chunk download.
    const margin = observers[0]!.options?.rootMargin
    expect(margin).toBeTruthy()
    expect(margin).toMatch(/^\d+%/)
  })

  it('opens the gate once an entry intersects', () => {
    render(<Probe />)

    act(() => {
      observers[0]!.callback([{ isIntersecting: true }])
    })

    expect(screen.getByText('chart')).toBeTruthy()
    expect(screen.queryByText('placeholder')).toBeNull()
  })

  it('ignores a non-intersecting entry', () => {
    render(<Probe />)

    act(() => {
      observers[0]!.callback([{ isIntersecting: false }])
    })

    expect(screen.getByText('placeholder')).toBeTruthy()
  })

  it('disconnects after opening so it stops observing a chart that is already mounted', () => {
    render(<Probe />)

    act(() => {
      observers[0]!.callback([{ isIntersecting: true }])
    })

    expect(observers[0]!.disconnected).toBe(true)
  })

  it('latches open — scrolling back past the figure does not unmount the chart', () => {
    render(<Probe />)

    act(() => {
      observers[0]!.callback([{ isIntersecting: true }])
    })
    act(() => {
      observers[0]!.callback([{ isIntersecting: false }])
    })

    expect(screen.getByText('chart')).toBeTruthy()
  })

  it('falls open when IntersectionObserver is unavailable', () => {
    // Deleting the global is the "very old browser" path. The gate must open
    // rather than leave an empty box forever — a missing API should degrade to
    // the old eager behaviour, not to a broken page.
    // @ts-expect-error - deliberately removing the global for this case
    delete globalThis.IntersectionObserver

    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })

    render(<Probe />)

    expect(raf).toHaveBeenCalled()
    expect(screen.getByText('chart')).toBeTruthy()
  })
})
