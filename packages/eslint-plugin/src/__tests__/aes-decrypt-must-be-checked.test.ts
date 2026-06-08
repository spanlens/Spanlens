import { RuleTester } from '@typescript-eslint/rule-tester'
import { afterAll, describe, it } from 'vitest'

import { aesDecryptMustBeChecked } from '../rules/aes-decrypt-must-be-checked.js'

// RuleTester hooks into the test runner's lifecycle. Wiring vitest's
// describe/it/afterAll explicitly is required when not running under jest.
RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const ruleTester = new RuleTester()

ruleTester.run('aes-decrypt-must-be-checked', aesDecryptMustBeChecked, {
  valid: [
    // Pattern 1: truthy check + throw (matches eval-runner.ts, experiment-runner.ts).
    {
      code: `
async function f() {
  const key = await aes256Decrypt(cipher)
  if (!key) throw new Error('decrypt failed')
  useKey(key)
}
      `,
    },
    // Pattern 2: length === 0 check + early return (matches proxy/utils.ts).
    {
      code: `
async function f() {
  const decrypted = await aes256Decrypt(data.encrypted_key)
  if (decrypted.length === 0) return null
  useKey(decrypted)
}
      `,
    },
    // Pattern 3: strict-equal empty string.
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  if (k === '') return null
  useKey(k)
}
      `,
    },
    // Pattern 4: combined boolean.
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  if (!k || k.length === 0) {
    throw new Error('decrypt failed')
  }
  useKey(k)
}
      `,
    },
    // Pattern 5: check three statements down (still inside the window).
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  log('decrypted')
  metric.inc('decrypt-attempts')
  if (!k) return null
  useKey(k)
}
      `,
    },
    // Pattern 6: !key.length unary on member expression.
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  if (!k.length) return null
  useKey(k)
}
      `,
    },
    // Pattern 7: reassignment with subsequent check (matches experiment-runner.ts:473).
    {
      code: `
async function f() {
  let judgeApiKey = ''
  if (jk) {
    judgeApiKey = await aes256Decrypt(jk.encrypted_key)
    if (!judgeApiKey) throw new Error('Failed to decrypt judge key')
  }
}
      `,
    },
    // Pattern 8: nested check inside if block (matches leak-detection.ts:120).
    {
      code: `
async function f() {
  const plaintext = await aes256Decrypt(key.encrypted_key)
  if (!plaintext) {
    throw new Error('decryption returned empty string')
  }
  return plaintext
}
      `,
    },
  ],
  invalid: [
    // Missing check entirely.
    {
      code: `
async function f() {
  const key = await aes256Decrypt(cipher)
  useKey(key)
}
      `,
      errors: [{ messageId: 'missingCheck' }],
    },
    // Discarded await (no binding at all).
    {
      code: `
async function f() {
  await aes256Decrypt(cipher)
}
      `,
      errors: [{ messageId: 'noBinding' }],
    },
    // Check too far away — outside the 3-statement window.
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  log('a')
  log('b')
  log('c')
  log('d')
  if (!k) return null
  useKey(k)
}
      `,
      errors: [{ messageId: 'missingCheck' }],
    },
    // Wrong variable checked.
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  const other = 'a'
  if (!other) return null
  useKey(k)
}
      `,
      errors: [{ messageId: 'missingCheck' }],
    },
    // Truthy assertion (if (k)) is NOT a valid check — that's "use only if
    // non-empty," but the convention is to bail on empty, not to silently
    // skip.
    {
      code: `
async function f() {
  const k = await aes256Decrypt(x)
  if (k) {
    useKey(k)
  }
}
      `,
      errors: [{ messageId: 'missingCheck' }],
    },
  ],
})
