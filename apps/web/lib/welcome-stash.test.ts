// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeWelcomeStash, hasWelcomeStash, writeWelcomeStash } from './welcome-stash'

/**
 * `hasWelcomeStash()` lets onboarding ask "will the dashboard be able to show
 * this user their key?" without consuming it. The answer is no after a 409
 * bootstrap (the workspace already existed, so no key came back) and after a
 * storage failure, and in both cases the survey used to promise "Continue to
 * the snippet" anyway.
 */

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hasWelcomeStash', () => {
  it('is false when nothing was stashed', () => {
    expect(hasWelcomeStash()).toBe(false)
  })

  it('is true after a successful write and does not consume the entry', () => {
    writeWelcomeStash('sl_live_abc', 'user-1')
    expect(hasWelcomeStash()).toBe(true)
    expect(hasWelcomeStash()).toBe(true)
    expect(consumeWelcomeStash('user-1')).toBe('sl_live_abc')
    expect(hasWelcomeStash()).toBe(false)
  })

  it('is false when the write failed silently', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    writeWelcomeStash('sl_live_abc', 'user-1')
    expect(hasWelcomeStash()).toBe(false)
  })

  it('is false for an entry in an unreadable shape', () => {
    sessionStorage.setItem('spanlens:welcome_api_key', 'sl_live_raw_legacy_string')
    expect(hasWelcomeStash()).toBe(false)
  })

  it('is false when storage itself cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(hasWelcomeStash()).toBe(false)
  })
})
