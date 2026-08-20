import { openGraphFor } from '@/lib/page-metadata'
import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  alternates: { canonical: '/compare/litellm' },
  openGraph: openGraphFor('/compare/litellm'),
  title: 'Spanlens vs LiteLLM · 2026 Comparison',
  description:
    'LiteLLM is the dominant open-source LLM gateway with thin built-in logging. Spanlens is the observability half. Many teams end up running both.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'Observability is the product, not a callback',
    body:
      'LiteLLM records what happened by handing it to something else: you register a callback and pick a backend. Spanlens is that backend, with the request log, cost views, traces, evaluation, and anomaly detection as the product itself rather than as configuration you assemble.',
  },
  {
    title: 'Nothing to configure before the first request',
    body:
      'LiteLLM wants a config file describing your models, keys, and routing before it is useful, and that file keeps growing. Spanlens needs a base URL and a key, and the provider is inferred from the path, so there is no model registry to maintain.',
  },
  {
    title: 'Cost matched to the exact model version',
    body:
      'Providers return dated ids such as gpt-4o-mini-2024-07-18, and a price table that only knows gpt-4o-mini will quietly produce the wrong number. Spanlens matches exact ids first and falls back to the longest boundary-aware prefix, then rolls the result up by prompt version and by end user.',
  },
  {
    title: 'Agent traces with the critical path marked',
    body:
      'Spanlens shows a multi-step agent run as a span tree and marks the longest dependency chain, so you know which of five tool calls is actually costing you the wall-clock time. A gateway sees each call separately and cannot reconstruct the shape.',
  },
  {
    title: 'Evaluation and Prompt A/B in the same place as the logs',
    body:
      'LLM-as-judge scoring, human annotation with judge-to-human correlation, and traffic-split prompt A/B with a Welch t-test all sit next to the requests they describe. With LiteLLM these are separate tools you wire together.',
  },
  {
    title: 'Logs survive a database outage',
    body:
      'When a request log fails to write, Spanlens keeps the row in a fallback queue and a cron replays it once the database answers again. Replay skips rows that already landed, so nothing is counted twice. Silent log loss during an outage is the failure mode that makes observability untrustworthy.',
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: 'Far and away the larger project',
    body:
      'LiteLLM has 55,038 GitHub stars against Spanlens at 10, verified 30 July 2026, and it ships continuously. If community size and breadth of exercised integrations are your main criteria, this is not a close call.',
  },
  {
    title: 'Provider coverage is much wider',
    body:
      'LiteLLM normalises well over a hundred providers behind one OpenAI-shaped interface. Spanlens proxies ten. If you are calling something unusual, check the Spanlens list before assuming it is covered.',
  },
  {
    title: 'Routing, fallbacks, and budgets are its job',
    body:
      'Retries, provider failover, load balancing, rate limits, and per-key spend caps are core LiteLLM features with years behind them. Spanlens deliberately does not try to be your traffic manager.',
  },
  {
    title: 'They compose well, so this may not be a choice',
    body:
      'A common shape is LiteLLM for routing with Spanlens as the observability backend behind it. If you already run LiteLLM, you probably want to add Spanlens rather than replace anything.',
  },
]

const groups: CompareGroup[] = [
  {
    title: 'What each one is for',
    rows: [
      { feature: 'Primary job', spanlens: 'Observability', competitor: 'Routing' },
      { feature: 'Licence', spanlens: 'MIT', competitor: 'Custom', note: 'LiteLLM does not use a standard OSI template; read it if licence terms matter to you.' },
      { feature: 'Self-host', spanlens: 'yes', competitor: 'yes' },
      { feature: 'GitHub stars (2026-07-30)', spanlens: '10', competitor: '55,038' },
      { feature: 'Providers normalised behind one interface', spanlens: '10', competitor: '100+' },
    ],
  },
  {
    title: 'Setup',
    rows: [
      { feature: 'Usable with no config file', spanlens: 'yes', competitor: 'no' },
      { feature: 'One-line baseURL swap', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Model registry to maintain', spanlens: 'no', competitor: 'yes' },
      { feature: 'OpenTelemetry (OTLP) ingest', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Observability',
    rows: [
      { feature: 'Built-in request log UI', spanlens: 'yes', competitor: 'partial', note: 'LiteLLM ships a UI; the depth of the log view is not its focus.' },
      { feature: 'Full request and response bodies stored', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Per-request USD cost', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Dated model variant pricing', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Cost by prompt version', spanlens: 'yes', competitor: 'no' },
      { feature: 'Cost by end user and session', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Requires an external backend to retain logs', spanlens: 'no', competitor: 'yes' },
    ],
  },
  {
    title: 'Traces, quality, and safety',
    rows: [
      { feature: 'Agent trace waterfall', spanlens: 'yes', competitor: 'no' },
      { feature: 'Critical path marked', spanlens: 'yes', competitor: 'no' },
      { feature: 'LLM-as-judge evaluation', spanlens: 'yes', competitor: 'no' },
      { feature: 'Prompt versioning and A/B with significance test', spanlens: 'yes', competitor: 'no' },
      { feature: 'Statistical anomaly detection', spanlens: 'yes', competitor: 'no' },
      { feature: 'PII and prompt-injection scanning', spanlens: 'yes', competitor: 'no' },
    ],
  },
  {
    title: 'Traffic management',
    rows: [
      { feature: 'Provider fallback and retries', spanlens: 'no', competitor: 'yes' },
      { feature: 'Load balancing across deployments', spanlens: 'no', competitor: 'yes' },
      { feature: 'Per-key spend caps', spanlens: 'partial', competitor: 'yes', note: 'Spanlens enforces monthly plan quotas, not arbitrary per-key budgets.' },
      { feature: 'Response caching', spanlens: 'yes', competitor: 'yes' },
    ],
  },
]

export default function VsLiteLlmPage() {
  return (
    <CompareTemplate
      competitor="LiteLLM"
      tagline="Different jobs. One routes traffic, the other explains it."
      tldr="LiteLLM is a gateway and Spanlens is an observability platform, so treating this as a head-to-head is slightly wrong from the start. LiteLLM normalises over a hundred providers, handles retries and fallbacks, and hands logging to a backend you choose. Spanlens is a backend of that kind, with cost attribution, agent traces, evaluation, and anomaly detection built in and no config file to maintain. Plenty of teams end up running both."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      lastUpdated="2026-07-30"
      closing="If your problem is routing across many providers with fallbacks, use LiteLLM. If your problem is knowing what each request cost and why a trace was slow, add Spanlens. The two are not mutually exclusive."
    />
  )
}
