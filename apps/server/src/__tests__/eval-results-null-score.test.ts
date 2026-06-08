import { describe, it, expect, expectTypeOf } from 'vitest'
import { validateScore, type ScoreConfig, type NormalizedScoreFields } from '../lib/score-validation.js'

/**
 * R-Q1 regression suite.
 *
 * Pins three invariants after the `eval_results.score DROP NOT NULL`
 * migration (20260609100000):
 *
 *   1. `NormalizedScoreFields.score` is `number | null` at the type level.
 *      `validateScore()` is the only path that builds the insert payload
 *      for typed score columns, so if this widens or narrows in a way
 *      incompatible with the new schema, the typecheck fails before
 *      runtime sees it. The `supabase/types.ts` Row/Insert type is
 *      verified by the typecheck of the routes that perform the actual
 *      INSERT (eval-runner.ts, evals.ts) — re-importing it here would
 *      reach outside `rootDir`.
 *
 *   2. `validateScore()` for CATEGORICAL / BOOLEAN / TEXT configs returns
 *      `fields.score === null`. The migration only matters if the writer
 *      actually emits null for non-numeric configs; this confirms it does.
 *
 *   3. NUMERIC configs keep mirroring the legacy `score` column from
 *      `value_number`, so dashboards reading `AVG(score)` stay unaffected
 *      by the migration. This is the backward-compat invariant.
 *
 * The migration itself is exercised by `supabase db push` and observable
 * through `information_schema.columns.is_nullable = YES`; the full DB
 * integration would need a real `eval_results` row, which is overkill for
 * a column-nullability change.
 */

function makeConfig(overrides: Partial<ScoreConfig> = {}): ScoreConfig {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    data_type: 'NUMERIC',
    min_value: 0,
    max_value: 1,
    categories: null,
    bool_true_label: null,
    bool_false_label: null,
    ...overrides,
  }
}

describe('R-Q1 — eval_results.score nullable', () => {
  it('NormalizedScoreFields.score is nullable at the type level', () => {
    expectTypeOf<NormalizedScoreFields['score']>().toEqualTypeOf<number | null>()
  })

  it('CATEGORICAL evaluator emits score=null + value_string set', () => {
    const config = makeConfig({
      data_type: 'CATEGORICAL',
      categories: ['accepted', 'rejected'],
      min_value: null,
      max_value: null,
    })

    const r = validateScore(config, 'accepted')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fields.score).toBeNull()
    expect(r.fields.value_string).toBe('accepted')
    expect(r.fields.value_number).toBeNull()
    expect(r.fields.value_boolean).toBeNull()
  })

  it('BOOLEAN evaluator emits score=null + value_boolean set', () => {
    const config = makeConfig({
      data_type: 'BOOLEAN',
      min_value: null,
      max_value: null,
    })

    const r = validateScore(config, true)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fields.score).toBeNull()
    expect(r.fields.value_boolean).toBe(true)
    expect(r.fields.value_number).toBeNull()
    expect(r.fields.value_string).toBeNull()
  })

  it('TEXT evaluator emits score=null + value_string set', () => {
    const config = makeConfig({
      data_type: 'TEXT',
      min_value: null,
      max_value: null,
    })

    const r = validateScore(config, 'free-form judge reasoning')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fields.score).toBeNull()
    expect(r.fields.value_string).toBe('free-form judge reasoning')
    expect(r.fields.value_number).toBeNull()
    expect(r.fields.value_boolean).toBeNull()
  })

  it('NUMERIC evaluator keeps mirroring score=value_number (backward compat)', () => {
    const config = makeConfig({
      data_type: 'NUMERIC',
      min_value: 0,
      max_value: 1,
    })

    const r = validateScore(config, 0.85)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fields.score).toBe(0.85)
    expect(r.fields.value_number).toBe(0.85)
    // Pre-migration dashboards that read AVG(score) still see 0.85.
  })

  it('Exactly one typed value column is non-null across all 4 score types', () => {
    // Invariant: typed-value columns are mutually exclusive (lib/score-validation
    // contract). If a future change accidentally fills two, downstream
    // aggregations could double-count.
    const cases: Array<[ScoreConfig, unknown]> = [
      [makeConfig({ data_type: 'NUMERIC', min_value: 0, max_value: 1 }), 0.5],
      [
        makeConfig({
          data_type: 'CATEGORICAL',
          categories: ['ok'],
          min_value: null,
          max_value: null,
        }),
        'ok',
      ],
      [makeConfig({ data_type: 'BOOLEAN', min_value: null, max_value: null }), false],
      [makeConfig({ data_type: 'TEXT', min_value: null, max_value: null }), 'note'],
    ]

    for (const [config, value] of cases) {
      const r = validateScore(config, value)
      if (!r.ok) throw new Error(`fixture ${config.data_type} should validate`)
      const filled = [
        r.fields.value_number,
        r.fields.value_string,
        r.fields.value_boolean,
      ].filter((v) => v !== null).length
      expect(filled, `${config.data_type} must fill exactly 1 typed column`).toBe(1)
    }
  })
})
