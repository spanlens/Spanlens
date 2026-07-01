import { describe, it, expect } from 'vitest'
import { createOllama, DEFAULT_OLLAMA_BASE_URL, observeOllama } from '../integrations/ollama.js'

describe('createOllama', () => {
  it('defaults to the local Ollama endpoint', () => {
    const client = createOllama()
    expect(client.baseURL).toBe(DEFAULT_OLLAMA_BASE_URL)
  })

  it('uses a throwaway apiKey by default (Ollama ignores it)', () => {
    const client = createOllama()
    expect(client.apiKey).toBe('ollama')
  })

  it('does not require SPANLENS_API_KEY (Ollama is local, no proxy)', () => {
    const original = process.env.SPANLENS_API_KEY
    delete process.env.SPANLENS_API_KEY
    try {
      expect(() => createOllama()).not.toThrow()
    } finally {
      if (original !== undefined) process.env.SPANLENS_API_KEY = original
    }
  })

  it('accepts a baseURL override for a remote Ollama host', () => {
    const client = createOllama({ baseURL: 'http://gpu-box.local:11434/v1' })
    expect(client.baseURL).toBe('http://gpu-box.local:11434/v1')
  })

  it('accepts an apiKey override', () => {
    const client = createOllama({ apiKey: 'custom' })
    expect(client.apiKey).toBe('custom')
  })

  it('re-exports observeOllama for single-import ergonomics', () => {
    expect(typeof observeOllama).toBe('function')
  })
})
