/**
 * Effective document versions for the legal pages that users accept at
 * signup. The string MUST match the `EFFECTIVE_DATE` constant at the top
 * of each corresponding page — that's what gets persisted in
 * `user_consents.version` to prove which revision the user accepted.
 *
 * Update both this file and the page in the same commit when revising a
 * document; the user_consents table is append-only so the next user to
 * sign up will be recorded as accepting the new version.
 */

export const TERMS_VERSION = '2026-05-17'

export const PRIVACY_VERSION = '2026-05-18'
