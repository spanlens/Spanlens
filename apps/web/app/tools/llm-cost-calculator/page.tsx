import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { CostCalculator } from './_calculator'

const DESCRIPTION =
  'Free LLM cost calculator. Estimate monthly OpenAI, Anthropic, and Gemini bills by model, input/output tokens, and request volume. Compare GPT-4o, Claude 3.5 Sonnet, Gemini 2.0 Flash side by side.'

export const metadata = {
  alternates: { canonical: '/tools/llm-cost-calculator' },
  title: 'LLM Cost Calculator — Estimate OpenAI, Anthropic, Gemini Spend',
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'LLM Cost Calculator — Free Tool by Spanlens',
    description: DESCRIPTION,
    url: '/tools/llm-cost-calculator',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LLM Cost Calculator — Free Tool by Spanlens',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

const SITE_URL = 'https://www.spanlens.io'

const toolJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  '@id': `${SITE_URL}/tools/llm-cost-calculator`,
  url: `${SITE_URL}/tools/llm-cost-calculator`,
  name: 'LLM Cost Calculator',
  applicationCategory: 'UtilityApplication',
  description: DESCRIPTION,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'Spanlens', url: SITE_URL },
}

export default function LlmCostCalculatorPage() {
  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(toolJsonLd) }}
      />
      <MarketingNav />

      <section className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-[36px] sm:text-[44px] font-semibold tracking-[-0.6px] text-text mb-3 leading-[1.05]">
          LLM Cost Calculator
        </h1>
        <p className="text-[17px] text-text-muted mb-10 leading-relaxed">
          Estimate your monthly OpenAI, Anthropic, or Gemini bill. Type in your average
          token usage and request volume; we compute the cost across every model and let
          you compare side by side.
        </p>

        <CostCalculator />

        <section className="mt-16 prose prose-sm max-w-none text-text-muted text-[15px] leading-relaxed">
          <h2 className="text-[22px] font-semibold text-text mb-3">How it works</h2>
          <p>
            Cost per request equals input tokens times the input price plus output tokens
            times the output price, divided by 1,000,000. Multiply by requests per month
            and you have a monthly estimate. The calculator hardcodes the latest published
            standard-tier prices (2026-06-16) for ten common models. For per-model
            breakdowns including cache discounts and batch tier pricing, see the dedicated
            pages under <code className="font-mono text-xs bg-bg-elev px-1.5 py-0.5 rounded">/pricing/&lt;model&gt;</code>.
          </p>
          <p>
            For real spend rather than estimates, instrument your app with{' '}
            <a className="text-accent hover:opacity-80" href="/signup">Spanlens</a> and
            capture every call with exact token counts and cost. The free tier covers
            50K requests per month, more than enough to see whether your estimate matches
            reality.
          </p>
        </section>
      </section>

      <Footer />
    </div>
  )
}
