import { describe, expect, it } from 'vitest'
import { createStreamCapture } from './stream-capture.js'

describe('createStreamCapture', () => {
  it('keeps everything while the stream fits in the head', () => {
    const capture = createStreamCapture({ headChars: 10, tailChars: 5 })
    for (const piece of ['ab', 'cd', 'ef']) capture.push(piece)
    expect(capture.pieces()).toEqual(['ab', 'cd', 'ef'])
    expect(capture.joined('\n')).toBe('abcdef')
    expect(capture.droppedChars()).toBe(0)
  })

  it('once the head is full, keeps a sliding tail and counts what it dropped', () => {
    const capture = createStreamCapture({ headChars: 4, tailChars: 4 })
    for (const piece of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']) capture.push(piece)
    expect(capture.pieces()).toEqual(['aa', 'bb', 'ee', 'ff'])
    expect(capture.droppedChars()).toBe(4)
    expect(capture.joined('|')).toBe('aabb|eeff')
  })

  it('never evicts the newest piece, even when it alone exceeds the tail budget', () => {
    // The final usage chunk must survive its own size.
    const capture = createStreamCapture({ headChars: 2, tailChars: 3 })
    for (const piece of ['aa', 'bb', 'usage-chunk-longer-than-the-tail']) capture.push(piece)
    const kept = capture.pieces()
    expect(kept[0]).toBe('aa')
    expect(kept[kept.length - 1]).toBe('usage-chunk-longer-than-the-tail')
  })

  it('does not reopen the head after the first piece that did not fit', () => {
    // Order matters: a small piece arriving after the head overflowed must go
    // to the tail, or head and tail would interleave out of stream order.
    const capture = createStreamCapture({ headChars: 4, tailChars: 100 })
    for (const piece of ['aaa', 'bbbb', 'c']) capture.push(piece)
    expect(capture.pieces()).toEqual(['aaa', 'bbbb', 'c'])
    expect(capture.joined('')).toBe('aaabbbbc')
  })

  it('stays bounded over a long stream', () => {
    const capture = createStreamCapture({ headChars: 100, tailChars: 100 })
    for (let i = 0; i < 100_000; i++) capture.push(`line-${i}`)
    const kept = capture.pieces().join('')
    expect(kept.length).toBeLessThanOrEqual(200 + 'line-99999'.length)
    expect(capture.pieces().at(-1)).toBe('line-99999')
  })
})
