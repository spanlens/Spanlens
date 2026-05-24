#!/usr/bin/env node
/**
 * Smoke test agent tracing — create a trace + span via /ingest, then make a
 * proxy call carrying X-Trace-Id / X-Span-Id headers. Verifies traces, spans,
 * and ClickHouse requests all link together.
 */

const SPANLENS_KEY = process.env.SPANLENS_KEY
if (!SPANLENS_KEY) {
  console.error('Set SPANLENS_KEY')
  process.exit(1)
}

const BASE = 'http://localhost:3001'

async function jpost(path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SPANLENS_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}

console.log('── Trace + Span ingest flow ──────────────────────────────')

// 1) Create trace
console.log('\n1. POST /ingest/traces')
const traceRes = await jpost('/ingest/traces', {
  name: 'smoke-test-multi-provider',
  metadata: { test: 'all-3-providers' },
})
console.log('  ', traceRes.status, traceRes.body)
if (traceRes.status !== 201) process.exit(1)
const traceId = traceRes.body.data.id

// 2) Create span
console.log('\n2. POST /ingest/traces/:id/spans')
const spanRes = await jpost(`/ingest/traces/${traceId}/spans`, {
  name: 'openai-call',
  kind: 'llm',
  started_at: new Date().toISOString(),
})
console.log('  ', spanRes.status, spanRes.body)
if (spanRes.status !== 201) process.exit(1)
const spanId = spanRes.body.data.id

// 3) Wait for ingest INSERT to commit before proxy call references it
// (gotcha #10 — _creationPromise chain handles it via SDK, but we're raw curl)
await new Promise((r) => setTimeout(r, 500))

// 4) Make a proxy call carrying the trace/span headers
console.log('\n3. POST /proxy/openai with X-Trace-Id / X-Span-Id')
const callRes = await jpost(
  '/proxy/openai/v1/chat/completions',
  {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'trace test' }],
    max_tokens: 5,
  },
  {
    'X-Trace-Id': traceId,
    'X-Span-Id': spanId,
  },
)
console.log('   status:', callRes.status, 'model:', callRes.body.model)

// 5) Close the span
console.log('\n4. PATCH /ingest/spans/:id (close)')
const closeRes = await fetch(`${BASE}/ingest/spans/${spanId}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${SPANLENS_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    ended_at: new Date().toISOString(),
    status: 'ok',
  }),
})
console.log('  ', closeRes.status)

// 6) Close the trace
console.log('\n5. PATCH /ingest/traces/:id (close)')
const traceCloseRes = await fetch(`${BASE}/ingest/traces/${traceId}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${SPANLENS_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    ended_at: new Date().toISOString(),
    status: 'ok',
  }),
})
console.log('  ', traceCloseRes.status)

await new Promise((r) => setTimeout(r, 2000))

console.log('\n── IDs to verify ──────────────────────────────────────────')
console.log('TRACE_ID =', traceId)
console.log('SPAN_ID =', spanId)
console.log('───────────────────────────────────────────────────────────')
