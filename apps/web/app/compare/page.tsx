import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

export const metadata = {
  title: 'Spanlens vs alternatives · Compare',
  description:
    'Honest comparisons of Spanlens against Langfuse, Helicone, LangSmith, Braintrust, and Arize Phoenix, feature by feature.',
}

interface CompareEntry {
  slug: string
  competitor: string
  blurb: string
  tag: string
}

const ENTRIES: CompareEntry[] = [
  {
    slug: 'langfuse',
    competitor: 'Langfuse',
    blurb:
      'The most mature OSS LLM observability tool. We diverge on instrumentation model (proxy vs SDK), license boundary (full MIT vs OSS + EE folder), and built-in eval shape.',
    tag: 'OSS · SDK-based',
  },
  {
    slug: 'helicone',
    competitor: 'Helicone',
    blurb:
      'The closest architectural match. Both are proxy-based, though Helicone entered maintenance mode after its 2026 Mintlify acquisition. We add Critical Path agent tracing, Prompt A/B with Welch t-test, and tighter logging durability with ClickHouse fallback.',
    tag: 'Proxy-based',
  },
  {
    slug: 'langsmith',
    competitor: 'LangSmith',
    blurb:
      "LangChain's commercial offering. Excellent if you live inside LangChain, locked-in if you don't. Spanlens is framework-agnostic.",
    tag: 'LangChain ecosystem',
  },
  {
    slug: 'braintrust',
    competitor: 'Braintrust',
    blurb:
      'Eval-first, closed-source SaaS. Strong eval UX. We bundle eval into a full observability platform that you can self-host with one Docker command.',
    tag: 'Eval-first · closed source',
  },
  {
    slug: 'arize-phoenix',
    competitor: 'Arize Phoenix',
    blurb:
      'Source-available (ELv2) observability from Arize. Python-first, ML-engineer-leaning. Spanlens is built for the application developer running LLM calls in production.',
    tag: 'Source-available · Python-first',
  },
]

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />

      <section className="max-w-[1000px] mx-auto px-6 pt-20 pb-12">
        <h1 className="text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text leading-[1.05]">
          How Spanlens compares
        </h1>
        <p className="mt-4 text-[18px] text-text-muted leading-relaxed max-w-[680px]">
          Honest, side-by-side comparisons. We tell you when the alternative is the better choice
          for your team. Building trust is more valuable than winning every checkbox.
        </p>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ENTRIES.map((entry) => (
            <Link
              key={entry.slug}
              href={`/compare/${entry.slug}`}
              className="group rounded-xl border border-border bg-bg-elev p-6 hover:border-accent transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="text-[18px] font-semibold text-text group-hover:text-accent transition-colors">
                  Spanlens vs {entry.competitor}
                </h2>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint shrink-0">
                  {entry.tag}
                </span>
              </div>
              <p className="text-[13px] text-text-muted leading-relaxed">{entry.blurb}</p>
              <div className="mt-4 font-mono text-[12px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                Read comparison →
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-border bg-bg p-6">
          <h3 className="text-[15px] font-semibold text-text mb-2">Don&apos;t see your tool?</h3>
          <p className="text-[13px] text-text-muted leading-relaxed">
            We&apos;ll write a comparison for any LLM observability tool that has at least
            a public docs page. Email{' '}
            <a href="mailto:support@spanlens.io" className="text-accent hover:underline">
              support@spanlens.io
            </a>{' '}
            and we&apos;ll add it.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
