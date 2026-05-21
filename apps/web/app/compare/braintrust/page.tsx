import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  title: 'Spanlens vs Braintrust · Compare',
  description:
    'Braintrust is eval-first and closed-source SaaS. Spanlens bundles eval into a full observability platform with proxy-based logging, agent tracing, and cost optimization, and you can self-host it with one Docker command.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'Observability plus eval in one tool, not eval-only',
    body:
      'Braintrust is excellent at evals but expects you to bring observability from somewhere else. Spanlens combines per-request logging, cost tracking, agent tracing, anomaly detection, and eval into a single product.',
  },
  {
    title: 'Fully MIT and self-hostable',
    body:
      "Braintrust is closed-source SaaS only. Spanlens ships under MIT with a docker-compose self-host. That matters when prompts contain customer data you can't send to a third party.",
  },
  {
    title: 'Proxy-based capture, no code changes',
    body:
      'Swap your baseURL and every call is captured. Braintrust expects you to log through their SDK, which means touching every call site.',
  },
  {
    title: 'Critical Path agent tracing',
    body:
      'For multi-step agents, Spanlens highlights the longest dependency chain, the actual bottleneck, not just the longest span. Braintrust focuses on eval, and its agent-trace surface is lighter.',
  },
  {
    title: 'Model savings recommender',
    body:
      "Spanlens proactively flags routes where a smaller model would match quality and shows the dollar savings. Braintrust's strength is comparing outputs side by side, and it doesn't recommend cost tier swaps.",
  },
  {
    title: 'Built-in security scanning',
    body:
      'Spanlens runs API key leak detection, PII detection, and prompt-injection pattern matching on every request body at log time. Braintrust focuses on eval workflows and treats security scanning as a separate concern.',
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: 'You live and die by your eval suite',
    body:
      "Braintrust's eval UX (diffing two model outputs side by side, scoring rubrics, regression detection) is the most polished in the market. If your team builds dozens of LLM features and evals are your release gate, Braintrust wins on that surface.",
  },
  {
    title: "You don't need self-hosting",
    body:
      "If sending prompts to a third-party SaaS is acceptable for your data classification, Braintrust's managed-only model means zero ops. Spanlens cloud is also zero-ops, but its self-host option costs nothing if you ever need it.",
  },
  {
    title: 'You want experiment-driven culture as the product',
    body:
      "Braintrust's entire UX is built around the idea that every prompt change is a versioned experiment with a scored result. If that's how your team already works, the cognitive fit is high.",
  },
  {
    title: 'Built-in playgrounds for many models',
    body:
      "Braintrust's side-by-side playground for comparing arbitrary models on the same input is more polished than Spanlens's.",
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Scope',
    rows: [
      { feature: 'Per-request observability', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Agent tracing (multi-step waterfall)', spanlens: 'yes', competitor: 'partial' },
      { feature: 'LLM eval framework', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Cost dashboards & budgets', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Security scanning (PII / keys / injection)', spanlens: 'yes', competitor: 'partial' },
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
      { feature: 'TypeScript & Python SDKs', spanlens: 'yes', competitor: 'yes' },
      { feature: 'OpenTelemetry ingest', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Eval',
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
        feature: 'Side-by-side output diff UI',
        spanlens: 'partial',
        competitor: 'yes',
        note: "Braintrust's diff and eval UX is more polished.",
      },
    ],
  },
  {
    title: 'Prompts',
    rows: [
      { feature: 'Versioned prompt library', spanlens: 'yes', competitor: 'yes' },
      { feature: 'A/B traffic split in production', spanlens: 'yes', competitor: 'partial' },
      { feature: 'Built-in Welch t-test on A/B', spanlens: 'yes', competitor: 'no' },
      { feature: 'Gradual rollout via header', spanlens: 'yes', competitor: 'partial' },
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
    title: 'License & deployment',
    rows: [
      {
        feature: 'Open source (MIT)',
        spanlens: 'yes',
        competitor: 'no',
        note: 'Braintrust is closed-source SaaS.',
      },
      { feature: 'Docker Compose self-host', spanlens: 'yes', competitor: 'no' },
      { feature: 'Managed cloud option', spanlens: 'yes', competitor: 'yes' },
    ],
  },
]

export default function VsBraintrustPage() {
  return (
    <CompareTemplate
      competitor="Braintrust"
      tagline="A full observability platform with eval inside, not an eval product asking you to bring observability."
      tldr="Braintrust has the most polished eval UX in the market and is the right tool if evals are your gate and you're fine with closed-source SaaS. Spanlens bundles eval into a complete observability stack with logging, tracing, anomaly detection, and cost optimization, and ships under MIT so you can self-host it."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="If your release gate is evals and you don't care about self-hosting, Braintrust is excellent. If you want the same kind of eval quality plus observability, tracing, and the option to run it on your own infra, try Spanlens."
    />
  )
}
