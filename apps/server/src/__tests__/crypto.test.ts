import { describe, it, expect, beforeEach } from 'vitest'
import { aes256Encrypt, aes256Decrypt } from '../lib/crypto.js'

beforeEach(() => {
  // 32 bytes base64
  process.env['ENCRYPTION_KEY'] = Buffer.from('a'.repeat(32)).toString('base64')
})

describe('aes256Encrypt / aes256Decrypt (Web Crypto)', () => {
  it('round-trips plaintext', async () => {
    const plain = 'sk-test-supersecret-key-1234567890'
    const cipher = await aes256Encrypt(plain)
    expect(cipher).not.toBe(plain)
    expect(await aes256Decrypt(cipher)).toBe(plain)
  })

  it('produces different ciphertexts for same input (random IV)', async () => {
    const plain = 'same-input'
    expect(await aes256Encrypt(plain)).not.toBe(await aes256Encrypt(plain))
  })

  it('returns empty string on tampered ciphertext', async () => {
    const cipher = await aes256Encrypt('value')
    const tampered = cipher.slice(0, -4) + 'XXXX'
    expect(await aes256Decrypt(tampered)).toBe('')
  })

  it('returns empty string on wrong key', async () => {
    const cipher = await aes256Encrypt('secret')
    process.env['ENCRYPTION_KEY'] = Buffer.from('b'.repeat(32)).toString('base64')
    expect(await aes256Decrypt(cipher)).toBe('')
  })
})
