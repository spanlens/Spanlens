import { ModelPricingTemplate } from '@/components/marketing/model-pricing-template'

const DESCRIPTION =
  'Gemini 2.0 Flash pricing: $0.10 per 1M input tokens, $0.40 per 1M output. Significantly cheaper than GPT-4o-mini with full multimodal support. Monthly cost estimates and alternatives.'

export const metadata = {
  alternates: { canonical: '/pricing/gemini-2-0-flash' },
  title: 'Gemini 2.0 Flash Pricing 2026 — Cost Per Token, Monthly Estimates',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'Gemini 2.0 Flash Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    url: '/pricing/gemini-2-0-flash',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gemini 2.0 Flash Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
  },
}

export default function Gemini20FlashPricingPage() {
  return (
    <ModelPricingTemplate
      model="Gemini 2.0 Flash"
      slug="gemini-2-0-flash"
      provider="Google"
      providerUrl="https://ai.google.dev/pricing"
      tagline="Google's small fast multimodal model. $0.10 per 1M input, $0.40 per 1M output. Among the cheapest production-grade options."
      inputPricePer1M={0.1}
      outputPricePer1M={0.4}
      contextWindow="1M tokens"
      maxOutput="8K tokens"
      released="2024-12"
      bestFor={[
        'Very high volume APIs where cost dominates',
        'Multimodal inputs (image, video, audio)',
        'Long-context workloads (up to 1M tokens)',
        'Grounded responses with Google Search',
        'Workflows that previously used GPT-4o-mini',
      ]}
      scenarios={[
        { label: 'Intent classifier', inputTokens: 300, outputTokens: 20, requestsPerMonth: 1_000_000 },
        { label: 'Image captioning', inputTokens: 1_000, outputTokens: 100, requestsPerMonth: 200_000 },
        { label: 'Long doc summarizer', inputTokens: 100_000, outputTokens: 500, requestsPerMonth: 5_000 },
        { label: 'Agent sub-step', inputTokens: 1_500, outputTokens: 300, requestsPerMonth: 500_000 },
        { label: 'Massive scale', inputTokens: 500, outputTokens: 100, requestsPerMonth: 10_000_000 },
      ]}
      alternatives={[
        {
          name: 'GPT-4o-mini',
          href: '/pricing/gpt-4o-mini',
          note: 'OpenAI competitor at $0.15 input / $0.60 output. Slightly more expensive. Pick based on which has better quality on your eval; cost is close.',
        },
        {
          name: 'Gemini 1.5 Pro',
          note: 'Google larger model at $1.25 input / $5.00 output. Use for harder reasoning where Flash quality is insufficient.',
        },
        {
          name: 'Claude 3.5 Haiku',
          note: 'Anthropic small model at $0.80 input / $4.00 output. Significantly more expensive than Flash. Pick only if Anthropic\'s writing quality matters for your task.',
        },
      ]}
      faqs={[
        {
          q: 'What is the Gemini 2.0 Flash cost per 1M tokens in 2026?',
          a: 'Gemini 2.0 Flash is priced at $0.10 per 1M input tokens and $0.40 per 1M output tokens. Free tier is available via Google AI Studio with rate limits; paid tier (Vertex AI or AI Studio) starts at these prices.',
        },
        {
          q: 'What is the Gemini 2.0 Flash context window?',
          a: '1 million tokens. The largest production context window currently available. Useful for whole-document QA, multi-document summarization, and codebase-grounded tasks.',
        },
        {
          q: 'Is Gemini 2.0 Flash multimodal?',
          a: 'Yes. Image, video, audio, and PDF inputs are supported through inline parts or file references. Multimodal inputs are priced per token after Google internally converts media to tokens (about 258 tokens per image, varies by audio length).',
        },
        {
          q: 'Does Gemini 2.0 Flash support function calling?',
          a: 'Yes. Function declarations and function calls work the same as on Gemini 1.5 Pro. Parallel function calling and forced function calling are both supported.',
        },
        {
          q: 'AI Studio or Vertex AI?',
          a: 'AI Studio is the simplest setup with API key auth. Vertex AI offers regional endpoints, SLA, IAM integration, and service account auth. For production, Vertex is the better fit; for prototyping and low-volume, AI Studio is fine.',
        },
        {
          q: 'How do I monitor Gemini usage in production?',
          a: 'Capture every Gemini call with usageMetadata (input + output token counts), latency, model variant, and cost. Spanlens handles both AI Studio and Vertex endpoints — see /integrations/gemini.',
        },
      ]}
    />
  )
}
