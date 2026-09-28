// Node.js 20.6+. Preview: node customer-cost.mjs --dry-run
// Run: node --env-file=.env customer-cost.mjs
// Real runs make three billable OpenAI calls through the Spanlens proxy.
const calls = [
  { customer: 'example-customer-a', feature: 'support-reply', prompt: 'Write one friendly sentence confirming a support ticket was received.' },
  { customer: 'example-customer-a', feature: 'summarize', prompt: 'Summarize in one sentence: The customer needs to reset their password and update their billing address.' },
  { customer: 'example-customer-b', feature: 'support-reply', prompt: 'Write one friendly sentence explaining that an order is being prepared.' },
]

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--dry-run')) throw new Error('Usage: node customer-cost.mjs [--dry-run]')
  const model = process.env.SPANLENS_EXAMPLE_MODEL || 'gpt-4o-mini'
  if (args.includes('--dry-run')) {
    console.log('Preview only. No requests sent and no API key needed.')
    console.table(calls.map(({ customer, feature }) => ({ customer, feature, model })))
    return
  }

  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) throw new Error('Set SPANLENS_API_KEY in .env to your project’s active full key. Register an OpenAI provider key under it in /projects.')
  const endpoint = new URL(process.env.SPANLENS_EXAMPLE_ENDPOINT || 'https://api.spanlens.io/proxy/openai/v1/chat/completions')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new Error('The endpoint must use HTTPS, or HTTP on localhost for self-hosted testing.')
  }
  if (endpoint.username || endpoint.password) throw new Error('Do not put credentials in the endpoint URL.')

  console.log('Sending three short requests. Standard provider charges apply.')
  const runId = Date.now().toString(36)
  for (const call of calls) {
    const session = `${call.feature}:${runId}`
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'x-spanlens-user': call.customer,
        'x-spanlens-session': session,
        'x-spanlens-log-body': 'meta',
      },
      body: JSON.stringify({ model, max_tokens: 64, messages: [{ role: 'user', content: call.prompt }] }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status} for ${call.customer}/${call.feature}. Check your Spanlens key, the OpenAI provider key registered under it, model access, and quota. Completed calls may already be logged; this script does not retry.`)
    }
    const result = await response.json()
    console.log(`${call.customer} / ${session}: ${result.usage?.total_tokens ?? 'unknown'} tokens`)
  }
  console.log('Open /requests to verify the three rows, then /users to compare the two example customers. Filter requests by user and inspect Session for the feature. Logs arrive asynchronously; refresh if needed.')
}

main().catch((error) => {
  console.error(error.name === 'TimeoutError' ? 'Request timed out. Check /requests before running again; the provider may already have completed the call.' : error.message)
  process.exitCode = 1
})
