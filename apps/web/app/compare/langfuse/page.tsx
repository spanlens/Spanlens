import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  alternates: { canonical: '/compare/langfuse' },
  title: 'Spanlens vs Langfuse · 2026 Comparison',
  description:
    'Spanlens is a drop-in proxy with evals, agent tracing, and Prompt A/B built in, fully MIT. Langfuse uses an SDK + OTel model with a commercial EE folder.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'No code changes, just swap baseURL',
    body:
      'Spanlens is proxy-first. Replace api.openai.com with your Spanlens endpoint and every call is captured. Langfuse requires wrapping clients with their SDK or wiring OTel. That works fine for greenfield apps but gets painful when existing codebases have many call sites.',
  },
  {
    title: 'Fully MIT, no EE folder at all',
    body:
      'Every line of Spanlens ships under MIT. Langfuse moved all product features to MIT too, but still keeps an ee/ folder that gates enterprise security and compliance add-ons (SCIM, audit logs, data retention, project RBAC, data masking) behind a commercial license. Spanlens has no ee/ folder: what you self-host is exactly what we run.',
  },
  {
    title: 'Prompt A/B with Welch t-test built in',
    body:
      'Spanlens lets you run prompt variants side by side and gives you a Welch t-test on latency and cost, plus a z-test on error rate, not just average bars. Langfuse has prompt management and experiments, but statistical significance testing is something you build yourself.',
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
      'Langfuse has been public since 2023 with thousands of GitHub stars and a busy community. If proven OSS adoption is your top criterion, Langfuse is ahead. Spanlens shipped in 2026 with Critical Path tracing and Welch t-test A/B already in v1, capabilities Langfuse has not added.',
  },
  {
    title: 'You already use OpenTelemetry everywhere',
    body:
      "Langfuse is OTel-native and slots in naturally if your stack already has OTel collectors. Spanlens supports OTLP ingest too, but Langfuse's OTel pedigree is deeper.",
  },
  {
    title: 'You need a scoring or eval marketplace',
    body:
      "Langfuse offers a richer set of pre-built evaluators like toxicity and helpfulness that you can chain. Spanlens leans on LLM-as-judge with your own rubric plus human annotation, which stays flexible when your team's quality criteria don't match a stock evaluator.",
  },
  {
    title: 'Datasets-as-a-product workflow',
    body:
      "Langfuse's datasets feature is mature for building golden test sets and re-running them on every prompt change. Spanlens datasets cover the same flow with a simpler UI; if your golden-set workflow already lives in CI scripts, the surface difference matters less than it looks.",
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
        note: 'Langfuse core is MIT; an ee/ folder gates enterprise security and compliance add-ons (SCIM, audit logs, RBAC, data masking) under a commercial license.',
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
      tldr="Langfuse is the most mature open-source option and the safest pick if community size is the deciding factor. It instruments through SDK wrappers and callback handlers, which gives deep control but means touching every chain you want traced, and while its core is MIT, an ee/ folder gates enterprise capabilities such as SCIM, audit logs, RBAC, and data masking under a commercial license. Spanlens takes the opposite approach. Integration is a one-line baseURL swap that captures every OpenAI, Anthropic, or Gemini call without per-chain changes, and the entire repository ships under MIT with no enterprise folder. Statistical rigor is built in rather than assembled. Prompt A/B experiments report Welch t-test significance on latency and cost, judge-to-human correlation warns when your LLM judge drifts from human raters, and the savings recommender turns usage data into concrete swaps like moving classifier calls to gpt-4o-mini with the monthly dollar figure attached."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="Both tools are good. Pick Spanlens if you want to be running in 60 seconds and want statistical rigor built in. Pick Langfuse if community size and OTel-native is non-negotiable."
    />
  )
}
