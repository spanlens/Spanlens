import { ModelPricingTemplate } from '@/components/marketing/model-pricing-template'

const DESCRIPTION =
  'GPT-4o pricing: $2.50 per 1M input tokens, $10 per 1M output tokens, $1.25 cached input. Monthly cost scenarios, alternatives (GPT-4o-mini, Claude 3.5 Sonnet), and how to track usage with Spanlens.'

export const metadata = {
  alternates: { canonical: '/pricing/gpt-4o' },
  title: 'GPT-4o Pricing 2026 — Cost Per Token, Monthly Estimates',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'GPT-4o Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    url: '/pricing/gpt-4o',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GPT-4o Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

export default function GPT4oPricingPage() {
  return (
    <ModelPricingTemplate
      model="GPT-4o"
      slug="gpt-4o"
      provider="OpenAI"
      providerUrl="https://openai.com/api/pricing/"
      tagline="OpenAI's frontier general-purpose model. $2.50 per 1M input, $10 per 1M output, plus prompt caching at half price."
      inputPricePer1M={2.5}
      outputPricePer1M={10.0}
      cachedInputPricePer1M={1.25}
      contextWindow="128K tokens"
      maxOutput="16K tokens"
      released="2024-05, latest revision 2024-08"
      bestFor={[
        'Multimodal chat (text, image, audio)',
        'Complex multi-turn agents and tool use',
        'Vision tasks requiring frontier quality',
        'Production chat with strict latency requirements',
        'Replacing GPT-4-turbo (cheaper and faster)',
      ]}
      scenarios={[
        { label: 'Casual chatbot (small)', inputTokens: 500, outputTokens: 300, requestsPerMonth: 5_000 },
        { label: 'Production assistant (medium)', inputTokens: 1_500, outputTokens: 800, requestsPerMonth: 50_000 },
        { label: 'Long-context summarizer', inputTokens: 8_000, outputTokens: 1_200, requestsPerMonth: 20_000 },
        { label: 'RAG with system prompt', inputTokens: 3_000, outputTokens: 500, requestsPerMonth: 100_000 },
        { label: 'High-volume API (large)', inputTokens: 1_200, outputTokens: 600, requestsPerMonth: 1_000_000 },
      ]}
      alternatives={[
        {
          name: 'GPT-4o-mini',
          href: '/pricing/gpt-4o-mini',
          note: 'About 15x cheaper ($0.15 input / $0.60 output). Same multimodal surface. Use for classification, routing, and any narrow task where frontier quality is not required.',
        },
        {
          name: 'Claude 3.5 Sonnet',
          href: '/pricing/claude-3-5-sonnet',
          note: 'Comparable quality, $3.00 input / $15.00 output. Stronger at long-form writing and complex reasoning, slightly more expensive on output. Prompt caching is more generous than OpenAI.',
        },
        {
          name: 'Gemini 2.0 Flash',
          href: '/pricing/gemini-2-0-flash',
          note: 'Significantly cheaper ($0.10 input / $0.40 output) with multimodal support. Use when cost matters more than absolute quality on long-form reasoning.',
        },
        {
          name: 'o3-mini',
          note: 'OpenAI reasoning model ($1.10 input / $4.40 output). Cheaper than GPT-4o but optimized for reasoning workloads — slower TTFT, no vision.',
        },
      ]}
      faqs={[
        {
          q: 'What is the GPT-4o cost per 1M tokens in 2026?',
          a: 'GPT-4o is priced at $2.50 per 1M input tokens and $10 per 1M output tokens at the standard tier. Cached input is $1.25 per 1M (50% off). Batch API and provisioned throughput tiers have separate pricing.',
        },
        {
          q: 'How does GPT-4o pricing compare to GPT-4-turbo?',
          a: 'GPT-4o is cheaper. GPT-4-turbo was $10 input / $30 output. GPT-4o at $2.50 input / $10 output is roughly 3-4x cheaper across the board with comparable or better quality.',
        },
        {
          q: 'Does GPT-4o support prompt caching?',
          a: 'Yes. OpenAI automatically caches identical prefixes longer than 1024 tokens. Cached input tokens are billed at 50% — $1.25 per 1M instead of $2.50. Caching is automatic with no configuration needed; you can see cached_tokens in the usage response field.',
        },
        {
          q: 'What is the GPT-4o context window?',
          a: '128K tokens for the input, with 16K maximum output tokens. The full 128K is usable in a single request; OpenAI does not throttle context usage.',
        },
        {
          q: 'Can I run GPT-4o on Azure?',
          a: 'Yes. Azure OpenAI offers GPT-4o at the same per-token pricing under most regions. Azure adds availability SLAs and data-residency options; Spanlens works with both standard OpenAI and Azure endpoints.',
        },
        {
          q: 'How do I monitor GPT-4o costs in production?',
          a: 'Capture every call with model, input + output tokens, cost USD, and prompt version. Aggregate by customer, endpoint, and prompt to find the source of cost spikes. Spanlens does this in one line of code — see /integrations/openai.',
        },
      ]}
    />
  )
}
