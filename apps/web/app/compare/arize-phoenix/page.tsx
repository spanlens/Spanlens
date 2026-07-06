import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  alternates: { canonical: '/compare/arize-phoenix' },
  title: 'Spanlens vs Arize Phoenix · 2026 Comparison',
  description:
    'Arize Phoenix has deep ML-engineer DNA. Spanlens is built for app developers shipping LLM features, with proxy-first install and first-class JS/TS.',
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
    title: 'MIT license, not source-available',
    body:
      'Spanlens ships under MIT, an OSI-approved license you can use, modify, and even run as a service. Phoenix is Elastic License 2.0, which is source-available but restricts offering it as a managed service. Both now have a free hosted tier, so the real difference is what the license lets you do with the code.',
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
      { feature: 'Human annotation queue', spanlens: 'yes', competitor: 'yes' },
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
        note: "Spanlens does not ship an embedding projector. If drift analysis on embeddings is part of your release gate, that's a Phoenix-side requirement.",
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
      {
        feature: 'OSI-approved open-source license',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Spanlens is MIT. Phoenix is Elastic License 2.0 (source-available), not an OSI-approved open-source license.',
      },
      { feature: 'Docker Compose self-host', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Managed cloud with a free tier',
        spanlens: 'yes',
        competitor: 'yes',
        note: 'Phoenix Cloud added a free tier and a $50/mo Pro plan; both products now offer transparent hosted pricing.',
      },
    ],
  },
]

export default function VsArizePhoenixPage() {
  return (
    <CompareTemplate
      competitor="Arize Phoenix"
      tagline="Built for the production app developer, not the ML engineer in a notebook. JS/TS gets equal billing with Python."
      tldr="Phoenix has serious ML-observability DNA from Arize and is excellent if you are an ML engineer who lives in Python notebooks. Embedding drift, UMAP projections of your prompt space, and notebook-launched trace exploration are first-class, and it is the reference implementation of the OpenInference spec. The friction appears when a product team is shipping features. JS/TS support is lighter than the Python experience, instrumentation goes through OpenInference SDK wrappers that touch every call site, and the license is Elastic License 2.0, source-available rather than OSI-approved. Spanlens is built for the app developer who shipped an LLM feature last week. Install is a one-line baseURL swap, TypeScript is equal-class with Python across the SDKs so Next.js and edge runtimes are first-class targets, prompt A/B experiments report Welch t-test significance built in, and the entire codebase is MIT, so you can fork, embed, or run it as a service without a license review."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="If you're an ML engineer with a Python-first workflow, Phoenix fits your hands. If you're shipping LLM features in a Next.js, FastAPI, or Hono app and want zero-friction install, try Spanlens."
    />
  )
}
