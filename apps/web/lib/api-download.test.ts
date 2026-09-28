// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// apiDownload is what every dashboard Export button calls. Pins the part the
// user cannot see for themselves: a response that fails partway through must
// reject and save nothing, instead of handing the browser a truncated file
// that looks complete (XVERIFY-2026-09-28 C10.3).

vi.mock('./supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'jwt-token' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }),
}))

import { ApiError, DownloadInterruptedError, apiDownload } from './api'

const fetchMock = vi.fn()
const createObjectURL = vi.fn((_blob: Blob) => 'blob:export')
const revokeObjectURL = vi.fn()
let clicked: HTMLAnchorElement[] = []

beforeEach(() => {
  fetchMock.mockReset()
  createObjectURL.mockClear()
  clicked = []
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const encoder = new TextEncoder()

/** A body that delivers `chunks`, then either ends or fails like a dropped connection. */
function body(chunks: string[], fail = false): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]!))
        return
      }
      if (fail) controller.error(new TypeError('terminated'))
      else controller.close()
    },
  })
}

describe('apiDownload', () => {
  test('saves the whole body under the given filename and reports progress', async () => {
    fetchMock.mockResolvedValue(new Response(body(['id,model\n', 'req_1,gpt\n']), { status: 200 }))
    const progress: number[] = []

    const result = await apiDownload('/api/v1/exports/requests?format=csv', 'spanlens-requests.csv', {
      onProgress: (bytes) => progress.push(bytes),
    })

    expect(result).toEqual({ bytes: 19 })
    expect(progress).toEqual([9, 19])
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer jwt-token' },
    })
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.size).toBe(19)
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.download).toBe('spanlens-requests.csv')
  })

  test('a body that fails partway through rejects and saves nothing', async () => {
    fetchMock.mockResolvedValue(new Response(body(['id,model\n', 'req_1,gpt\n'], true), { status: 200 }))

    await expect(apiDownload('/api/v1/exports/requests', 'x.csv')).rejects.toBeInstanceOf(
      DownloadInterruptedError,
    )
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(clicked).toHaveLength(0)
  })

  test('a failure before the first byte is interrupted too', async () => {
    fetchMock.mockResolvedValue(new Response(body([], true), { status: 200 }))
    await expect(apiDownload('/api/v1/exports/requests', 'x.csv')).rejects.toBeInstanceOf(
      DownloadInterruptedError,
    )
    expect(clicked).toHaveLength(0)
  })

  test('an error status surfaces the server message as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'from must be a valid ISO date' } },
        { status: 400 },
      ),
    )
    const err = await apiDownload('/api/v1/exports/requests?from=x', 'x.csv').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('from must be a valid ISO date')
    expect((err as ApiError).status).toBe(400)
    expect(clicked).toHaveLength(0)
  })
})
