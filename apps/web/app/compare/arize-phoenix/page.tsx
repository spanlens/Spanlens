import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  title: 'Spanlens vs Arize Phoenix · Compare',
  description:
    'Arize Phoenix is open-source LLM observability with deep ML-engineer DNA. Spanlens is built for application developers shipping LLM features, with proxy-first install, 1-line setup, and JS/TS equal-class with Python.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'Built for the application developer',
    body:
      'Phoenix comes from Arize, an ML-observability company. Its UX reflects that audience (eval studios, embedding projectors, drift charts). Spanlens is built for the dev who shipped an LLM feature to production last week and needs cost, latency, and quality answers fast.',
  },
  {
    title: 'JS/TS is first-class, not second',
    body:
      'Phoenix is Python-first and JS support is lighter. Spanlens TypeScript SDK and proxy approach treat Next.js, Hono, Bun, and Cloudflare Workers as first-class citizens, the same surface as Python.',
  },
  {
    title: 'Proxy install, no instrumentation code',
    body:
      'Phoenix uses OpenInference SDKs that wrap your client. You touch every call site. Spanlens is a baseURL swap. Existing apps with hundreds of LLM calls get instrumented in one config change.',
  },
  {
    title: 'Managed cloud option without a sales call',
    body:
      "Phoenix is OSS-only; Arize's managed product is enterprise-priced. Spanlens has a free managed tier and a transparent $29 Pro plan so you can pick OSS or hosted without a procurement cycle.",
  },
  {
    title: 'Model savings recommender with dollar figures',
    body:
      "Spanlens proactively flags routes where a smaller model would match quality. Phoenix has rich analysis but doesn't recommend cost-tier swaps.",
  },
  {
    title: 'Critical Path on agent traces',
    body:
      "Spanlens highlights the longest dependency chain in agent traces automatically, the actual bottleneck. Phoenix renders waterfalls but doesn't compute critical path.",
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: "You're an ML engineer, not an app developer",
    body:
      "If you work in notebooks, care about embedding drift, and want UMAP projections of your prompt space, Phoenix's ML-engineer DNA is exactly right. Spanlens optimizes for the production app developer instead.",
  },
  {
    title: "You're committed to OpenInference / OTel standards",
    body:
      "Phoenix is the reference implementation for the OpenInference spec. If your org has standardized on it, Phoenix is the natural choice. Spanlens supports OTLP ingest but Phoenix's OpenInference lineage is deeper.",
  },
  {
    title: 'You want notebook-driven exploration',
    body:
      'Phoenix can be launched inside a notebook for ad-hoc trace exploration during development. Spanlens is a server you point your app at, a different ergonomic.',
  },
  {
    title: "You'll outgrow into Arize Enterprise",
    body:
      "If your team plans to graduate to Arize's full ML platform, starting on Phoenix means a smooth upgrade path. Spanlens is a destination, not a stepping-stone.",
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Audience & ergonomics',
    rows: [
      { feature: 'Optimized for app developers', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Optimized for ML engineers / notebook users', spanlens: 'partial', competitor: 'yes' },
      {
        feature: 'JS/TS as first-class language',
        spanlens: 'yes',
        competitor: 'partial',
      },
      { feature: 'Python as first-class language', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Setup',
    rows: [
      {
        feature: '1-line baseURL proxy swap',
        spanlens: 'yes',
        competitor: 'no',
      },
      { feature: 'OpenInference / OTel SDK instrumentation', spanlens: 'partial', competitor: 'yes' },
      { feature: 'TypeScript SDK', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Python SDK', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Core observability',
    rows: [
      { feature: 'Per-request log with full body', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Cost tracking', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Agent tracing (waterfall)', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Critical Path on agent traces',
        spanlens: 'yes',
        competitor: 'no',
      },
      { feature: '3σ anomaly detection on latency/cost', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Prompts & experiments',
    rows: [
      { feature: 'Versioned prompt library', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Production A/B traffic split', spanlens: 'yes', competitor: 'no' },
      { feature: 'Built-in Welch t-test on A/B', spanlens: 'yes', competitor: 'no' },
    ],
  },
  {
    title: 'Eval & quality',
    rows: [
      { feature: 'LLM-as-judge scoring', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Human annotation queue', spanlens: 'yes', competitor: 'partial' },
      {
        feature: 'Judge to human correlation tracking',
        spanlens: 'yes',
        competitor: 'partial',
      },
      { feature: 'Datasets / golden test sets', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Embedding projector / drift analysis',
        spanlens: 'no',
        competitor: 'yes',
        note: "Phoenix's ML-observability roots show here.",
      },
    ],
  },
  {
    title: 'Cost optimization',
    rows: [
      {
        feature: 'Model swap recommendations with $ savings',
        spanlens: 'yes',
        competitor: 'no',
      },
      { feature: 'Per-model cost breakdown & budget alerts', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Security',
    rows: [
      {
        feature: 'Security scanning (API keys, PII, prompt injection)',
        spanlens: 'yes',
        competitor: 'partial',
        note: 'Spanlens runs detection on every request body at log time.',
      },
    ],
  },
  {
    title: 'License & deployment',
    rows: [
      { feature: 'Fully open source (MIT-class)', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Docker Compose self-host', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Managed cloud at transparent SMB price',
        spanlens: 'yes',
        competitor: 'no',
        note: "Arize's managed offering is enterprise-priced.",
      },
    ],
  },
]

export default function VsArizePhoenixPage() {
  return (
    <CompareTemplate
      competitor="Arize Phoenix"
      tagline="Built for the production app developer, not the ML engineer in a notebook. JS/TS gets equal billing with Python."
      tldr="Phoenix has serious ML-observability DNA from Arize and is excellent if you're an ML engineer who lives in Python notebooks. Spanlens is built for the app developer who shipped an LLM feature last week, with proxy-first install, JS/TS equal-class with Python, statistical A/B testing, and a managed tier that doesn't require an enterprise sales call."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="If you're an ML engineer with a Python-first workflow, Phoenix fits your hands. If you're shipping LLM features in a Next.js, FastAPI, or Hono app and want zero-friction install, try Spanlens."
    />
  )
}
