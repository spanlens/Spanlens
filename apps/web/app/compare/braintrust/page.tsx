import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  alternates: { canonical: '/compare/braintrust' },
  title: 'Spanlens vs Braintrust · 2026 Comparison',
  description:
    'Braintrust is eval-first, closed-source SaaS. Spanlens bundles eval into a full observability platform with proxy logging and agent tracing. Self-hostable.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'A proxy-first platform, not an eval-first SDK',
    body:
      'Braintrust has added logging and tracing, but capture is through their SDK and the product is built around evals. Spanlens is proxy-first (swap your baseURL) and bundles per-request logging, cost tracking, agent tracing, anomaly detection, and security scanning alongside eval in one platform.',
  },
  {
    title: 'Fully MIT and self-hostable',
    body:
      "Braintrust's platform is closed-source SaaS (its SDKs and the autoevals library are open, but the backend you would run is not). Spanlens ships entirely under MIT with a docker-compose self-host. That matters when prompts contain customer data you can't send to a third party.",
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
      "Braintrust's side-by-side playground compares arbitrary models on the same input with a polished UI. Spanlens has a playground built into prompt versions; for cross-vendor head-to-head shopping, Braintrust fits that use case more natively.",
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Scope',
    rows: [
      { feature: 'Per-request observability', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Agent tracing (multi-step waterfall)', spanlens: 'yes', competitor: 'yes', note: 'Braintrust added full logging and tracing; capture is via their SDK, not a proxy.' },
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
        note: "Braintrust's diff UX is the most polished in the market. Spanlens shows trace pairs side by side from the request log, sufficient for spot-checks but less optimized for daily eval review.",
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
        note: "Braintrust's platform is closed-source; only its SDKs and autoevals library are open.",
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
      tldr="Braintrust has the most polished eval UX in the market. Side-by-side output diffing, scoring rubrics, and regression detection are the product's core, and if evals are your release gate and closed-source SaaS fits your data classification, it is the specialist tool. The limits sit at the edges of that specialty. Capture runs through their SDK, so every call site gets touched, the backend is managed-only with no self-host option, and cost dashboards and security scanning are lighter surfaces. Spanlens bundles eval into a complete observability stack. A one-line baseURL swap captures every request, the same traffic feeds datasets and experiments, prompt A/B reports Welch t-test significance, judge-to-human correlation tracks when your LLM judge drifts from human raters, and anomaly detection plus the model-swap savings recommender run on the same data. The whole codebase ships under MIT, so the stack you evaluate with is also the stack you can self-host."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="If your release gate is evals and you don't care about self-hosting, Braintrust is excellent. If you want the same kind of eval quality plus observability, tracing, and the option to run it on your own infra, try Spanlens."
    />
  )
}
