import { openGraphFor } from '@/lib/page-metadata'
import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  alternates: { canonical: '/compare/portkey' },
  openGraph: openGraphFor('/compare/portkey'),
  title: 'Spanlens vs Portkey · 2026 Comparison',
  description:
    'Portkey open-sources the gateway and sells the observability. Spanlens is MIT end to end and self-hosts the whole product, including the dashboard.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'The part you compare is the part Portkey keeps',
    body:
      'Portkey publishes its gateway under MIT, and that repository is the routing layer. The observability you would actually evaluate against a tool like this, the request log, the cost views, the traces, lives in the commercial platform. With Spanlens the dashboard and the proxy are the same MIT repository, so self-hosting gives you the product rather than the front door to it.',
  },
  {
    title: 'Cost is the first column, not an add-on',
    body:
      'Spanlens computes per-request USD from the provider response at the moment it passes through, matched to the exact dated model id such as gpt-4o-mini-2024-07-18, and aggregates it by prompt version and by end user. Gateways tend to treat spend as a budget guard rather than as the number you open the dashboard to read.',
  },
  {
    title: 'Agent traces with the critical path marked',
    body:
      'When an agent calls five tools in sequence, both tools can show you spans. Spanlens marks the longest dependency chain so you know which span to fix, rather than eyeballing a waterfall.',
  },
  {
    title: 'Prompt A/B with a significance test attached',
    body:
      'Spanlens splits live traffic between two prompt versions and reports a Welch t-test on latency and cost plus a z-test on error rate. You get an answer about whether v8 beat v7 rather than two averages that look different.',
  },
  {
    title: 'Public repository activity you can check',
    body:
      'The Portkey gateway repository had 26 commits between 1 May and 30 July 2026 and none after 25 May. Product work may well be happening in private repositories, but if you are choosing partly on the health of the open-source side, that is what the public record shows.',
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: 'Guardrails and routing are deeper',
    body:
      'Portkey ships request guardrails, conditional routing, load balancing across providers, and caching as first-class gateway features with a longer track record. Spanlens caches responses on request and proxies ten providers, but it is not trying to be your traffic manager.',
  },
  {
    title: 'Much larger community',
    body:
      'The Portkey gateway has 12,593 GitHub stars against Spanlens at 10, verified 30 July 2026. That gap is real: more integrations have been exercised, more edge cases have been reported, and more answers already exist when you search for an error message.',
  },
  {
    title: 'You may want the managed dashboard',
    body:
      'If you would rather not run an observability stack at all, paying for a hosted platform is a legitimate answer. Spanlens offers hosting too, but the reason to pick it is usually that you want the option to run everything yourself.',
  },
  {
    title: 'Enterprise gateway features',
    body:
      'Virtual keys, per-team budgets, and provider-level access control are more developed on the Portkey side. Check both feature lists against your actual governance requirements before deciding.',
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Licence and hosting',
    rows: [
      { feature: 'Licence covering the observability product', spanlens: 'MIT', competitor: 'Commercial' },
      { feature: 'Licence covering the gateway or proxy', spanlens: 'MIT', competitor: 'MIT' },
      { feature: 'Self-host the whole product', spanlens: 'yes', competitor: 'no', note: 'Portkey self-hosts the gateway; the observability platform is hosted.' },
      { feature: 'Single-command Docker install', spanlens: 'yes', competitor: 'partial' },
      { feature: 'GitHub stars (2026-07-30)', spanlens: '10', competitor: '12,593' },
    ],
  },
  {
    title: 'Getting data in',
    rows: [
      { feature: 'One-line baseURL swap', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Works without touching call sites', spanlens: 'yes', competitor: 'yes' },
      { feature: 'OpenTelemetry (OTLP) ingest', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Config file required to start', spanlens: 'no', competitor: 'partial' },
    ],
  },
  {
    title: 'Cost',
    rows: [
      { feature: 'Per-request USD in the log', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Dated model variant pricing', spanlens: 'yes', competitor: 'partial', note: 'Providers return ids like gpt-4o-mini-2024-07-18; matching them exactly is what makes the number right.' },
      { feature: 'Cost by prompt version', spanlens: 'yes', competitor: 'no' },
      { feature: 'Cost by end user and session', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Cheaper-model recommendations with a dollar figure', spanlens: 'yes', competitor: 'no' },
    ],
  },
  {
    title: 'Traces and quality',
    rows: [
      { feature: 'Agent trace waterfall', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Critical path marked', spanlens: 'yes', competitor: 'no' },
      { feature: 'LLM-as-judge evaluation', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Prompt A/B with significance test', spanlens: 'yes', competitor: 'no' },
      { feature: 'Human annotation with judge correlation', spanlens: 'yes', competitor: 'no' },
    ],
  },
  {
    title: 'Traffic management',
    rows: [
      { feature: 'Response caching', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Provider fallback and load balancing', spanlens: 'no', competitor: 'yes' },
      { feature: 'Request guardrails', spanlens: 'partial', competitor: 'yes', note: 'Spanlens detects PII and prompt injection at log time, with optional blocking. Portkey guardrails are broader.' },
      { feature: 'Virtual keys and per-team budgets', spanlens: 'partial', competitor: 'yes' },
    ],
  },
  {
    title: 'Operations',
    rows: [
      { feature: 'Log durability queue on analytics-store failure', spanlens: 'yes', competitor: 'no' },
      { feature: 'Statistical anomaly detection', spanlens: 'yes', competitor: 'no' },
      { feature: 'PII and prompt-injection scanning', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Data export (CSV, JSONL, JSON)', spanlens: 'yes', competitor: 'partial' },
    ],
  },
]

export default function VsPortkeyPage() {
  return (
    <CompareTemplate
      competitor="Portkey"
      tagline="Both sit in front of the provider. The difference is which half is open."
      tldr="Portkey and Spanlens both let you change a base URL instead of wrapping call sites, so the architectures rhyme. They part company on what you get to run: Portkey's MIT repository is the gateway, and the observability platform it feeds is commercial, while Spanlens ships the proxy and the dashboard in one MIT repository you can host yourself. Portkey is further ahead on routing, guardrails, and community size. Spanlens is further ahead on cost attribution, agent traces, and evaluation."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      lastUpdated="2026-07-30"
      closing="If you want a traffic manager with guardrails and are happy to pay for the dashboard, Portkey is a reasonable choice. If you want the observability itself to be the open part, and cost per request to be the first thing you see, try Spanlens."
    />
  )
}
