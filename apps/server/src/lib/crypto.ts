/**
 * AES-256-GCM 암/복호화 — Web Crypto API 기반 (Edge Runtime 호환).
 *
 * 저장 포맷 (기존 Node.js crypto와 바이너리 호환):
 *   base64(iv[12] || tag[16] || ciphertext[N])
 *
 * Web Crypto의 encrypt()는 `ciphertext || tag`를 이어 붙여 반환하므로,
 * 저장 시 tag를 앞쪽으로 옮기고 복호화 시 다시 뒤로 옮깁니다.
 */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const key = process.env['ENCRYPTION_KEY']
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
  const keyBytes = base64ToBytes(key)
  if (keyBytes.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (base64 encoded)')
  }
  // Cast Uint8Array to ArrayBuffer for Web Crypto compatibility
  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function aes256Encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = new TextEncoder().encode(plaintext)

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALGORITHM, iv: iv as BufferSource }, key, encoded as BufferSource),
  )

  // Web Crypto output: ciphertext || tag (tag is last 16 bytes)
  // Storage format:    iv || tag || ciphertext
  const cipherOnly = encrypted.subarray(0, encrypted.length - TAG_LENGTH)
  const tag = encrypted.subarray(encrypted.length - TAG_LENGTH)

  const result = new Uint8Array(IV_LENGTH + TAG_LENGTH + cipherOnly.length)
  result.set(iv, 0)
  result.set(tag, IV_LENGTH)
  result.set(cipherOnly, IV_LENGTH + TAG_LENGTH)

  return bytesToBase64(result)
}

export async function aes256Decrypt(ciphertext: string): Promise<string> {
  try {
    const buf = base64ToBytes(ciphertext)
    if (buf.length < IV_LENGTH + TAG_LENGTH) return ''

    const iv = buf.subarray(0, IV_LENGTH)
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const cipherOnly = buf.subarray(IV_LENGTH + TAG_LENGTH)

    // Web Crypto expects: ciphertext || tag
    const combined = new Uint8Array(cipherOnly.length + tag.length)
    combined.set(cipherOnly, 0)
    combined.set(tag, cipherOnly.length)

    const key = await getEncryptionKey()
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv as BufferSource },
      key,
      combined as BufferSource,
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return ''
  }
}
