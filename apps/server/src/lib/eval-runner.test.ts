import { describe, expect, it } from 'vitest'
import {
  buildJudgePrompt,
  parseJudgeReply,
  type TypedScoreConfig,
} from './eval-runner.js'

// ── buildJudgePrompt ─────────────────────────────────────────────────────────

describe('buildJudgePrompt — legacy NUMERIC path (score_config = null)', () => {
  it('emits the legacy {"score": <number>} schema', () => {
    const prompt = buildJudgePrompt('Is this answer helpful?', 'The capital is Paris.', {
      scale_min: 0,
      scale_max: 1,
    })
    expect(prompt).toContain('Criterion: Is this answer helpful?')
    expect(prompt).toContain('"score": <number between 0 and 1>')
    expect(prompt).not.toContain('"value"')
  })

  it('respects the criterion text verbatim', () => {
    const prompt = buildJudgePrompt('No PII leak', 'abc', { scale_min: 0, scale_max: 5 })
    expect(prompt).toContain('No PII leak')
    expect(prompt).toContain('between 0 and 5')
  })
})

// ── P1-6: expected_output (golden answer) injection ──────────────────────────
describe('buildJudgePrompt — expected_output reference', () => {
  it('injects the reference block when expected_output is present', () => {
    const prompt = buildJudgePrompt('Is it correct?', 'Paris', {
      scale_min: 0,
      scale_max: 1,
      expected_output: 'The capital of France is Paris.',
    })
    expect(prompt).toContain('Reference (expected) answer')
    expect(prompt).toContain('The capital of France is Paris.')
    expect(prompt).toContain('compare against')
  })

  it('omits the reference block when expected_output is null/absent (byte-identical to before)', () => {
    const withNull = buildJudgePrompt('Is it correct?', 'Paris', {
      scale_min: 0,
      scale_max: 1,
      expected_output: null,
    })
    const without = buildJudgePrompt('Is it correct?', 'Paris', { scale_min: 0, scale_max: 1 })
    expect(withNull).not.toContain('Reference (expected) answer')
    expect(withNull).toBe(without)
  })
})

// ── P1-7: rubric + few-shot calibration anchors ─────────────────────────────
describe('buildJudgePrompt — rubric', () => {
  it('injects the rubric block when present', () => {
    const prompt = buildJudgePrompt('Is it helpful?', 'Paris', {
      scale_min: 0,
      scale_max: 1,
      rubric: '1.0 = fully correct; 0 = wrong',
    })
    expect(prompt).toContain('Scoring rubric (apply consistently):')
    expect(prompt).toContain('1.0 = fully correct; 0 = wrong')
  })

  it('omits the rubric block when absent (byte-identical to before)', () => {
    const withEmpty = buildJudgePrompt('Is it helpful?', 'Paris', {
      scale_min: 0,
      scale_max: 1,
      rubric: '   ',
    })
    const without = buildJudgePrompt('Is it helpful?', 'Paris', { scale_min: 0, scale_max: 1 })
    expect(withEmpty).not.toContain('Scoring rubric')
    expect(withEmpty).toBe(without)
  })
})

describe('buildJudgePrompt — calibration anchors', () => {
  it('injects anchors on the NUMERIC / legacy path', () => {
    const prompt = buildJudgePrompt('Is it helpful?', 'Paris', {
      scale_min: 0,
      scale_max: 1,
      anchors: [
        { response: 'A complete, correct answer', score: 1, reasoning: 'nailed it' },
        { response: 'Totally wrong', score: 0 },
      ],
    })
    expect(prompt).toContain('Calibration examples (anchor your scoring to these):')
    expect(prompt).toContain('A complete, correct answer')
    expect(prompt).toContain('→ score 1')
    expect(prompt).toContain('(nailed it)')
    expect(prompt).toContain('→ score 0')
  })

  it('flattens newlines inside an anchor response to keep one line per example', () => {
    const prompt = buildJudgePrompt('crit', 'resp', {
      scale_min: 0,
      scale_max: 1,
      anchors: [{ response: 'line one\nline two', score: 0.5 }],
    })
    expect(prompt).toContain('line one line two')
    expect(prompt).not.toContain('line one\nline two')
  })

  it('does NOT inject numeric anchors on a typed (BOOLEAN) config', () => {
    const sc: TypedScoreConfig = {
      id: 'a', data_type: 'BOOLEAN',
      min_value: null, max_value: null, categories: null,
      bool_true_label: null, bool_false_label: null,
    }
    const prompt = buildJudgePrompt('crit', 'resp', {
      scale_min: 0,
      scale_max: 1,
      score_config: sc,
      anchors: [{ response: 'x', score: 1 }],
    })
    expect(prompt).not.toContain('Calibration examples')
  })

  it('omits the anchors block when empty (byte-identical to before)', () => {
    const withEmpty = buildJudgePrompt('crit', 'resp', { scale_min: 0, scale_max: 1, anchors: [] })
    const without = buildJudgePrompt('crit', 'resp', { scale_min: 0, scale_max: 1 })
    expect(withEmpty).toBe(without)
  })
})

describe('buildJudgePrompt — NUMERIC score_config', () => {
  it('uses min/max from the score_config when present', () => {
    const sc: TypedScoreConfig = {
      id: 'a', data_type: 'NUMERIC', min_value: -1, max_value: 1,
      categories: null, bool_true_label: null, bool_false_label: null,
    }
    const prompt = buildJudgePrompt('foo', 'bar', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(prompt).toContain('between -1 and 1')
  })
})

describe('buildJudgePrompt — BOOLEAN score_config', () => {
  it('emits a boolean schema with custom labels', () => {
    const sc: TypedScoreConfig = {
      id: 'a', data_type: 'BOOLEAN',
      min_value: null, max_value: null, categories: null,
      bool_true_label: 'On brand', bool_false_label: 'Off brand',
    }
    const prompt = buildJudgePrompt('Persona check', 'abc', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(prompt).toContain('"value": <true or false>')
    expect(prompt).toContain('"On brand"')
    expect(prompt).toContain('"Off brand"')
  })

  it('falls back to pass/fail when labels are not configured', () => {
    const sc: TypedScoreConfig = {
      id: 'a', data_type: 'BOOLEAN',
      min_value: null, max_value: null, categories: null,
      bool_true_label: null, bool_false_label: null,
    }
    const prompt = buildJudgePrompt('foo', 'bar', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(prompt).toContain('"pass"')
    expect(prompt).toContain('"fail"')
  })
})

describe('buildJudgePrompt — CATEGORICAL score_config', () => {
  it('lists the categories as a JSON-friendly enum', () => {
    const sc: TypedScoreConfig = {
      id: 'a', data_type: 'CATEGORICAL',
      min_value: null, max_value: null,
      categories: ['Helpful', 'Neutral', 'Unhelpful'],
      bool_true_label: null, bool_false_label: null,
    }
    const prompt = buildJudgePrompt('Tone', 'abc', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(prompt).toContain('"Helpful"')
    expect(prompt).toContain('"Neutral"')
    expect(prompt).toContain('"Unhelpful"')
    expect(prompt).toContain('exact case match')
  })
})

describe('buildJudgePrompt — TEXT score_config', () => {
  it('asks for a short free-form string', () => {
    const sc: TypedScoreConfig = {
      id: 'a', data_type: 'TEXT',
      min_value: null, max_value: null, categories: null,
      bool_true_label: null, bool_false_label: null,
    }
    const prompt = buildJudgePrompt('Reviewer note', 'abc', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(prompt).toContain('"value": "<short answer>"')
    expect(prompt).toContain('under 200 characters')
  })
})

// ── parseJudgeReply ──────────────────────────────────────────────────────────

describe('parseJudgeReply — legacy NUMERIC path (score_config = null)', () => {
  it('parses {"score": 0.7, "reasoning": "..."}', () => {
    const r = parseJudgeReply('{"score": 0.7, "reasoning": "good answer"}', {
      scale_min: 0, scale_max: 1,
    })
    expect(r).not.toBeNull()
    expect(r?.score).toBe(0.7)
    expect(r?.value_number).toBe(0.7)
    expect(r?.value_string).toBeNull()
    expect(r?.value_boolean).toBeNull()
    expect(r?.reasoning).toBe('good answer')
  })

  it('clamps values outside [scale_min, scale_max]', () => {
    const r = parseJudgeReply('{"score": 1.5}', { scale_min: 0, scale_max: 1 })
    expect(r?.score).toBe(1)
  })

  it('strips ```json fences before parsing', () => {
    const r = parseJudgeReply('```json\n{"score": 0.5}\n```', {
      scale_min: 0, scale_max: 1,
    })
    expect(r?.score).toBe(0.5)
  })

  it('returns null on invalid JSON', () => {
    expect(parseJudgeReply('garbage', { scale_min: 0, scale_max: 1 })).toBeNull()
  })

  it('accepts {"value": <number>} as a synonym for "score"', () => {
    // The judge sometimes drifts between the two shapes; the parser
    // tolerates both on the legacy path.
    const r = parseJudgeReply('{"value": 0.4}', { scale_min: 0, scale_max: 1 })
    expect(r?.score).toBe(0.4)
  })
})

describe('parseJudgeReply — BOOLEAN', () => {
  const sc: TypedScoreConfig = {
    id: 'a', data_type: 'BOOLEAN',
    min_value: null, max_value: null, categories: null,
    bool_true_label: 'Pass', bool_false_label: 'Fail',
  }

  it('parses true', () => {
    const r = parseJudgeReply('{"value": true, "reasoning": "ok"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(r?.value_boolean).toBe(true)
    expect(r?.score).toBeNull()
    expect(r?.value_number).toBeNull()
  })

  it('parses false', () => {
    const r = parseJudgeReply('{"value": false}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(r?.value_boolean).toBe(false)
  })

  it('accepts "pass" / "fail" string aliases', () => {
    expect(parseJudgeReply('{"value": "pass"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })?.value_boolean).toBe(true)
    expect(parseJudgeReply('{"value": "fail"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })?.value_boolean).toBe(false)
  })

  it('rejects unrelated strings', () => {
    expect(parseJudgeReply('{"value": "maybe"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })).toBeNull()
  })
})

describe('parseJudgeReply — CATEGORICAL', () => {
  const sc: TypedScoreConfig = {
    id: 'a', data_type: 'CATEGORICAL',
    min_value: null, max_value: null,
    categories: ['Helpful', 'Neutral', 'Unhelpful'],
    bool_true_label: null, bool_false_label: null,
  }

  it('accepts a category from the allow-list', () => {
    const r = parseJudgeReply('{"value": "Helpful"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(r?.value_string).toBe('Helpful')
    expect(r?.value_number).toBeNull()
    expect(r?.value_boolean).toBeNull()
  })

  it('rejects categories not in the allow-list', () => {
    expect(parseJudgeReply('{"value": "Excellent"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })).toBeNull()
  })

  it('is case sensitive', () => {
    expect(parseJudgeReply('{"value": "helpful"}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })).toBeNull()
  })

  it('rejects non-string types', () => {
    expect(parseJudgeReply('{"value": 1}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })).toBeNull()
  })
})

describe('parseJudgeReply — TEXT', () => {
  const sc: TypedScoreConfig = {
    id: 'a', data_type: 'TEXT',
    min_value: null, max_value: null, categories: null,
    bool_true_label: null, bool_false_label: null,
  }

  it('accepts any non-empty trimmed string', () => {
    const r = parseJudgeReply('{"value": "  customer was happy  "}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })
    expect(r?.value_string).toBe('customer was happy')
  })

  it('rejects empty strings', () => {
    expect(parseJudgeReply('{"value": "   "}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })).toBeNull()
  })

  it('rejects non-string types', () => {
    expect(parseJudgeReply('{"value": 42}', {
      scale_min: 0, scale_max: 1, score_config: sc,
    })).toBeNull()
  })
})
