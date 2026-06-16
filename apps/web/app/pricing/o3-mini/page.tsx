import { ModelPricingTemplate } from '@/components/marketing/model-pricing-template'

const DESCRIPTION =
  'o3-mini pricing: $1.10 per 1M input tokens, $4.40 per 1M output. OpenAI reasoning model with deep chain-of-thought. Monthly cost scenarios and when to use it instead of GPT-4o.'

export const metadata = {
  alternates: { canonical: '/pricing/o3-mini' },
  title: 'o3-mini Pricing 2026 — Cost Per Token, Monthly Estimates',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'o3-mini Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    url: '/pricing/o3-mini',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'o3-mini Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

export default function O3MiniPricingPage() {
  return (
    <ModelPricingTemplate
      model="o3-mini"
      slug="o3-mini"
      provider="OpenAI"
      providerUrl="https://openai.com/api/pricing/"
      tagline="OpenAI reasoning model. $1.10 per 1M input, $4.40 per 1M output. Built for hard reasoning tasks with hidden chain-of-thought tokens."
      inputPricePer1M={1.1}
      outputPricePer1M={4.4}
      cachedInputPricePer1M={0.55}
      contextWindow="200K tokens"
      maxOutput="100K tokens"
      released="2026-01"
      bestFor={[
        'Math, coding, and STEM reasoning',
        'Multi-step planning tasks',
        'Agent steps where the LLM has to think before responding',
        'Tasks where chain-of-thought visibility (developer-only) matters',
        'Workloads previously handled by o1 at lower cost',
      ]}
      scenarios={[
        { label: 'Reasoning sub-step', inputTokens: 2_000, outputTokens: 3_000, requestsPerMonth: 10_000 },
        { label: 'Code reviewer', inputTokens: 8_000, outputTokens: 4_000, requestsPerMonth: 5_000 },
        { label: 'Hard agent planner', inputTokens: 4_000, outputTokens: 5_000, requestsPerMonth: 20_000 },
        { label: 'Math tutor', inputTokens: 1_500, outputTokens: 3_500, requestsPerMonth: 50_000 },
        { label: 'High-volume reasoning', inputTokens: 2_500, outputTokens: 4_000, requestsPerMonth: 100_000 },
      ]}
      alternatives={[
        {
          name: 'GPT-4o',
          href: '/pricing/gpt-4o',
          note: 'General-purpose at $2.50 input / $10 output. Better for chat, vision, and tool use. Worse at multi-step reasoning. Use as the default and route hard steps to o3-mini.',
        },
        {
          name: 'GPT-4o-mini',
          href: '/pricing/gpt-4o-mini',
          note: 'Cheaper general-purpose at $0.15 input / $0.60 output. Faster but not designed for reasoning. Use for routing and classification.',
        },
        {
          name: 'Claude 3.5 Sonnet',
          href: '/pricing/claude-3-5-sonnet',
          note: 'Strong reasoning and long-form writing at $3.00 input / $15 output. Higher cost but better at writing-heavy reasoning tasks.',
        },
      ]}
      faqs={[
        {
          q: 'What is the o3-mini cost per 1M tokens?',
          a: 'o3-mini is priced at $1.10 per 1M input tokens and $4.40 per 1M output tokens. Cached input is $0.55 per 1M (50% off). Note that output tokens include hidden reasoning tokens, which can be significant.',
        },
        {
          q: 'Why are reasoning tokens billed as output?',
          a: 'OpenAI reasoning models generate an internal chain-of-thought before producing the visible answer. Those reasoning tokens are billed at the output rate even though they are not returned to your application. For a 3000-token visible response, you might be billed for 8000+ output tokens including reasoning.',
        },
        {
          q: 'When should I use o3-mini instead of GPT-4o?',
          a: 'For multi-step reasoning, math, coding review, and planning tasks where chain-of-thought helps. o3-mini typically outperforms GPT-4o on these benchmarks. For chat, vision, and simple instruction-following, GPT-4o is faster and often cheaper because o3-mini consumes reasoning tokens you do not see.',
        },
        {
          q: 'Is o3-mini cheaper than o1?',
          a: 'Yes. o1 was priced at $15 input / $60 output. o3-mini at $1.10 / $4.40 is roughly 14x cheaper on input and output while matching or exceeding o1 on most reasoning benchmarks.',
        },
        {
          q: 'Does o3-mini support function calling and structured outputs?',
          a: 'Yes. Function calling, parallel function calling, and structured outputs are all supported. Note that streaming TTFT is slower than GPT-4o because the model thinks first.',
        },
        {
          q: 'How do I track reasoning token cost?',
          a: 'Capture the usage.completion_tokens_details.reasoning_tokens field returned by the API. Spanlens stores it as a separate column so you can split visible-output vs reasoning cost per request. See /integrations/openai.',
        },
      ]}
    />
  )
}
