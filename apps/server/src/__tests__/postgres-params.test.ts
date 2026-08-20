import { describe, expect, test } from 'vitest'
import { toPositional } from '../lib/postgres.js'

/**
 * The named-parameter shim is what lets 44 call sites assemble WHERE clauses
 * from fragments without renumbering positional placeholders by hand.
 *
 * It earns its own test because its failure mode is the quiet kind. A wrong
 * name-to-position mapping still produces syntactically valid SQL that
 * Postgres will happily run against the wrong value, which on this table
 * means the wrong tenant's rows. Nothing downstream would notice.
 */

describe('toPositional', () => {
  test('rewrites a single placeholder and collects its value', () => {
    const { text, values } = toPositional('SELECT 1 WHERE organization_id = {orgId}', {
      orgId: 'org-1',
    })
    expect(text).toBe('SELECT 1 WHERE organization_id = $1')
    expect(values).toEqual(['org-1'])
  })

  test('numbers placeholders in the order they appear, not in object order', () => {
    // The params object deliberately lists these in the opposite order to
    // the query. Binding by object key order instead of textual order is the
    // exact bug this shim exists to make impossible.
    const { text, values } = toPositional(
      'SELECT 1 WHERE a = {second} AND b = {first}',
      { first: 'F', second: 'S' },
    )
    expect(text).toBe('SELECT 1 WHERE a = $1 AND b = $2')
    expect(values).toEqual(['S', 'F'])
  })

  test('a name used twice reuses one position instead of binding twice', () => {
    const { text, values } = toPositional(
      'SELECT 1 WHERE created_at >= {from} OR updated_at >= {from}',
      { from: '2026-08-01' },
    )
    expect(text).toBe('SELECT 1 WHERE created_at >= $1 OR updated_at >= $1')
    expect(values).toEqual(['2026-08-01'])
  })

  test('throws on a placeholder with no matching parameter', () => {
    // Loud failure on the first call beats a silently unfiltered query. The
    // dangerous version of this bug is a dropped `organization_id` filter.
    expect(() => toPositional('SELECT 1 WHERE org = {orgId}', {})).toThrow(
      'Missing SQL parameter: {orgId}',
    )
  })

  test('a parameter explicitly set to null still binds', () => {
    // `null` is a legitimate value here (nullable provider_key_id, user_id).
    // A presence check written as a truthiness check would reject it.
    const { text, values } = toPositional('SELECT 1 WHERE provider_key_id IS NOT DISTINCT FROM {k}', {
      k: null,
    })
    expect(text).toBe('SELECT 1 WHERE provider_key_id IS NOT DISTINCT FROM $1')
    expect(values).toEqual([null])
  })

  test('a parameter explicitly set to undefined still binds', () => {
    const { values } = toPositional('SELECT {v}', { v: undefined })
    expect(values).toEqual([undefined])
  })

  test('leaves the query untouched when there are no placeholders', () => {
    const { text, values } = toPositional('SELECT count(*) FROM requests')
    expect(text).toBe('SELECT count(*) FROM requests')
    expect(values).toEqual([])
  })

  test('does not treat a brace that is not an identifier as a placeholder', () => {
    // jsonb literals and format strings can carry braces. Only
    // `{identifier}` binds; anything else passes through as SQL text.
    const { text, values } = toPositional(`SELECT '{}'::jsonb, '{1,2}'::int[], {real}`, {
      real: 7,
    })
    expect(text).toBe(`SELECT '{}'::jsonb, '{1,2}'::int[], $1`)
    expect(values).toEqual([7])
  })

  test('never places a value into the SQL text', () => {
    // The property the whole shim rests on: a hostile value travels as a
    // bound parameter and cannot reach the statement text.
    const hostile = `'; DROP TABLE requests; --`
    const { text, values } = toPositional('SELECT 1 WHERE model = {model}', { model: hostile })
    expect(text).toBe('SELECT 1 WHERE model = $1')
    expect(text).not.toContain('DROP TABLE')
    expect(values).toEqual([hostile])
  })

  test('handles a realistic assembled WHERE clause', () => {
    // Mirrors how lib/requests-query.ts + api/exports.ts build filters: a
    // scope fragment joined with an arbitrary number of optional ones. The
    // renumbering this avoids is why the shim exists.
    const scope = 'organization_id = {orgId} AND created_at >= now() - make_interval(days => {retentionDays})'
    const filters = ['provider = {provider}', 'status_code >= {minStatus}']
    const { text, values } = toPositional(
      `SELECT id FROM requests WHERE ${scope} AND ${filters.join(' AND ')} ORDER BY created_at DESC`,
      { orgId: 'org-1', retentionDays: 90, provider: 'openai', minStatus: 400 },
    )
    expect(text).toBe(
      'SELECT id FROM requests WHERE organization_id = $1 AND created_at >= now() - make_interval(days => $2)' +
        ' AND provider = $3 AND status_code >= $4 ORDER BY created_at DESC',
    )
    expect(values).toEqual(['org-1', 90, 'openai', 400])
  })
})
