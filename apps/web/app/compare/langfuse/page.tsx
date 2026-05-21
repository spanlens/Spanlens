import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  title: 'Spanlens vs Langfuse · Compare',
  description:
    'Spanlens is a drop-in proxy with eval, agent tracing, and Prompt A/B testing built in. Fully MIT-licensed. Langfuse uses an SDK + OTel model with an EE folder for commercial features. Read the honest comparison.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'No code changes, just swap baseURL',
    body:
      'Spanlens is proxy-first. Replace api.openai.com with your Spanlens endpoint and every call is captured. Langfuse requires wrapping clients with their SDK or wiring OTel. That works fine for greenfield apps but gets painful when existing codebases have many call sites.',
  },
  {
    title: 'Fully MIT, no EE or commercial folder',
    body:
      'Every line of Spanlens ships under MIT. Langfuse is open-source, but features like SSO, audit logs, and some analytics live behind their EE folder under a commercial license. With Spanlens, what you self-host is what we run.',
  },
  {
    title: 'Prompt A/B with Welch t-test built in',
    body:
      'Spanlens lets you run prompt variants side by side and gives you a Welch t-test on latency, cost, and judge scores, not just average bars. Langfuse has prompt management and experiments, but statistical significance testing is something you build yourself.',
  },
  {
    title: 'Judge to human correlation surfaced as a metric',
    body:
      'Both products let you score traces with humans and with LLMs. Spanlens surfaces the correlation between the two as a first-class metric, so you can tell when your LLM judge starts to drift from human raters. In Langfuse the same correlation is computable but is left as bring-your-own analysis.',
  },
  {
    title: 'Model savings recommender with dollar figures',
    body:
      'Spanlens analyzes your traffic and suggests "swap these gpt-4o classification calls to gpt-4o-mini, $412/mo saved" with the evidence. Langfuse shows cost dashboards, but the swap recommendation is a manual exercise.',
  },
  {
    title: 'Critical Path in agent traces',
    body:
      "For multi-step agents, Spanlens highlights the longest dependency chain, the actual bottleneck, not just the longest span. Langfuse renders waterfall traces but doesn't compute critical path automatically.",
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: 'Larger community and ecosystem',
    body:
      'Langfuse has been public since 2023 with thousands of GitHub stars and a busy community. If proven adoption is your top criterion, Langfuse is ahead. Spanlens is younger and is still growing its community.',
  },
  {
    title: 'You already use OpenTelemetry everywhere',
    body:
      "Langfuse is OTel-native and slots in naturally if your stack already has OTel collectors. Spanlens supports OTLP ingest too, but Langfuse's OTel pedigree is deeper.",
  },
  {
    title: 'You need a scoring or eval marketplace',
    body:
      'Langfuse offers a richer set of pre-built evaluators like toxicity and helpfulness that you can chain. Spanlens leans on LLM-as-judge with your own rubric plus human annotation.',
  },
  {
    title: 'Datasets-as-a-product workflow',
    body:
      "Langfuse's datasets feature is mature for building golden test sets and re-running them on every prompt change. Spanlens has datasets too but they're lighter-weight.",
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Setup & integration',
    rows: [
      {
        feature: '1-line baseURL proxy swap',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Langfuse requires wrapping with their SDK or wiring OTel exporters.',
      },
      { feature: 'OpenTelemetry (OTLP) ingest', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'SDKs & framework integrations',
        spanlens: 'yes',
        competitor: 'yes',
        note: 'TypeScript, Python, LangChain, LlamaIndex, Vercel AI SDK.',
      },
    ],
  },
  {
    title: 'Core observability',
    rows: [
      { feature: 'Per-request log with full body', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Cost tracking per request and rollups', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Agent tracing (waterfall span tree)', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Critical Path on agent traces',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Spanlens computes the longest dependency chain automatically.',
      },
      {
        feature: '3σ anomaly detection on latency/cost',
        spanlens: 'yes',
        competitor: 'partial',
        note: 'Langfuse has alerts on metrics, but baseline-driven anomaly detection is BYO.',
      },
    ],
  },
  {
    title: 'Prompts & experiments',
    rows: [
      { feature: 'Versioned prompt library', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Prompt A/B side-by-side runner', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Built-in Welch t-test on A/B results',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Statistical significance, not just averages.',
      },
      { feature: 'Prompt playground', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Gradual prompt rollout via header', spanlens: 'yes', competitor: 'partial' },
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
        note: 'Langfuse supports both human and LLM scoring; the drift correlation metric is BYO.',
      },
      { feature: 'Datasets / golden test sets', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Pre-built evaluators marketplace', spanlens: 'partial', competitor: 'yes' },
    ],
  },
  {
    title: 'Cost optimization',
    rows: [
      {
        feature: 'Model swap recommendations with $ savings',
        spanlens: 'yes',
        competitor: 'no',
        note: 'e.g. "Swap these classifier calls to gpt-4o-mini for $412/mo saved".',
      },
      { feature: 'Per-model cost breakdown & budget alerts', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Security',
    rows: [
      {
        feature: 'Security scanning (API keys, PII, prompt injection)',
        spanlens: 'yes',
        competitor: 'partial',
        note: 'Spanlens ships built-in detectors for API key leaks, PII (SSN, IBAN, passport), and prompt-injection patterns out of the box.',
      },
      { feature: 'Per-call log-body opt-out header', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'License & deployment',
    rows: [
      {
        feature: 'Fully MIT (entire repo)',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Langfuse has an EE folder under a commercial license.',
      },
      { feature: 'Docker Compose self-host', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Managed cloud option', spanlens: 'yes', competitor: 'yes' },
    ],
  },
]

export default function VsLangfusePage() {
  return (
    <CompareTemplate
      competitor="Langfuse"
      tagline="Proxy-first instead of SDK-first. Fully MIT instead of OSS plus EE. Statistical A/B testing and savings recommendations built in."
      tldr="Langfuse is the most mature OSS option and the safest pick if community size is the deciding factor. Spanlens wins on integration speed (1-line baseURL swap), license clarity (no EE folder), and built-in features like Prompt A/B with t-tests, judge to human correlation, and model-swap savings recommendations."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="Both tools are good. Pick Spanlens if you want to be running in 60 seconds and want statistical rigor built in. Pick Langfuse if community size and OTel-native is non-negotiable."
    />
  )
}
