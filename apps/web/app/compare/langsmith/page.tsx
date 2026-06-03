import { CompareTemplate, type CompareGroup, type ComparePoint } from '@/components/marketing/compare-template'

export const metadata = {
  title: 'Spanlens vs LangSmith · 2026 Comparison',
  description:
    'LangSmith is excellent inside the LangChain ecosystem. Spanlens is framework-agnostic. A 1-line baseURL swap works with any HTTP client, no LangChain required. Self-hostable under MIT.',
}

const whySpanlens: ComparePoint[] = [
  {
    title: 'Framework-agnostic by design',
    body:
      "Spanlens is a proxy. Any HTTP client, any framework, any language sees instant traces. LangSmith markets itself as framework-agnostic too and supports non-LangChain code via SDK wrappers, but its deepest integration (and features like the native graph view) still assume LangChain or LangGraph.",
  },
  {
    title: 'No LangChain lock-in',
    body:
      'Adopting LangSmith pushes you toward LangChain abstractions. Spanlens never asks you to rewrite. Keep your raw OpenAI, Anthropic, or Gemini calls, custom orchestration, or whatever framework you already chose.',
  },
  {
    title: 'Fully open source, actually self-hostable',
    body:
      'Spanlens is MIT and ships with a single docker-compose self-host. LangSmith Enterprise self-hosting exists but sits behind enterprise sales and pricing.',
  },
  {
    title: 'Drop-in proxy install in 60 seconds',
    body:
      'Change one URL. Done. LangSmith requires wrapping your chains, decorating functions, or setting environment variables that only activate when LangChain runs.',
  },
  {
    title: 'Prompt A/B with statistical testing',
    body:
      'Spanlens runs prompt variants and reports Welch t-test results on latency and cost, plus a z-test on error rate. LangSmith has experiments but the statistical layer is something you assemble.',
  },
  {
    title: 'Model savings recommender',
    body:
      'Spanlens flags routes where a smaller model would match quality and quotes the monthly savings. LangSmith focuses on evals, and cost-tier suggestions are not its primary surface.',
  },
]

const whyCompetitor: ComparePoint[] = [
  {
    title: "You're all-in on LangChain or LangGraph",
    body:
      "LangSmith is the most deeply integrated tool for the LangChain stack. Auto-instrumentation of chains, graphs, and tools just works. If you're committed to that ecosystem, LangSmith is the natural choice.",
  },
  {
    title: 'You need first-party LangGraph trace support',
    body:
      'LangGraph nodes, edges, and state transitions render natively in LangSmith. Spanlens also renders a graph topology view of your LangGraph runs (with the critical path highlighted), but the depth of state-transition introspection in LangSmith is still ahead. If you need to debug LangGraph state mutations specifically, LangSmith goes deeper.',
  },
  {
    title: 'You want one vendor for framework + observability',
    body:
      'Buying LangChain plus LangSmith from the same vendor means one support contract and aligned roadmaps. Spanlens is a separate vendor purposely.',
  },
  {
    title: 'Hub for sharing community prompts',
    body:
      'LangSmith Hub has a sizable community of shared prompts and chains, useful for browsing patterns. Spanlens treats prompts as part of your private library; if hub-style discovery is core to your workflow, LangSmith wins on that surface.',
  },
]

const groups: CompareGroup[] = [
  {
    title: 'Setup & framework coupling',
    rows: [
      {
        feature: '1-line baseURL proxy swap',
        spanlens: 'yes',
        competitor: 'no',
        note: 'LangSmith captures via wrapping or env vars, and only works fully inside LangChain.',
      },
      { feature: 'Works without any framework', spanlens: 'yes', competitor: 'partial' },
      {
        feature: 'LangChain & LlamaIndex integrations',
        spanlens: 'yes',
        competitor: 'yes',
      },
      {
        feature: 'LangGraph graph topology view',
        spanlens: 'yes',
        competitor: 'yes',
        note: 'Both render the node graph. LangSmith goes deeper into state-transition introspection.',
      },
      { feature: 'Vercel AI SDK', spanlens: 'yes', competitor: 'yes' },
    ],
  },
  {
    title: 'Core observability',
    rows: [
      { feature: 'Per-request log with full body', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Cost tracking', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Agent tracing (waterfall)', spanlens: 'yes', competitor: 'yes' },
      {
        feature: 'Critical Path on agent traces',
        spanlens: 'yes',
        competitor: 'no',
      },
      { feature: '3σ anomaly detection', spanlens: 'yes', competitor: 'partial' },
    ],
  },
  {
    title: 'Prompts & experiments',
    rows: [
      { feature: 'Versioned prompt library', spanlens: 'yes', competitor: 'yes' },
      { feature: 'Public prompt hub', spanlens: 'no', competitor: 'yes' },
      { feature: 'A/B traffic split', spanlens: 'yes', competitor: 'yes' },
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
      { feature: 'Datasets', spanlens: 'yes', competitor: 'yes' },
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
      { feature: 'Per-model cost breakdown', spanlens: 'yes', competitor: 'yes' },
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
    ],
  },
  {
    title: 'License & deployment',
    rows: [
      { feature: 'Fully MIT (entire repo)', spanlens: 'yes', competitor: 'no' },
      {
        feature: 'Single-command Docker self-host',
        spanlens: 'yes',
        competitor: 'partial',
        note: 'LangSmith self-host is gated behind enterprise.',
      },
      { feature: 'Managed cloud option', spanlens: 'yes', competitor: 'yes' },
    ],
  },
]

export default function VsLangSmithPage() {
  return (
    <CompareTemplate
      competitor="LangSmith"
      tagline="A 1-line proxy that works with any stack, no SDK wrapping required. MIT and self-hostable today, not a sales call away."
      tldr="LangSmith is the right call if you're committed to LangChain or LangGraph. The integration depth is unmatched. Spanlens is the right call if you want a tool that works with anything, installs with a 1-line baseURL swap, ships fully under MIT, and bundles Prompt A/B with statistical testing."
      whySpanlens={whySpanlens}
      whyCompetitor={whyCompetitor}
      groups={groups}
      closing="If your codebase already breathes LangChain, LangSmith is the safe pick. If you want zero lock-in and a 60-second install, try Spanlens."
    />
  )
}
