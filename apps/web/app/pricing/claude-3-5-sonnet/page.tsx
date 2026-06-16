import { ModelPricingTemplate } from '@/components/marketing/model-pricing-template'

const DESCRIPTION =
  'Claude 3.5 Sonnet pricing: $3.00 per 1M input tokens, $15.00 per 1M output, with aggressive prompt caching. Monthly cost estimates and alternatives vs GPT-4o.'

export const metadata = {
  alternates: { canonical: '/pricing/claude-3-5-sonnet' },
  title: 'Claude 3.5 Sonnet Pricing 2026 — Cost Per Token, Monthly Estimates',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'Claude 3.5 Sonnet Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    url: '/pricing/claude-3-5-sonnet',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Claude 3.5 Sonnet Pricing 2026 — Cost Per Token, Monthly Estimates',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

export default function Claude35SonnetPricingPage() {
  return (
    <ModelPricingTemplate
      model="Claude 3.5 Sonnet"
      slug="claude-3-5-sonnet"
      provider="Anthropic"
      providerUrl="https://www.anthropic.com/pricing"
      tagline="Anthropic's flagship working model. $3.00 per 1M input, $15.00 per 1M output, with cache reads at 10% of input price."
      inputPricePer1M={3.0}
      outputPricePer1M={15.0}
      cachedInputPricePer1M={0.3}
      cachedWritePricePer1M={3.75}
      contextWindow="200K tokens"
      maxOutput="8K tokens"
      released="2024-06, refreshed 2024-10"
      bestFor={[
        'Complex multi-turn agents and tool use',
        'Long-form writing and editing',
        'Code generation and review',
        'Long-context document QA (up to 200K tokens)',
        'Workflows that benefit from aggressive prompt caching',
      ]}
      scenarios={[
        { label: 'Coding assistant', inputTokens: 4_000, outputTokens: 1_500, requestsPerMonth: 20_000 },
        { label: 'Document QA', inputTokens: 50_000, outputTokens: 800, requestsPerMonth: 5_000 },
        { label: 'Production agent', inputTokens: 2_500, outputTokens: 1_000, requestsPerMonth: 100_000 },
        { label: 'Long-form writing', inputTokens: 1_500, outputTokens: 3_000, requestsPerMonth: 10_000 },
        { label: 'Long-context summarizer', inputTokens: 80_000, outputTokens: 1_200, requestsPerMonth: 3_000 },
      ]}
      alternatives={[
        {
          name: 'Claude 3.5 Haiku',
          note: 'Smaller Anthropic model at $0.80 input / $4.00 output. About 4x cheaper. Use for high-volume narrow tasks where Sonnet quality is overkill.',
        },
        {
          name: 'GPT-4o',
          href: '/pricing/gpt-4o',
          note: 'OpenAI frontier at $2.50 input / $10 output. Slightly cheaper than Sonnet, comparable quality. Pick based on which produces better outputs on your eval.',
        },
        {
          name: 'Claude Opus 4',
          note: 'Anthropic flagship at $15 input / $75 output (where available). 5x the cost of Sonnet. Use only for the hardest reasoning steps; route the rest to Sonnet.',
        },
      ]}
      faqs={[
        {
          q: 'What is the Claude 3.5 Sonnet cost per 1M tokens in 2026?',
          a: 'Claude 3.5 Sonnet is priced at $3.00 per 1M input tokens and $15.00 per 1M output tokens. Cache reads are $0.30 per 1M (10% of input) and cache writes are $3.75 per 1M (25% premium over input).',
        },
        {
          q: 'How does Anthropic prompt caching pricing work?',
          a: 'Anthropic charges a one-time cache write at $3.75 per 1M tokens (input + 25%), then 10% of base input price on every cache read until the cache expires (default 5 minutes). For a shared system prompt across many requests, the break-even point is roughly 2-3 cache hits.',
        },
        {
          q: 'What is the Claude 3.5 Sonnet context window?',
          a: '200K tokens of input, 8K maximum output. The 200K context window is one of the largest among production models — particularly useful for document-grounded tasks.',
        },
        {
          q: 'How does Claude 3.5 Sonnet compare to GPT-4o on cost?',
          a: 'GPT-4o is slightly cheaper ($2.50 input / $10 output vs Anthropic\'s $3.00 / $15). However, Anthropic\'s prompt caching at 10% of input makes Sonnet cheaper than GPT-4o for any workload with shared context (e.g. RAG with stable system prompts).',
        },
        {
          q: 'Can I run Claude 3.5 Sonnet on AWS Bedrock?',
          a: 'Yes. Bedrock offers Claude 3.5 Sonnet at the same per-token pricing under most regions. Bedrock authentication uses SigV4 with your AWS credentials. Spanlens works with both direct Anthropic and Bedrock endpoints.',
        },
        {
          q: 'How do I monitor Claude 3.5 Sonnet usage in production?',
          a: 'Capture every Messages API call with input + output + cache token breakdown, latency, model variant, and cost. Aggregate by prompt version to catch caching regressions. Spanlens does this in one line — see /integrations/anthropic.',
        },
      ]}
    />
  )
}
