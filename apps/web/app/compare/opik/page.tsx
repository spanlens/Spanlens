import { openGraphFor } from '@/lib/page-metadata'
import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  alternates: { canonical: '/compare/opik' },
  openGraph: openGraphFor('/compare/opik'),
  title: 'Spanlens vs Comet Opik · 2026 Comparison',
  description:
    'Opik is evaluation-first under Apache 2.0. Spanlens is cost-first with a one-line baseURL swap. Which one fits depends on your first question.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'No call sites to change',
    body:
      'Opik instruments your code: you add decorators or wrap clients, and every place that calls a model needs touching. Spanlens sits in front of the provider, so you change one base URL and existing calls are captured wherever they live. In a codebase with model calls spread across services, that difference decides how long adoption takes.',
  },
  {
    title: 'Cost is the organising idea',
    body:
      'Spanlens computes per-request USD as the response passes through, matched to the exact dated model id, and rolls it up by model, prompt version, end user, and session. Opik tracks token usage and cost, but the product is built around scoring quality rather than around explaining a bill.',
  },
  {
    title: 'A savings recommender that names a number',
    body:
      'Spanlens looks at your real token distribution per route and flags where a smaller model would plausibly hold quality, with an estimated monthly saving and a confidence tier. That is a different question from "did this response score well".',
  },
  {
    title: 'Critical path on agent traces',
    body:
      'Both tools render multi-step runs as trees. Spanlens marks the longest dependency chain, so a five-tool agent tells you which span to fix instead of leaving you to compare timings by eye.',
  },
  {
    title: 'Anomaly detection and log durability',
    body:
      'Spanlens flags 3-sigma deviations in latency, cost, and error rate against a rolling 7-day baseline per provider and model. A log write that fails is queued and replayed a few minutes later instead of vanishing. These are operations concerns rather than evaluation concerns.',
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: 'Evaluation is deeper, and that is the point',
    body:
      'If your central question is whether output quality is improving, Opik is built for that question first. Datasets, judges, experiment comparison, and the workflow around them are more developed than what Spanlens ships, and Spanlens evaluation exists alongside cost rather than as the centre of the product.',
  },
  {
    title: 'A much larger and faster-moving project',
    body:
      'Opik has 20,966 GitHub stars against Spanlens at 10, and recorded more than 300 commits between 1 May and 30 July 2026, verified on 30 July. It is one of the fastest-growing tools in this category.',
  },
  {
    title: 'Apache 2.0 with nothing held back',
    body:
      'Opik has no gated enterprise directory, so self-hosting gives you the whole repository. Spanlens is MIT with the same property, so on licence terms this is a tie rather than an advantage for either side.',
  },
  {
    title: 'Backed by an established company',
    body:
      'Opik comes from Comet, which has been selling experiment tracking to ML teams for years. If vendor longevity is part of your decision, that history counts for something Spanlens cannot match yet.',
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Licence and hosting',
    rows: [
      { feature: 'Licence', spanlens: 'MIT', competitor: 'Apache 2.0' },
      { feature: 'Gated enterprise directory in the repo', spanlens: 'no', competitor: 'no' },
      { feature: 'Self-host the whole product', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Single-command Docker install', spanlens: 'yes', competitor: 'partial', note: 'Opik documents Docker Compose and Kubernetes paths.' },
      { feature: 'GitHub stars (2026-07-30)', spanlens: '10', competitor: '20,966' },
    ],
  },
  {
    title: 'Getting data in',
    rows: [
      { feature: 'One-line baseURL swap', spanlens: 'yes', competitor: 'no' },
      { feature: 'Works without touching call sites', spanlens: 'yes', competitor: 'no' },
      { feature: 'SDK decorators', spanlens: 'partial', competitor: 'yes' },
      { feature: 'OpenTelemetry (OTLP) ingest', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Framework-agnostic', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Cost',
    rows: [
      { feature: 'Per-request USD in the log', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Dated model variant pricing', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Cost by prompt version', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Cost by end user and session', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Cheaper-model recommendations with a dollar figure', spanlens: 'yes', competitor: 'no' },
      { feature: 'Prompt-caching savings report', spanlens: 'yes', competitor: 'no' },
    ],
  },
  {
    title: 'Evaluation',
    rows: [
      { feature: 'LLM-as-judge scoring', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Datasets of test cases', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Offline experiments across versions', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Human annotation', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Judge-to-human correlation as a metric', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Live traffic A/B with significance test', spanlens: 'yes', competitor: 'no', note: 'Spanlens reports a Welch t-test on latency and cost plus a z-test on error rate.' },
      { feature: 'Depth of the evaluation workflow overall', spanlens: 'partial', competitor: 'yes' },
    ],
  },
  {
    title: 'Traces and operations',
    rows: [
      { feature: 'Agent trace waterfall', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Critical path marked', spanlens: 'yes', competitor: 'no' },
      { feature: 'Statistical anomaly detection', spanlens: 'yes', competitor: 'no' },
      { feature: 'Log durability queue on analytics-store failure', spanlens: 'yes', competitor: 'no' },
      { feature: 'PII and prompt-injection scanning', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Response caching at the proxy', spanlens: 'yes', competitor: 'no' },
    ],
  },
]

export default function VsOpikPage() {
  return (
    <CompareTemplate
      competitor="Comet Opik"
      tagline="Evaluation-first against cost-first. Both fully open."
      tldr="Opik and Spanlens are both properly open source with nothing held back, so the licence argument that separates other tools does not apply here. They differ in what they are organised around. Opik starts from output quality: datasets, judges, and experiments are the main surface, and instrumentation is SDK-first. Spanlens starts from the bill and the trace: one base URL captures existing calls, cost is attributed per request, and evaluation sits beside it. Opik is much larger and its evaluation workflow is deeper."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      lastUpdated="2026-07-30"
      closing="If your first question is whether quality is improving, Opik is built for it and is the safer pick on maturity. If your first question is what a request cost and where the latency went, and you would rather not instrument every call site, try Spanlens."
    />
  )
}
