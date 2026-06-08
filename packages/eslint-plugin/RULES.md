# @spanlens/eslint-plugin rules

Spanlens-internal ESLint rules. Each rule guards a silent-data-loss
pattern the TypeScript type system cannot catch on its own.

---

## `aes-decrypt-must-be-checked`

**Type**: problem · **Level**: error · **Auto-fixable**: no

`apps/server/src/lib/crypto.ts:aes256Decrypt()` is a `Promise<string>`
that returns the empty string `""` on every failure mode (wrong key,
tampered ciphertext, malformed input, etc.) instead of throwing. The
design is intentional — a thrown error inside the proxy hot path
would crash a request that the upstream provider could still serve
with a different key — but it means every caller has to **explicitly
check for the empty string** before using the result. A missed check
silently sends an empty `Authorization` header to OpenAI and produces
a 401 the customer has no way to debug.

### What the rule enforces

For every `await aes256Decrypt(...)` expression, the rule requires one
of these patterns within the same block, in the next three
statements:

```ts
// 1. truthy check + throw / return / continue
const key = await aes256Decrypt(cipher)
if (!key) throw new Error('decrypt failed')
useKey(key)
```

```ts
// 2. length-zero check + early return
const key = await aes256Decrypt(cipher)
if (key.length === 0) return null
useKey(key)
```

```ts
// 3. strict-equal empty string
const key = await aes256Decrypt(cipher)
if (key === '') return null
useKey(key)
```

```ts
// 4. combined boolean
const key = await aes256Decrypt(cipher)
if (!key || key.length === 0) {
  throw new Error('decrypt failed')
}
useKey(key)
```

### What the rule rejects

```ts
// MISSING check — fails the rule
const key = await aes256Decrypt(cipher)
useKey(key) // ← rule fires on the await above
```

```ts
// Discarding the result — fails the rule
await aes256Decrypt(cipher)
// nothing to check; the rule cannot prove the caller looked at the
// return value, so it conservatively rejects.
```

### Why so strict?

This rule is intentionally conservative. False positives ("I had a
check three statements down") are fixable in one line; false
negatives leak production decryption failures into customer 401s
with no error log. The cost is asymmetric.

If a call site truly does not care about the return value (e.g. a
sanity test where the empty string is the expected output), wrap the
call in a `// eslint-disable-next-line @spanlens/aes-decrypt-must-be-checked`
comment and explain why in the comment body. Searchable trail, opt-out
visible in review.

### Escape hatch for tests

`*.test.ts` and `__tests__/` files are exempt — the rule is scoped to
production code via the host config's `files: ['src/**/*.ts']`
override. If you add a new test directory layout, mirror that override
or the rule will fire on assertion-style calls
(`expect(await aes256Decrypt(...)).toBe('')`).

### Rationale

`crypto.ts:aes256Decrypt` is one of the most footgun-prone primitives
in the codebase. The function comment warns about it; CLAUDE.md
mentions it (`apps/server/src/lib/crypto.ts:81-105` returns empty
string silently); reviewers catch the missing check most of the time.
But "most of the time" is the wrong reliability bar for a primitive
that decrypts production provider keys, so we encode the convention
as a lint rule instead of a tradition.
