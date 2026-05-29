import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  title: 'Spanlens vs Helicone · Compare',
  description:
    'Both Spanlens and Helicone are proxy-based LLM observability tools. Spanlens adds Critical Path agent tracing, Prompt A/B with Welch t-test, judge to human correlation tracking, and a ClickHouse fallback-replay safety net.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'Actively developed, not in maintenance mode',
    body:
      'Helicone was acquired by Mintlify in 2026 and is now in maintenance mode: security patches, bug fixes, and new-model support continue, but active feature development has ended and the founders moved on. Spanlens is actively building. If you want a tool that keeps shipping new capabilities, that gap matters.',
  },
  {
    title: 'Critical Path on agent traces',
    body:
      'Multi-step agents show as waterfalls in both tools. Only Spanlens highlights the longest dependency chain, the actual bottleneck. Helicone shows you spans, and you find the slow one yourself.',
  },
  {
    title: 'Prompt A/B with built-in Welch t-test',
    body:
      'Spanlens lets you split traffic between prompt variants and reports statistical significance (Welch t-test on latency and cost, plus a z-test on error rate). Helicone supports prompt versioning, but A/B comparison and significance testing are bring-your-own.',
  },
  {
    title: 'Judge to human correlation tracking',
    body:
      'Spanlens lets you annotate by hand and measures how well your LLM judge tracks human raters. If your judge drifts, you see it as a metric. Helicone supports custom scores but does not name this correlation as a first-class feature.',
  },
  {
    title: 'Model savings recommender with dollar figures',
    body:
      'Spanlens proactively flags routes where a smaller model would match quality and quotes the monthly savings. Helicone has cost dashboards, and the swap recommendation is left as a manual exercise.',
  },
  {
    title: 'ClickHouse fallback-replay safety net',
    body:
      'Spanlens writes to ClickHouse for analytics. If ClickHouse hiccups, requests fall back to a Postgres queue and replay automatically when it recovers, so logs are not silently dropped. This durability layer is a Spanlens-specific design.',
  },
  {
    title: 'Critical Path plus anomaly detection together',
    body:
      'Spanlens layers 3σ anomaly detection on top of agent trace data, so a slow critical-path span is also flagged when latency drifts off its 7-day baseline. The two surfaces reinforce each other inside one product.',
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: 'Longer track record and wider docs',
    body:
      'Helicone has been public longer with extensive docs and case studies. If proven adoption is your top criterion, Helicone is ahead. Spanlens is younger and is still growing its public footprint.',
  },
  {
    title: 'Wider integration list today',
    body:
      "Helicone supports a broad set of SDKs and frameworks out of the box. If you're using a less-common provider or SDK, check both lists before committing.",
  },
  {
    title: 'Simpler ops surface for tiny teams',
    body:
      "Helicone is a more focused product. If you want logging and cost dashboards and nothing else, Helicone's narrower scope is easier to onboard.",
  },
  {
    title: 'Gateway features and rate limiting',
    body:
      'Helicone leans into proxy-gateway features like custom rate limiting, retries, and caching at the edge. Spanlens currently focuses on observability and leaves gateway concerns to upstream tools.',
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Architecture',
    rows: [
      { feature: 'Proxy-based instrumentation', spanlens: 'yes', competitor: 'yes' },
      { feature: '1-line baseURL swap', spanlens: 'yes', competitor: 'yes' },
      { feature: 'OpenTelemetry (OTLP) ingest', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Streaming response support', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Provider coverage',
    rows: [
      {
        feature: 'Major provider proxies',
        spanlens: 'yes',
        competitor: 'yes',
        note: 'OpenAI, Anthropic, Gemini, Azure OpenAI.',
      },
      { feature: 'Local LLMs (Ollama) via SDK', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Agent tracing',
    rows: [
      { feature: 'Multi-step span trees', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Critical Path highlighting',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Spanlens computes the longest dependency chain automatically.',
      },
      { feature: 'Retry span annotation', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Prompts & experiments',
    rows: [
      { feature: 'Versioned prompt library', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Prompt A/B traffic split', spanlens: 'yes', competitor: 'partial' },
      {
        feature: 'Built-in Welch t-test on A/B results',
        spanlens: 'yes',
        competitor: 'no',
      },
      { feature: 'Prompt playground', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Eval & quality',
    rows: [
      { feature: 'LLM-as-judge scoring', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Human annotation queue', spanlens: 'yes', competitor: 'partial' },
      {
        feature: 'Judge to human correlation tracking',
        spanlens: 'yes',
        competitor: 'partial',
      },
      { feature: 'Datasets / golden test sets', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Security',
    rows: [
      {
        feature: 'Security scanning (API keys, PII, prompt injection)',
        spanlens: 'yes',
        competitor: 'partial',
      },
      { feature: 'Per-call log-body opt-out header', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Reliability',
    rows: [
      {
        feature: 'ClickHouse fallback-replay queue',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Postgres fallback queue auto-replays on ClickHouse recovery.',
      },
      { feature: 'Stream deadline with truncation flag', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'License & deployment',
    rows: [
      { feature: 'Fully open source', spanlens: 'yes', competitor: 'yes', note: 'Spanlens is MIT; Helicone is Apache 2.0.' },
      { feature: 'Docker Compose self-host', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Managed cloud option', spanlens: 'yes', competitor: 'yes' },
    ],
  },
]

export default function VsHeliconePage() {
  return (
    <CompareTemplate
      competitor="Helicone"
      tagline="Same proxy-first architecture, with more observability depth: Critical Path tracing, statistical A/B testing, and a fallback-replay durability layer."
      tldr="Helicone proved the proxy-based LLM observability model and ships a polished, focused product, though it entered maintenance mode after its 2026 Mintlify acquisition. Spanlens uses the same architecture, is actively developed, and adds Critical Path tracing on agent runs, Welch t-test on A/B prompt experiments, judge to human correlation tracking, and a ClickHouse fallback-replay queue so logs are not silently dropped on infra hiccups."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="If you want a battle-tested proxy with a focused feature set, Helicone is a strong choice. If you want the same proxy ergonomics plus deeper agent analytics, statistical A/B, and log durability, try Spanlens."
    />
  )
}
