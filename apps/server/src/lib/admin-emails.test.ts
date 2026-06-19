import { beforeEach, describe, expect, it, vi } from 'vitest'

// getAdminEmails gates who receives security alert emails (leak-detection,
// stale-key-digest). Untested before Phase 5. Mock supabaseAdmin's query
// builder + auth.admin so each branch is deterministic.

interface QueryResult { data: Array<Record<string, unknown>> | null }

let orgMembersResult: QueryResult
let optedOutResult: QueryResult
let emailByUser: Record<string, string | null>

const fromMock = vi.fn()
const getUserByIdMock = vi.fn()

vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
    auth: { admin: { getUserById: (...args: unknown[]) => getUserByIdMock(...args) } },
  },
}))

import { getAdminEmails } from './admin-emails.js'

// A chainable, thenable query-builder stub: select/eq/in return `this`, and
// awaiting it resolves to the configured result.
function makeBuilder(result: QueryResult) {
  const b = {
    select: () => b,
    eq: () => b,
    in: () => b,
    then: (resolve: (v: QueryResult) => unknown) => resolve(result),
  }
  return b
}

beforeEach(() => {
  orgMembersResult = { data: [] }
  optedOutResult = { data: [] }
  emailByUser = {}
  fromMock.mockReset()
  getUserByIdMock.mockReset()

  fromMock.mockImplementation((table: string) => {
    if (table === 'org_members') return makeBuilder(orgMembersResult)
    if (table === 'user_notification_prefs') return makeBuilder(optedOutResult)
    return makeBuilder({ data: [] })
  })
  getUserByIdMock.mockImplementation((id: string) =>
    Promise.resolve({ data: { user: emailByUser[id] ? { email: emailByUser[id] } : null } }),
  )
})

describe('getAdminEmails', () => {
  it('returns [] when the org has no admins (and never calls getUserById)', async () => {
    orgMembersResult = { data: [] }
    expect(await getAdminEmails('org-1')).toEqual([])
    expect(getUserByIdMock).not.toHaveBeenCalled()
  })

  it('returns the email of an admin who has not opted out (default opted-in)', async () => {
    orgMembersResult = { data: [{ user_id: 'u1' }] }
    optedOutResult = { data: [] } // no prefs row → opted in
    emailByUser = { u1: 'admin@x.com' }
    expect(await getAdminEmails('org-1')).toEqual(['admin@x.com'])
  })

  it('excludes an admin who opted out of security alert emails', async () => {
    orgMembersResult = { data: [{ user_id: 'u1' }, { user_id: 'u2' }] }
    optedOutResult = { data: [{ user_id: 'u2' }] }
    emailByUser = { u1: 'a@x.com', u2: 'b@x.com' }

    expect(await getAdminEmails('org-1')).toEqual(['a@x.com'])
    // u2 was filtered before the lookup — no getUserById for it.
    expect(getUserByIdMock).toHaveBeenCalledWith('u1')
    expect(getUserByIdMock).not.toHaveBeenCalledWith('u2')
  })

  it('skips an admin whose auth record has no email', async () => {
    orgMembersResult = { data: [{ user_id: 'u1' }, { user_id: 'u2' }] }
    optedOutResult = { data: [] }
    emailByUser = { u1: 'a@x.com', u2: null } // u2 has no email

    expect(await getAdminEmails('org-1')).toEqual(['a@x.com'])
  })
})
