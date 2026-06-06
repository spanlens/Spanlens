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
