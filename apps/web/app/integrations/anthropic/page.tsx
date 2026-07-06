import { IntegrationTemplate } from '@/components/marketing/integration-template'

const DESCRIPTION =
  'Log every Anthropic Claude API call with Spanlens. Track cost, latency, tokens, streaming, tool use, and full request and response bodies. One-line integration, MIT licensed, self-hostable.'

export const metadata = {
  alternates: { canonical: '/integrations/anthropic' },
  title: 'Anthropic Observability — Spanlens Integration',
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'Anthropic Claude Observability — Log every API call with Spanlens',
    description: DESCRIPTION,
    url: '/integrations/anthropic',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Anthropic Claude Observability — Log every API call with Spanlens',
    description: DESCRIPTION,
  },
}

export default function AnthropicIntegrationPage() {
  return (
    <IntegrationTemplate
      provider="Anthropic"
      slug="anthropic"
      providerUrl="https://docs.anthropic.com"
      tagline="Drop-in proxy for the Anthropic Messages API. One line of code, every Claude call captured."
      intro="Spanlens captures every Anthropic API call your app makes — Claude Opus, Sonnet, and Haiku, plus tool use, vision, and prompt caching — without changing your business logic. The Anthropic SDK keeps working unchanged with full observability layered underneath."
      captured={[
        'Messages API (Claude Opus, Sonnet, Haiku across 3, 3.5, 4 families)',
        'Streaming responses (with usage from message_delta — different from OpenAI)',
        'Tool use and parallel tool use',
        'Vision (image content blocks)',
        'Prompt caching (cached input tokens broken out in cost)',
        'Extended thinking (reasoning tokens captured)',
        'System prompts and stop reasons',
        'Token counts and per-request cost in USD',
      ]}
      steps={[
        {
          title: 'Get a Spanlens API key',
          body: 'Sign up at spanlens.io and create a project. Copy the sl_live_* API key from the project dashboard.',
        },
        {
          title: 'Install the SDK (TypeScript or Python)',
          body: 'The drop-in SDK mirrors the Anthropic surface area exactly.',
          code: `# TypeScript
npm install @spanlens/sdk @anthropic-ai/sdk

# Python
pip install spanlens anthropic`,
        },
        {
          title: 'Swap your import',
          body: 'Replace the Anthropic client constructor with the Spanlens drop-in. No other code changes needed.',
          code: `// Before
import Anthropic from '@anthropic-ai/sdk'
const anthropic = new Anthropic()

// After
import { createAnthropic } from '@spanlens/sdk/anthropic'
const anthropic = createAnthropic() // reads SPANLENS_API_KEY from env`,
        },
        {
          title: 'Or use the proxy (any language)',
          body: 'For languages without an SDK, point the Anthropic base URL at the Spanlens proxy and put your Spanlens key in the Authorization header. The x-api-key header for Anthropic auth is still passed through.',
          code: `curl https://api.spanlens.io/proxy/anthropic/v1/messages \\
  -H "Authorization: Bearer sl_live_..." \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-sonnet-4-5","max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}'`,
        },
        {
          title: 'Watch the dashboard',
          body: 'Every Claude call lands in /requests within ~1 second with input + output + cache token breakdown, latency, model variant, and cost.',
        },
      ]}
      faqs={[
        {
          q: 'Does Spanlens support Anthropic streaming?',
          a: 'Yes. Anthropic streams differ from OpenAI — usage data arrives in the message_delta event rather than the final chunk. Spanlens has provider-specific parsers that handle this, so token counts and cost are correct for streamed Claude responses.',
        },
        {
          q: 'Does Spanlens capture prompt caching usage?',
          a: 'Yes. cache_creation_input_tokens and cache_read_input_tokens are captured separately so you see the cache hit rate and the cost saved from caching. Cost calculation uses the discounted cache-read rate.',
        },
        {
          q: 'Does Spanlens work with Claude on AWS Bedrock?',
          a: 'Yes. Bedrock Claude calls route through the same proxy with SigV4 auth handled by your SDK. The provider key field stores your AWS credentials encrypted with AES-256-GCM.',
        },
        {
          q: 'How does Spanlens handle Anthropic extended thinking?',
          a: 'Reasoning tokens are captured as a separate field in the request detail view. They are billed by Anthropic as output tokens, and Spanlens reflects that in cost — but the visible split lets you see how much of your spend is reasoning vs final output.',
        },
        {
          q: 'Can I use Spanlens with Claude tool use and agents?',
          a: 'Yes. Tool input, tool result, and parallel tool use are all captured. For multi-step agent flows (e.g. Claude with a chain of tool calls), Spanlens renders a waterfall span tree with critical-path highlighting.',
        },
        {
          q: 'Is my Anthropic API key stored securely?',
          a: 'Yes. The Anthropic key is encrypted at rest with AES-256-GCM and never logged. It is decrypted only at proxy time and immediately discarded after the upstream call.',
        },
      ]}
    />
  )
}
