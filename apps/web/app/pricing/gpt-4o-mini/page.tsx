import { ModelPricingTemplate } from '@/components/marketing/model-pricing-template'

const DESCRIPTION =
  'GPT-4o-mini pricing: $0.15 per 1M input tokens, $0.60 per 1M output. About 15x cheaper than GPT-4o. Monthly cost estimates, when to use it vs GPT-4o, and how to track with Spanlens.'

export const metadata = {
  alternates: { canonical: '/pricing/gpt-4o-mini' },
  title: 'GPT-4o-mini Pricing 2026 — Cost Per Token, Monthly Estimates',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'GPT-4o-mini Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    url: '/pricing/gpt-4o-mini',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GPT-4o-mini Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

export default function GPT4oMiniPricingPage() {
  return (
    <ModelPricingTemplate
      model="GPT-4o-mini"
      slug="gpt-4o-mini"
      provider="OpenAI"
      providerUrl="https://openai.com/api/pricing/"
      tagline="OpenAI's small, fast, cheap general-purpose model. $0.15 per 1M input, $0.60 per 1M output. About 15x cheaper than GPT-4o."
      inputPricePer1M={0.15}
      outputPricePer1M={0.6}
      cachedInputPricePer1M={0.075}
      contextWindow="128K tokens"
      maxOutput="16K tokens"
      released="2024-07"
      bestFor={[
        'Intent classification and routing',
        'Structured output extraction',
        'Short-form generation (one-paragraph replies, summaries)',
        'Agent sub-tasks that do not need frontier reasoning',
        'High-volume APIs where cost is the primary constraint',
      ]}
      scenarios={[
        { label: 'Intent classifier', inputTokens: 300, outputTokens: 20, requestsPerMonth: 500_000 },
        { label: 'Short chat replies', inputTokens: 800, outputTokens: 200, requestsPerMonth: 100_000 },
        { label: 'Structured extraction', inputTokens: 2_000, outputTokens: 400, requestsPerMonth: 200_000 },
        { label: 'Agent sub-step', inputTokens: 1_200, outputTokens: 300, requestsPerMonth: 1_000_000 },
        { label: 'Very high volume', inputTokens: 500, outputTokens: 100, requestsPerMonth: 5_000_000 },
      ]}
      alternatives={[
        {
          name: 'GPT-4o',
          href: '/pricing/gpt-4o',
          note: 'Frontier quality at 15x the cost ($2.50 input / $10 output). Use when GPT-4o-mini fails on quality eval but only for the steps that need it.',
        },
        {
          name: 'Claude 3.5 Haiku',
          note: 'Anthropic small model at $0.80 input / $4.00 output. Roughly 5x more expensive than GPT-4o-mini on input, often higher quality on long-form writing.',
        },
        {
          name: 'Gemini 2.0 Flash',
          href: '/pricing/gemini-2-0-flash',
          note: 'Competitively priced ($0.10 input / $0.40 output). Slightly cheaper. Multimodal support is a plus over GPT-4o-mini for image inputs.',
        },
      ]}
      faqs={[
        {
          q: 'What is the GPT-4o-mini cost per 1M tokens in 2026?',
          a: 'GPT-4o-mini is priced at $0.15 per 1M input tokens and $0.60 per 1M output tokens. Cached input is $0.075 per 1M (50% off). It is roughly 15x cheaper than GPT-4o on input and 16x cheaper on output.',
        },
        {
          q: 'Is GPT-4o-mini good enough to replace GPT-4o?',
          a: 'For narrow tasks (classification, extraction, short replies) yes — almost always at no measurable quality regression. For complex multi-turn reasoning, long-form synthesis, or vision tasks requiring frontier quality, no. Run an eval on your real workload before swapping.',
        },
        {
          q: 'Does GPT-4o-mini support function calling and JSON mode?',
          a: 'Yes. Both function calling and the structured outputs / JSON mode APIs work with GPT-4o-mini at the same surface as GPT-4o. Tool use is reliable enough for most agent workflows.',
        },
        {
          q: 'What is the GPT-4o-mini context window?',
          a: '128K tokens of input, 16K maximum output. Same context envelope as GPT-4o. The mini in the name refers to model size, not context.',
        },
        {
          q: 'How fast is GPT-4o-mini?',
          a: 'Time-to-first-token is typically 200-400ms (faster than GPT-4o). Throughput in the streaming phase is also higher. For latency-sensitive workloads, the speed bump alongside the cost reduction is often the bigger win.',
        },
        {
          q: 'How do I track GPT-4o-mini spend per customer?',
          a: 'Tag each request with X-Spanlens-User: <customer_id>. Spanlens aggregates per-customer cost in /users so you can bill, alert on outliers, or detect runaway loops. See /integrations/openai.',
        },
      ]}
    />
  )
}
