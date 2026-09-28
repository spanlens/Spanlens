import { describe, expect, it } from 'vitest'
import { hasActiveProviderKey } from './welcome-banner'

/**
 * Step 2 of the welcome banner ("Register an AI provider key") flips to
 * "Done" once a provider key exists. It counted every row the endpoint
 * returned, including deactivated keys, so a workspace whose only key was
 * switched off still read as ready and the test call in step 4 then failed.
 */

const key = (is_active: boolean) => ({
  id: 'pk-1',
  provider: 'openai',
  name: 'default',
  is_active,
  api_key_id: 'ak-1',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
})

describe('hasActiveProviderKey', () => {
  it('is false with no keys or before the list loads', () => {
    expect(hasActiveProviderKey(undefined)).toBe(false)
    expect(hasActiveProviderKey([])).toBe(false)
  })

  it('ignores deactivated keys', () => {
    expect(hasActiveProviderKey([key(false)])).toBe(false)
  })

  it('is true once any active key exists', () => {
    expect(hasActiveProviderKey([key(false), key(true)])).toBe(true)
  })
})
