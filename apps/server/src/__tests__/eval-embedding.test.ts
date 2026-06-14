import { afterEach, describe, expect, test, vi } from 'vitest'
import { cosineSimilarity, scoreEmbedding } from '../lib/eval-runners/embedding.js'
import type { EmbeddingConfig } from '../lib/eval-runners/embedding.js'

/**
 * P2-12 embedding evaluator. cosineSimilarity is pure; scoreEmbedding wraps a
 * multi-provider /embeddings call. Tests pin: the math, the score shape
 * (cosine → 0..1 with threshold → value_boolean), azure routing (resource URL
 * + api-key header, NOT Gemini/Bearer), and null-on-failure.
 */

const OPENAI_CONFIG: EmbeddingConfig = { provider: 'openai', model: 'text-embedding-3-small' }

function mockEmbeddings(vectors: number[][], ok = true): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: vectors.map((v) => ({ embedding: v })), usage: { total_tokens: 12 } }),
    text: async () => '',
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cosineSimilarity', () => {
  test('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
  })
  test('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
  test('opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1)
  })
  test('degenerate input (empty / mismatched length / zero) → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1, 2], [1])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('scoreEmbedding', () => {
  test('returns cosine similarity as the score (clamped 0..1)', async () => {
    // response embedding == reference embedding → similarity 1.0
    mockEmbeddings([
      [1, 0, 0],
      [1, 0, 0],
    ])
    const outcome = await scoreEmbedding(OPENAI_CONFIG, 'response', 'reference', 'key', null)
    expect(outcome?.score).toBeCloseTo(1)
    expect(outcome?.value_number).toBeCloseTo(1)
    expect(outcome?.value_boolean).toBeNull() // no threshold
    expect(outcome?.reasoning).toContain('cosine similarity')
  })

  test('clamps a negative cosine to 0', async () => {
    mockEmbeddings([
      [1, 1],
      [-1, -1],
    ])
    const outcome = await scoreEmbedding(OPENAI_CONFIG, 'r', 'ref', 'key', null)
    expect(outcome?.score).toBe(0)
  })

  test('threshold sets value_boolean', async () => {
    mockEmbeddings([
      [1, 0],
      [1, 0],
    ])
    const pass = await scoreEmbedding({ ...OPENAI_CONFIG, threshold: 0.8 }, 'r', 'ref', 'key', null)
    expect(pass?.value_boolean).toBe(true)

    mockEmbeddings([
      [1, 0],
      [0, 1],
    ])
    const fail = await scoreEmbedding({ ...OPENAI_CONFIG, threshold: 0.8 }, 'r', 'ref', 'key', null)
    expect(fail?.value_boolean).toBe(false)
  })

  test('azure routes to the resource v1 endpoint with the api-key header', async () => {
    const fetchMock = mockEmbeddings([
      [1, 0],
      [1, 0],
    ])
    await scoreEmbedding(
      { provider: 'azure', model: 'text-embedding-3-small' },
      'r',
      'ref',
      'key',
      'https://my-res.openai.azure.com',
    )
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://my-res.openai.azure.com/openai/v1/embeddings')
    expect(url).not.toContain('generativelanguage.googleapis.com')
    expect(init.headers['api-key']).toBe('key')
    expect(init.headers['Authorization']).toBeUndefined()
  })

  test('returns null on a non-ok upstream response', async () => {
    mockEmbeddings([[1]], false)
    const outcome = await scoreEmbedding(OPENAI_CONFIG, 'r', 'ref', 'key', null)
    expect(outcome).toBeNull()
  })
})
