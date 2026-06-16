import { IntegrationTemplate } from '@/components/marketing/integration-template'

const DESCRIPTION =
  'Log every Google Gemini API call with Spanlens. Track cost, latency, tokens, streaming, function calling, and full request and response bodies. One-line integration, MIT licensed, self-hostable.'

export const metadata = {
  alternates: { canonical: '/integrations/gemini' },
  title: 'Gemini Observability — Spanlens Integration',
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'Google Gemini Observability — Log every API call with Spanlens',
    description: DESCRIPTION,
    url: '/integrations/gemini',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Google Gemini Observability — Log every API call with Spanlens',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

export default function GeminiIntegrationPage() {
  return (
    <IntegrationTemplate
      provider="Gemini"
      slug="gemini"
      providerUrl="https://ai.google.dev/gemini-api/docs"
      tagline="Drop-in proxy for the Google Gemini API. One line of code, every call captured."
      intro="Spanlens captures every Google Gemini request your app makes — Gemini Pro, Flash, and Flash-Lite, plus multimodal (image, audio, video), grounding, and function calling — without changing your business logic. Works with both AI Studio API keys and Vertex AI service accounts."
      captured={[
        'Generate content (Gemini 2.5 Pro, Flash, Flash-Lite, plus 1.5 family)',
        'Streaming responses (with usage from final candidates field)',
        'Function calling and tool use',
        'Multimodal (image, audio, video, PDF inline parts)',
        'Grounding with Google Search (groundingMetadata captured)',
        'Embeddings (text-embedding-004)',
        'Token counts and per-request cost in USD',
        'Both AI Studio (free tier) and Vertex AI (production) endpoints',
      ]}
      steps={[
        {
          title: 'Get a Spanlens API key',
          body: 'Sign up at spanlens.io and create a project. Copy the sl_live_* API key from the project dashboard.',
        },
        {
          title: 'Install the SDK (TypeScript or Python)',
          body: 'The drop-in SDK preserves the Google AI surface.',
          code: `# TypeScript
npm install @spanlens/sdk @google/generative-ai

# Python
pip install spanlens google-generativeai`,
        },
        {
          title: 'Swap your import',
          body: 'Replace the GoogleGenerativeAI client with the Spanlens drop-in. No other code changes needed.',
          code: `// Before
import { GoogleGenerativeAI } from '@google/generative-ai'
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// After
import { createGemini } from '@spanlens/sdk/gemini'
const genAI = createGemini() // reads SPANLENS_API_KEY from env`,
        },
        {
          title: 'Or use the proxy (any language)',
          body: 'For languages without an SDK, point the Gemini base URL at the Spanlens proxy and put your Spanlens key in the Authorization header.',
          code: `curl "https://api.spanlens.io/proxy/gemini/v1beta/models/gemini-2.5-flash:generateContent" \\
  -H "Authorization: Bearer sl_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"hello"}]}]}'`,
        },
        {
          title: 'Watch the dashboard',
          body: 'Every Gemini call lands in /requests within ~1 second with token counts, model variant, and cost. Multimodal parts are inspected in the request detail view.',
        },
      ]}
      faqs={[
        {
          q: 'Does Spanlens support Gemini streaming?',
          a: 'Yes. Gemini streams chunks via the streamGenerateContent endpoint, and Spanlens captures the full stream including usageMetadata from the final candidate. The original stream passes through to your client unmodified.',
        },
        {
          q: 'Does Spanlens support Gemini function calling?',
          a: 'Yes. Function declarations, function calls, and function responses are captured per turn. For multi-turn function-calling flows, Spanlens renders the conversation tree so you can see which call triggered which response.',
        },
        {
          q: 'Does Spanlens work with Vertex AI?',
          a: 'Yes. Vertex AI endpoints are supported alongside AI Studio. Specify the project ID and region in your Spanlens project settings, and authentication (service account JSON or ADC) is handled at proxy time without exposing the credential to logs.',
        },
        {
          q: 'How does Spanlens handle Gemini multimodal inputs?',
          a: 'Inline parts (image, audio, video, PDF) are captured by reference — Spanlens records the mime type and size but does not store the binary payload by default to keep logs lean. Set X-Spanlens-Log-Body: full to capture the full base64 payload.',
        },
        {
          q: 'How is Gemini cost calculated?',
          a: 'Cost is calculated from the candidatesTokenCount + promptTokenCount returned in usageMetadata against the Gemini price table. Free tier (AI Studio) requests are tracked with zero cost but still count toward your Spanlens quota.',
        },
        {
          q: 'Is my Gemini API key stored securely?',
          a: 'Yes. The Gemini API key (or Vertex service account JSON) is encrypted at rest with AES-256-GCM and never logged. It is decrypted only at proxy time and immediately discarded after the upstream call.',
        },
      ]}
    />
  )
}
