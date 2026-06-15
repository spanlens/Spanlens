import { describe, expect, it } from 'vitest'
import {
  serializeTrajectory,
  buildTrajectoryJudgePrompt,
  type TrajectorySpan,
  type TrajectoryTrace,
} from '../lib/eval-runners/trajectory.js'

const trace: TrajectoryTrace = { name: 'support-agent', status: 'completed', duration_ms: 1234 }

function span(over: Partial<TrajectorySpan>): TrajectorySpan {
  return {
    name: 'step',
    span_type: 'llm',
    status: 'completed',
    input: null,
    output: null,
    error_message: null,
    started_at: '2026-06-15T00:00:00.000Z',
    ...over,
  }
}

describe('serializeTrajectory', () => {
  it('returns empty string when there are no spans', () => {
    expect(serializeTrajectory(trace, [])).toBe('')
  })

  it('renders a header with trace name, step count, and duration', () => {
    const out = serializeTrajectory(trace, [span({})])
    expect(out).toContain('Agent trace: "support-agent"')
    expect(out).toContain('overall status: completed')
    expect(out).toContain('1 steps')
    expect(out).toContain('1234ms total')
  })

  it('orders steps by start time, not array order', () => {
    const out = serializeTrajectory(trace, [
      span({ name: 'second', started_at: '2026-06-15T00:00:02.000Z' }),
      span({ name: 'first', started_at: '2026-06-15T00:00:01.000Z' }),
    ])
    const firstIdx = out.indexOf('first')
    const secondIdx = out.indexOf('second')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(out).toContain('Step 1 [llm] first')
    expect(out).toContain('Step 2 [llm] second')
  })

  it('renders span_type, input, output, and error', () => {
    const out = serializeTrajectory(trace, [
      span({ span_type: 'tool', name: 'search', input: { q: 'weather' }, output: 'sunny', status: 'completed' }),
      span({ span_type: 'llm', name: 'answer', status: 'error', error_message: 'rate limited', started_at: '2026-06-15T00:00:01.000Z' }),
    ])
    expect(out).toContain('[tool] search')
    expect(out).toContain('Input: {"q":"weather"}')
    expect(out).toContain('Output: sunny')
    expect(out).toContain('(status: error)')
    expect(out).toContain('Error: rate limited')
  })

  it('collapses whitespace and truncates long values', () => {
    const longOutput = 'x'.repeat(5000)
    const out = serializeTrajectory(trace, [span({ output: longOutput })])
    // Each step's output is capped well under the raw length.
    expect(out.length).toBeLessThan(2000)
  })
})

describe('buildTrajectoryJudgePrompt', () => {
  it('frames the task as judging a trajectory and asks for a numeric score', () => {
    const prompt = buildTrajectoryJudgePrompt('Did the agent resolve the ticket?', 'Step 1 ...', {
      scale_min: 0,
      scale_max: 1,
    })
    expect(prompt).toContain('TRAJECTORY')
    expect(prompt).toContain('Criterion: Did the agent resolve the ticket?')
    expect(prompt).toContain('Step 1 ...')
    expect(prompt).toContain('"score": <number between 0 and 1>')
    expect(prompt).toMatch(/tool/i)
  })

  it('injects the rubric when present', () => {
    const prompt = buildTrajectoryJudgePrompt('crit', 'traj', { scale_min: 0, scale_max: 1, rubric: 'no redundant tool calls' })
    expect(prompt).toContain('Scoring rubric (apply consistently):')
    expect(prompt).toContain('no redundant tool calls')
  })

  it('omits the rubric block when absent', () => {
    const prompt = buildTrajectoryJudgePrompt('crit', 'traj', { scale_min: 0, scale_max: 1 })
    expect(prompt).not.toContain('Scoring rubric')
  })
})
