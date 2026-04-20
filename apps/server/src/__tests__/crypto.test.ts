import { describe, it, expect, beforeEach } from 'vitest'
import { aes256Encrypt, aes256Decrypt } from '../lib/crypto.js'

beforeEach(() => {
  // 32 bytes base64
  process.env.ENCRYPTION_KEY = Buffer.from('a'.repeat(32)).toString('base64')
})

describe('aes256Encrypt / aes256Decrypt', () => {
  it('round-trips plaintext', () => {
    const plain = 'sk-test-supersecret-key-1234567890'
    const cipher = aes256Encrypt(plain)
    expect(cipher).not.toBe(plain)
    expect(aes256Decrypt(cipher)).toBe(plain)
  })

  it('produces different ciphertexts for same input (random IV)', () => {
    const plain = 'same-input'
    expect(aes256Encrypt(plain)).not.toBe(aes256Encrypt(plain))
  })

  it('returns empty string on tampered ciphertext', () => {
    const cipher = aes256Encrypt('value')
    const tampered = cipher.slice(0, -4) + 'XXXX'
    expect(aes256Decrypt(tampered)).toBe('')
  })

  it('returns empty string on wrong key', () => {
    const cipher = aes256Encrypt('secret')
    process.env.ENCRYPTION_KEY = Buffer.from('b'.repeat(32)).toString('base64')
    expect(aes256Decrypt(cipher)).toBe('')
  })
})
