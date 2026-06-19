import { describe, expect, test } from 'vitest'
import {
  buildJudgePrompt,
  parseJudgeReply,
  buildPairwiseJudgePrompt,
  parsePairwiseReply,
} from '../lib/eval-runners/judge-prompt.js'
import type { TypedScoreConfig } from '../lib/eval-runners/judge-prompt.js'

function sc(data_type: TypedScoreConfig['data_type'], over: Partial<TypedScoreConfig> = {}): TypedScoreConfig {
  return {
    id: 'cfg-1',
    data_type,
    min_value: null,
    max_value: null,
    categories: null,
    bool_true_label: null,
    bool_false_label: null,
    ...over,
  }
}

const BASE = { scale_min: 0, scale_max: 1 }

// ─── buildJudgePrompt ──────────────────────────────────────────────────────────

describe('buildJudgePrompt', () => {
  describe('NUMERIC / legacy (no score_config)', () => {
    test('contains criterion and response', () => {
      const p = buildJudgePrompt('Is it helpful?', 'Yes, very.', BASE)
      expect(p).toContain('Is it helpful?')
      expect(p).toContain('Yes, very.')
    })

    test('asks for JSON with correct scale range', () => {
      const p = buildJudgePrompt('crit', 'resp', { scale_min: 1, scale_max: 5 })
      expect(p).toContain('"score": <number between 1 and 5>')
    })

    test('uses min_value/max_value from NUMERIC score_config when set', () => {
      const p = buildJudgePrompt('crit', 'resp', {
        ...BASE,
        score_config: sc('NUMERIC', { min_value: 1, max_value: 10 }),
      })
      expect(p).toContain('"score": <number between 1 and 10>')
    })

    test('injects rubric block when present', () => {
      const p = buildJudgePrompt('crit', 'resp', { ...BASE, rubric: 'be strict' })
      expect(p).toContain('Scoring rubric (apply consistently):')
      expect(p).toContain('be strict')
    })

    test('omits rubric block when absent', () => {
      const p = buildJudgePrompt('crit', 'resp', BASE)
      expect(p).not.toContain('Scoring rubric')
    })

    test('injects anchors on NUMERIC path', () => {
      const p = buildJudgePrompt('crit', 'resp', {
        ...BASE,
        anchors: [{ response: 'great answer', score: 1, reasoning: 'nailed it' }],
      })
      expect(p).toContain('Calibration examples')
      expect(p).toContain('great answer')
      expect(p).toContain('score 1')
      expect(p).toContain('nailed it')
    })

    test('omits anchor block when anchors is empty', () => {
      const p = buildJudgePrompt('crit', 'resp', { ...BASE, anchors: [] })
      expect(p).not.toContain('Calibration examples')
    })

    test('injects expected_output reference block when present', () => {
      const p = buildJudgePrompt('crit', 'resp', { ...BASE, expected_output: 'ideal answer' })
      expect(p).toContain('Reference (expected) answer to compare against:')
      expect(p).toContain('ideal answer')
    })

    test('omits reference block when expected_output is null', () => {
      const p = buildJudgePrompt('crit', 'resp', { ...BASE, expected_output: null })
      expect(p).not.toContain('Reference (expected) answer')
    })

    test('instructs no prose outside JSON', () => {
      const p = buildJudgePrompt('crit', 'resp', BASE)
      expect(p).toContain('No prose outside the JSON')
    })
  })

  describe('BOOLEAN', () => {
    test('asks for boolean value shape', () => {
      const p = buildJudgePrompt('Safe?', 'Yes.', { ...BASE, score_config: sc('BOOLEAN') })
      expect(p).toContain('"value": <true or false>')
    })

    test('uses default labels pass/fail', () => {
      const p = buildJudgePrompt('crit', 'resp', { ...BASE, score_config: sc('BOOLEAN') })
      expect(p).toContain('`true` means "pass"')
      expect(p).toContain('`false` means "fail"')
    })

    test('uses custom bool_true_label and bool_false_label', () => {
      const p = buildJudgePrompt('crit', 'resp', {
        ...BASE,
        score_config: sc('BOOLEAN', { bool_true_label: 'compliant', bool_false_label: 'violation' }),
      })
      expect(p).toContain('`true` means "compliant"')
      expect(p).toContain('`false` means "violation"')
    })

    test('does NOT inject anchors on BOOLEAN path', () => {
      const p = buildJudgePrompt('crit', 'resp', {
        ...BASE,
        score_config: sc('BOOLEAN'),
        anchors: [{ response: 'example', score: 1 }],
      })
      expect(p).not.toContain('Calibration examples')
    })
  })

  describe('CATEGORICAL', () => {
    test('lists all categories in the prompt', () => {
      const p = buildJudgePrompt('Classify it', 'resp', {
        ...BASE,
        score_config: sc('CATEGORICAL', { categories: ['Helpful', 'Neutral', 'Harmful'] }),
      })
      expect(p).toContain('"Helpful"')
      expect(p).toContain('"Neutral"')
      expect(p).toContain('"Harmful"')
    })

    test('requires exact case match', () => {
      const p = buildJudgePrompt('crit', 'resp', {
        ...BASE,
        score_config: sc('CATEGORICAL', { categories: ['Good'] }),
      })
      expect(p).toContain('exact case match')
    })

    test('does NOT inject anchors on CATEGORICAL path', () => {
      const p = buildJudgePrompt('crit', 'resp', {
        ...BASE,
        score_config: sc('CATEGORICAL', { categories: ['A'] }),
        anchors: [{ response: 'ex', score: 1 }],
      })
      expect(p).not.toContain('Calibration examples')
    })
  })

  describe('TEXT', () => {
    test('asks for short free-form answer', () => {
      const p = buildJudgePrompt('Summarise the issue', 'resp', { ...BASE, score_config: sc('TEXT') })
      expect(p).toContain('"value": "<short answer>"')
      expect(p).toContain('200 characters')
    })
  })
})

// ─── parseJudgeReply ───────────────────────────────────────────────────────────

describe('parseJudgeReply', () => {
  describe('NUMERIC / legacy', () => {
    test('parses numeric score within scale', () => {
      const r = parseJudgeReply('{"score": 0.7, "reasoning": "ok"}', BASE)
      expect(r).not.toBeNull()
      expect(r!.score).toBeCloseTo(0.7)
      expect(r!.value_number).toBeCloseTo(0.7)
      expect(r!.value_string).toBeNull()
      expect(r!.value_boolean).toBeNull()
      expect(r!.reasoning).toBe('ok')
    })

    test('accepts {value: number} alternate key (LLM drift tolerance)', () => {
      const r = parseJudgeReply('{"value": 0.5, "reasoning": "mid"}', BASE)
      expect(r?.score).toBeCloseTo(0.5)
    })

    test('clamps score exceeding scale_max', () => {
      const r = parseJudgeReply('{"score": 5, "reasoning": ""}', BASE)
      expect(r!.score).toBe(1)
    })

    test('clamps score below scale_min', () => {
      const r = parseJudgeReply('{"score": -2, "reasoning": ""}', BASE)
      expect(r!.score).toBe(0)
    })

    test('preserves score on a 1-5 scale (clamp only, no 0-1 normalisation)', () => {
      const r = parseJudgeReply('{"score": 3, "reasoning": "mid"}', { scale_min: 1, scale_max: 5 })
      expect(r!.score).toBe(3)
    })

    test('returns null for non-numeric score field', () => {
      expect(parseJudgeReply('{"score": "high", "reasoning": ""}', BASE)).toBeNull()
    })

    test('returns null for invalid JSON', () => {
      expect(parseJudgeReply('not json at all', BASE)).toBeNull()
    })

    test('strips ```json fences before parsing', () => {
      const text = '```json\n{"score": 0.8, "reasoning": "good"}\n```'
      expect(parseJudgeReply(text, BASE)?.score).toBeCloseTo(0.8)
    })

    test('strips plain ``` fences', () => {
      const text = '```\n{"score": 0.5, "reasoning": ""}\n```'
      expect(parseJudgeReply(text, BASE)?.score).toBeCloseTo(0.5)
    })

    test('returns null when no score or value key present', () => {
      expect(parseJudgeReply('{"reasoning": "ok"}', BASE)).toBeNull()
    })

    test('falls back to empty string when reasoning is absent', () => {
      const r = parseJudgeReply('{"score": 0.5}', BASE)
      expect(r?.reasoning).toBe('')
    })
  })

  describe('BOOLEAN', () => {
    const boolCfg = { ...BASE, score_config: sc('BOOLEAN') }

    test('parses boolean true', () => {
      const r = parseJudgeReply('{"value": true, "reasoning": "yes"}', boolCfg)
      expect(r?.value_boolean).toBe(true)
      expect(r?.score).toBeNull()
    })

    test('parses boolean false', () => {
      expect(parseJudgeReply('{"value": false, "reasoning": ""}', boolCfg)?.value_boolean).toBe(false)
    })

    test('string "pass" → true', () => {
      expect(parseJudgeReply('{"value": "pass", "reasoning": ""}', boolCfg)?.value_boolean).toBe(true)
    })

    test('string "yes" → true', () => {
      expect(parseJudgeReply('{"value": "yes", "reasoning": ""}', boolCfg)?.value_boolean).toBe(true)
    })

    test('string "true" → true', () => {
      expect(parseJudgeReply('{"value": "true", "reasoning": ""}', boolCfg)?.value_boolean).toBe(true)
    })

    test('string "fail" → false', () => {
      expect(parseJudgeReply('{"value": "fail", "reasoning": ""}', boolCfg)?.value_boolean).toBe(false)
    })

    test('string "no" → false', () => {
      expect(parseJudgeReply('{"value": "no", "reasoning": ""}', boolCfg)?.value_boolean).toBe(false)
    })

    test('string "false" → false', () => {
      expect(parseJudgeReply('{"value": "false", "reasoning": ""}', boolCfg)?.value_boolean).toBe(false)
    })

    test('unrecognised string → null', () => {
      expect(parseJudgeReply('{"value": "maybe", "reasoning": ""}', boolCfg)).toBeNull()
    })

    test('null value → null', () => {
      expect(parseJudgeReply('{"value": null, "reasoning": ""}', boolCfg)).toBeNull()
    })
  })

  describe('CATEGORICAL', () => {
    const catCfg = {
      ...BASE,
      score_config: sc('CATEGORICAL', { categories: ['Helpful', 'Neutral', 'Harmful'] }),
    }

    test('parses a valid category', () => {
      const r = parseJudgeReply('{"value": "Helpful", "reasoning": "good"}', catCfg)
      expect(r?.value_string).toBe('Helpful')
      expect(r?.score).toBeNull()
    })

    test('returns null for value not in category list', () => {
      expect(parseJudgeReply('{"value": "Unknown", "reasoning": ""}', catCfg)).toBeNull()
    })

    test('returns null for empty string value', () => {
      expect(parseJudgeReply('{"value": "", "reasoning": ""}', catCfg)).toBeNull()
    })

    test('case-sensitive: "helpful" ≠ "Helpful"', () => {
      expect(parseJudgeReply('{"value": "helpful", "reasoning": ""}', catCfg)).toBeNull()
    })

    test('returns null when categories list is empty', () => {
      const cfg = { ...BASE, score_config: sc('CATEGORICAL', { categories: [] }) }
      expect(parseJudgeReply('{"value": "anything", "reasoning": ""}', cfg)).toBeNull()
    })
  })

  describe('TEXT', () => {
    const textCfg = { ...BASE, score_config: sc('TEXT') }

    test('parses free-form text value', () => {
      const r = parseJudgeReply('{"value": "The response was concise", "reasoning": "ok"}', textCfg)
      expect(r?.value_string).toBe('The response was concise')
      expect(r?.score).toBeNull()
    })

    test('returns null for empty string value', () => {
      expect(parseJudgeReply('{"value": "", "reasoning": ""}', textCfg)).toBeNull()
    })

    test('returns null for whitespace-only value', () => {
      expect(parseJudgeReply('{"value": "   ", "reasoning": ""}', textCfg)).toBeNull()
    })

    test('returns null for non-string value', () => {
      expect(parseJudgeReply('{"value": 42, "reasoning": ""}', textCfg)).toBeNull()
    })

    test('trims whitespace from value', () => {
      const r = parseJudgeReply('{"value": "  trimmed  ", "reasoning": ""}', textCfg)
      expect(r?.value_string).toBe('trimmed')
    })
  })
})

// ─── buildPairwiseJudgePrompt ──────────────────────────────────────────────────

describe('buildPairwiseJudgePrompt', () => {
  test('contains both responses', () => {
    const p = buildPairwiseJudgePrompt('Is it helpful?', 'Response alpha', 'Response beta')
    expect(p).toContain('Response alpha')
    expect(p).toContain('Response beta')
  })

  test('contains the criterion', () => {
    const p = buildPairwiseJudgePrompt('Is it safe?', 'a', 'b')
    expect(p).toContain('Is it safe?')
  })

  test('labels responses as A and B', () => {
    const p = buildPairwiseJudgePrompt('crit', 'alpha', 'beta')
    expect(p).toContain('Response A:')
    expect(p).toContain('Response B:')
  })

  test('asks for winner JSON shape with A/B/tie options', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b')
    expect(p).toContain('"winner": "A" | "B" | "tie"')
  })

  test('injects rubric when present', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b', { rubric: 'prefer concise' })
    expect(p).toContain('Scoring rubric (apply consistently):')
    expect(p).toContain('prefer concise')
  })

  test('omits rubric block when absent', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b')
    expect(p).not.toContain('Scoring rubric')
  })

  test('injects expected_output reference block when present', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b', { expected_output: 'golden answer' })
    expect(p).toContain('Reference (expected) answer both responses should match:')
    expect(p).toContain('golden answer')
  })

  test('omits reference block when expected_output is null', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b', { expected_output: null })
    expect(p).not.toContain('Reference (expected) answer')
  })

  test('instructs judge to evaluate only on the criterion', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b')
    expect(p).toContain('Judge only on the criterion')
  })

  test('instructs no prose outside JSON', () => {
    const p = buildPairwiseJudgePrompt('crit', 'a', 'b')
    expect(p).toContain('No prose outside the JSON')
  })
})

// ─── parsePairwiseReply ────────────────────────────────────────────────────────

describe('parsePairwiseReply', () => {
  test('parses winner A', () => {
    const r = parsePairwiseReply('{"winner": "A", "reasoning": "A was clearer"}')
    expect(r?.winner).toBe('A')
    expect(r?.reasoning).toBe('A was clearer')
  })

  test('parses winner B', () => {
    const r = parsePairwiseReply('{"winner": "B", "reasoning": "B was more concise"}')
    expect(r?.winner).toBe('B')
  })

  test('parses "tie"', () => {
    const r = parsePairwiseReply('{"winner": "tie", "reasoning": "both equal"}')
    expect(r?.winner).toBe('tie')
  })

  test('"neither" is a tie synonym', () => {
    expect(parsePairwiseReply('{"winner": "neither", "reasoning": ""}')?.winner).toBe('tie')
  })

  test('"equal" is a tie synonym', () => {
    expect(parsePairwiseReply('{"winner": "equal", "reasoning": ""}')?.winner).toBe('tie')
  })

  test('"same" is a tie synonym', () => {
    expect(parsePairwiseReply('{"winner": "same", "reasoning": ""}')?.winner).toBe('tie')
  })

  test('case-insensitive: "a" parses as A', () => {
    expect(parsePairwiseReply('{"winner": "a", "reasoning": ""}')?.winner).toBe('A')
  })

  test('case-insensitive: "b" parses as B', () => {
    expect(parsePairwiseReply('{"winner": "b", "reasoning": ""}')?.winner).toBe('B')
  })

  test('returns null for unrecognised winner', () => {
    expect(parsePairwiseReply('{"winner": "C", "reasoning": ""}')).toBeNull()
  })

  test('returns null for invalid JSON', () => {
    expect(parsePairwiseReply('not json')).toBeNull()
  })

  test('strips ```json fences before parsing', () => {
    const text = '```json\n{"winner": "A", "reasoning": "good"}\n```'
    expect(parsePairwiseReply(text)?.winner).toBe('A')
  })

  test('strips plain ``` fences', () => {
    const text = '```\n{"winner": "B", "reasoning": ""}\n```'
    expect(parsePairwiseReply(text)?.winner).toBe('B')
  })

  test('returns null when winner key is missing', () => {
    expect(parsePairwiseReply('{"reasoning": "ok"}')).toBeNull()
  })

  test('returns empty string for missing reasoning (not null)', () => {
    const r = parsePairwiseReply('{"winner": "A"}')
    expect(r?.winner).toBe('A')
    expect(r?.reasoning).toBe('')
  })
})
