/**
 * Lightweight fetch wrapper that never throws — observability SDKs must not
 * crash user code if the backend is unreachable or slow.
 */

import type { SpanlensConfig } from './types.js'

export interface Transport {
  post(path: string, body: unknown): Promise<unknown>
  patch(path: string, body: unknown): Promise<unknown>
}

export function createTransport(config: SpanlensConfig): Transport {
  const baseUrl = (config.baseUrl ?? 'https://spanlens-server.vercel.app').replace(/\/$/, '')
  const timeoutMs = config.timeoutMs ?? 3000
  const silent = config.silent ?? true
  const onError = config.onError

  async function call(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(`[spanlens] ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`)
        onError?.(err, `${method} ${path}`)
        if (!silent) throw err
        return null
      }

      // PATCH responses may be empty/void — parse defensively
      const text = await res.text()
      if (!text) return null
      try { return JSON.parse(text) } catch { return null }
    } catch (err) {
      onError?.(err, `${method} ${path}`)
      if (!silent) throw err
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
  }
}
