// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'

const writeWelcomeStash = vi.hoisted(() => vi.fn())
vi.mock('./welcome-stash', () => ({ writeWelcomeStash }))

const { applyBootstrapResult } = await import('./onboarding-bootstrap')
const { readWorkspaceCookie, clearWorkspaceCookie, writeWorkspaceCookie } = await import(
  './workspace-cookie'
)

/**
 * XVERIFY 2026-09-28 C1.1: onboarding used to navigate to /dashboard without
 * the `sb-ws` workspace cookie, so every dashboard API call reused the auth
 * cache key that still held the pre-signup "no workspace" answer and got 404
 * for up to a minute. Pointing the cookie at the new workspace moves those
 * calls onto a fresh cache key on every server instance, the same way the
 * invitation-accept path already does.
 */
describe('applyBootstrapResult', () => {
  beforeEach(() => {
    writeWelcomeStash.mockReset()
    clearWorkspaceCookie()
  })

  test('points the workspace cookie at the org bootstrap just created', () => {
    applyBootstrapResult({
      data: { apiKey: 'sl_live_abc', userId: 'u-1', organization: { id: 'org-new' } },
    })
    expect(readWorkspaceCookie()).toBe('org-new')
  })

  test('replaces a stale cookie left behind by an earlier session on this browser', () => {
    writeWorkspaceCookie('org-from-someone-else')
    applyBootstrapResult({ data: { organization: { id: 'org-new' } } })
    expect(readWorkspaceCookie()).toBe('org-new')
  })

  test('stashes the one-time API key bound to the user', () => {
    applyBootstrapResult({
      data: { apiKey: 'sl_live_abc', userId: 'u-1', organization: { id: 'org-new' } },
    })
    expect(writeWelcomeStash).toHaveBeenCalledWith('sl_live_abc', 'u-1')
  })

  test('already-onboarded (409 mapped to null) leaves cookie and stash alone', () => {
    applyBootstrapResult(null)
    expect(readWorkspaceCookie()).toBeNull()
    expect(writeWelcomeStash).not.toHaveBeenCalled()
  })

  test('a response without an organization id does not write the cookie', () => {
    applyBootstrapResult({ data: { apiKey: 'sl_live_abc', userId: 'u-1' } })
    expect(readWorkspaceCookie()).toBeNull()
    expect(writeWelcomeStash).toHaveBeenCalledOnce()
  })
})
