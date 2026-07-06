import { IntegrationTemplate } from '@/components/marketing/integration-template'

const DESCRIPTION =
  'Log every OpenAI API call with Spanlens. Track cost, latency, tokens, streaming, tool use, and full request and response bodies. One-line integration, MIT licensed, self-hostable.'

export const metadata = {
  alternates: { canonical: '/integrations/openai' },
  title: 'OpenAI Observability — Spanlens Integration',
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'OpenAI Observability — Log every API call with Spanlens',
    description: DESCRIPTION,
    url: '/integrations/openai',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenAI Observability — Log every API call with Spanlens',
    description: DESCRIPTION,
  },
}

export default function OpenAIIntegrationPage() {
  return (
    <IntegrationTemplate
      provider="OpenAI"
      slug="openai"
      providerUrl="https://platform.openai.com/docs"
      tagline="Drop-in proxy for the OpenAI API. One line of code, every call captured."
      intro="Spanlens captures every OpenAI request your app makes — chat completions, embeddings, vision, audio, tool use, and structured outputs — without changing your business logic. Swap the SDK import or the baseURL and the existing OpenAI client keeps working with full observability layered underneath."
      captured={[
        'Chat completions (GPT-4o, GPT-4o-mini, GPT-4.1, o1, o3-mini)',
        'Embeddings (text-embedding-3-small/large, ada-002)',
        'Tool calls and function calling',
        'Streaming responses (full chunk capture with usage from final chunk)',
        'JSON mode and structured outputs',
        'Vision (image_url + base64)',
        'Audio (Whisper, TTS)',
        'Token counts and per-request cost in USD',
      ]}
      steps={[
        {
          title: 'Get a Spanlens API key',
          body: 'Sign up at spanlens.io and create a project. Copy the sl_live_* API key from the project dashboard.',
        },
        {
          title: 'Install the SDK (TypeScript or Python)',
          body: 'The drop-in SDK preserves the OpenAI surface area — same methods, same types — and routes calls through Spanlens.',
          code: `# TypeScript
npm install @spanlens/sdk

# Python
pip install spanlens`,
        },
        {
          title: 'Swap your import',
          body: 'Replace the OpenAI import with the Spanlens drop-in. No other code changes needed.',
          code: `// Before
import OpenAI from 'openai'
const openai = new OpenAI()

// After
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI() // reads SPANLENS_API_KEY from env`,
        },
        {
          title: 'Or use the proxy (any language)',
          body: 'If you cannot install an SDK (Ruby, Go, Rust, raw HTTP), point the OpenAI baseURL at the Spanlens proxy and put your Spanlens key in the Authorization header.',
          code: `curl https://api.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer sl_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`,
        },
        {
          title: 'Watch the dashboard',
          body: 'Every call lands in /requests within ~1 second with full body, model, tokens, latency, and cost. Filter, group, and replay.',
        },
      ]}
      faqs={[
        {
          q: 'Does Spanlens support OpenAI streaming?',
          a: 'Yes. Streaming chunks pass through to your client in real time via body.tee(), and Spanlens captures the full stream including usage data from the final chunk. Streaming responses count as one request.',
        },
        {
          q: 'Does Spanlens support OpenAI tool use and function calling?',
          a: 'Yes. Tool calls, tool results, parallel tool calls, and required tool use are all captured. The tool name, arguments, and outputs are visible in the request detail view and surface in agent tracing as separate spans.',
        },
        {
          q: 'How does Spanlens calculate OpenAI cost?',
          a: 'Cost is calculated per request from input + output tokens against the model price table. OpenAI returns the dated variant name (gpt-4o-mini-2024-07-18) in the response, and Spanlens matches by exact dated name then falls back to prefix match. Updated model prices ship with each release.',
        },
        {
          q: 'Is the OpenAI API key stored securely?',
          a: 'Yes. Your OpenAI key is encrypted at rest with AES-256-GCM and never logged. It is fetched, decrypted, and immediately discarded on each proxy call. The decryption key is held in environment-only configuration.',
        },
        {
          q: 'Does Spanlens work with Azure OpenAI?',
          a: 'Yes. Azure OpenAI endpoints are supported through the same proxy mechanism. Specify the Azure resource and deployment in your project settings, and the proxy routes to the right endpoint while logging the same shape of data.',
        },
        {
          q: 'Can I use Spanlens with the OpenAI Assistants API?',
          a: 'Yes. Assistant runs are captured per LLM step, and thread + run + step IDs surface as tags so you can filter or pivot on them. Multi-step agent flows render as a span tree.',
        },
      ]}
    />
  )
}
