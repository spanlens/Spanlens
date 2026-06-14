import { describe, expect, test } from 'vitest'
import { isAlertBreached, type AlertType } from '../lib/cron-jobs/evaluate-alerts.js'

/**
 * P2-9: eval_score is a quality FLOOR — it breaches when the average score
 * drops to/below the threshold, the opposite direction from the budget /
 * error_rate / latency_p95 CEILINGS. A regression that treats eval_score
 * like the others would alert exactly when quality is GOOD and stay silent
 * when it regresses, so this direction is the thing worth pinning.
 */

const CEILINGS: AlertType[] = ['budget', 'error_rate', 'latency_p95']

describe('isAlertBreached', () => {
  test.each(CEILINGS)('%s breaches when current rises to/above threshold', (type) => {
    expect(isAlertBreached(type, 11, 10)).toBe(true) // above
    expect(isAlertBreached(type, 10, 10)).toBe(true) // at (>=)
    expect(isAlertBreached(type, 9, 10)).toBe(false) // below
  })

  test('eval_score breaches when the score drops to/below threshold (inverted)', () => {
    expect(isAlertBreached('eval_score', 0.7, 0.8)).toBe(true) // below the floor
    expect(isAlertBreached('eval_score', 0.8, 0.8)).toBe(true) // at (<=)
    expect(isAlertBreached('eval_score', 0.9, 0.8)).toBe(false) // healthy, above the floor
  })

  test('eval_score does NOT use the ceiling direction', () => {
    // A high score must never fire an eval_score alert (the regression we guard against).
    expect(isAlertBreached('eval_score', 1.0, 0.8)).toBe(false)
    // A ceiling metric with the same numbers WOULD fire — proving the direction differs.
    expect(isAlertBreached('error_rate', 1.0, 0.8)).toBe(true)
  })
})
