/**
 * Competitor facts for the roundup and comparison pages.
 *
 * Single source of truth on purpose. The same numbers were previously restated
 * on each page that needed them, which is how the docs section copy drifted
 * (see app/docs/_lib/sections.ts and its drift test).
 *
 * Scope rule: this file carries only claims that can be checked from a public,
 * stable source. GitHub stars, license, commit cadence, and release recency all
 * come from the GitHub API on the date below. Funding rounds, acquisitions, and
 * headcount are deliberately absent: they move, they are hard to verify from
 * here, and a wrong claim about another company's ownership is not a mistake
 * worth risking on a marketing page.
 *
 * When refreshing, re-run the API for every repo and update VERIFIED_ON in the
 * same commit. competitors.test.ts fails if an entry is missing a field or if
 * VERIFIED_ON goes stale past a year.
 */

export interface Competitor {
  name: string
  /** Slug of our /compare page, when one exists. */
  compareSlug?: string
  /** GitHub owner/name, absent for closed-source products. */
  repo?: string
  /** Stars as of VERIFIED_ON. Absent for closed source. */
  stars?: number
  /** License as users experience it, not just the SPDX id. */
  license: string
  /** How you wire it into an app. */
  install: string
  selfHost: string
  /** The situation this tool is the right answer for. */
  bestFor: string
  /** The honest catch. Every entry has one, including ours. */
  tradeoff: string
  homepage: string
}

/** Date the GitHub numbers below were read. */
export const VERIFIED_ON = '2026-07-30'

export const COMPETITORS: Competitor[] = [
  {
    name: 'Spanlens',
    repo: 'spanlens/Spanlens',
    stars: 10,
    license: 'MIT, whole repository',
    install: 'Swap the baseURL, or one CLI command',
    selfHost: 'Yes, one Docker command',
    bestFor:
      'You want per-request cost in the dashboard on day one and you would rather change a base URL than wrap every call site.',
    tradeoff:
      'It is the youngest project here by a wide margin. Ten stars against Langfuse’s 32,000 is not a rounding error, and a young tool means fewer battle-tested edge cases and a smaller community to search when you get stuck.',
    homepage: 'https://www.spanlens.io',
  },
  {
    name: 'Langfuse',
    compareSlug: 'langfuse',
    repo: 'langfuse/langfuse',
    stars: 32119,
    license: 'MIT core, plus an ee/ folder under a commercial license',
    install: 'Wrap clients with the SDK, or send OpenTelemetry spans',
    selfHost: 'Yes, Docker Compose',
    bestFor:
      'You want the most mature open-source option with the largest community, and you are comfortable instrumenting call sites rather than routing traffic through a proxy.',
    tradeoff:
      'The ee/ folder gates enterprise features such as SCIM, audit logs, and project-level RBAC behind a commercial license, so self-hosting does not give you everything in the repository.',
    homepage: 'https://langfuse.com',
  },
  {
    name: 'Comet Opik',
    compareSlug: 'opik',
    repo: 'comet-ml/opik',
    stars: 20966,
    license: 'Apache 2.0, no gated folder',
    install: 'SDK decorators, plus OpenTelemetry ingest',
    selfHost: 'Yes, Docker or Kubernetes',
    bestFor:
      'Evaluation is your main question. You want scoring, datasets, and experiment tracking as the centre of the product rather than a feature bolted onto a log viewer.',
    tradeoff:
      'Instrumentation is SDK-first, so there is no base-URL swap. Cost tracking is present but is not the organising idea the way it is in a proxy-first tool.',
    homepage: 'https://www.comet.com/site/products/opik/',
  },
  {
    name: 'Helicone',
    compareSlug: 'helicone',
    repo: 'Helicone/helicone',
    stars: 6015,
    license: 'Apache 2.0',
    install: 'Swap the baseURL, or async SDK logging',
    selfHost: 'Yes, Docker',
    bestFor:
      'You specifically want a proxy and you value a codebase that has been in production for years over one that ships quickly.',
    tradeoff:
      'Development has slowed sharply. The repository took 24 commits between 1 May and 30 July 2026, against more than 300 each for Langfuse and Opik over the same window, and the most recent tagged release is from August 2025.',
    homepage: 'https://www.helicone.ai',
  },
  {
    name: 'LiteLLM',
    compareSlug: 'litellm',
    repo: 'BerriAI/litellm',
    stars: 55038,
    license: 'Custom licence, not a standard OSI template',
    install: 'Run the gateway, then point clients at it and describe models in YAML',
    selfHost: 'Yes',
    bestFor:
      'You need one endpoint in front of many providers with retries, fallbacks, and budgets, and routing matters more to you than the observability surface.',
    tradeoff:
      'It is a gateway first. Logging exists through callbacks into other backends, so the built-in observability is thin next to a purpose-built tool, and the YAML config grows quickly.',
    homepage: 'https://www.litellm.ai',
  },
  {
    name: 'Portkey',
    compareSlug: 'portkey',
    repo: 'Portkey-AI/gateway',
    stars: 12593,
    license: 'MIT for the gateway; the observability platform is commercial',
    install: 'Run the gateway, or use the hosted endpoint',
    selfHost: 'Gateway yes, full observability no',
    bestFor:
      'You want a gateway with guardrails and caching and you are happy to pay for the hosted dashboard rather than run the whole stack.',
    tradeoff:
      'The open-source repository is the gateway only; the observability you would compare against these other tools sits in the paid product. The gateway repository has had no commits since 25 May 2026.',
    homepage: 'https://portkey.ai',
  },
  {
    name: 'Arize Phoenix',
    compareSlug: 'arize-phoenix',
    repo: 'Arize-ai/phoenix',
    stars: 10802,
    license: 'Elastic License 2.0, which is not an OSI-approved open-source licence',
    install: 'OpenTelemetry instrumentation',
    selfHost: 'Yes',
    bestFor:
      'You are already an OpenTelemetry shop and you want tracing plus evaluation that sits naturally beside your existing spans.',
    tradeoff:
      'Elastic License 2.0 restricts offering the software as a managed service, so calling it open source is inaccurate even though the code is public.',
    homepage: 'https://phoenix.arize.com',
  },
  {
    name: 'Traceloop OpenLLMetry',
    repo: 'traceloop/openllmetry',
    stars: 7340,
    license: 'Apache 2.0',
    install: 'OpenTelemetry instrumentation libraries',
    selfHost: 'Yes, and it is backend-agnostic',
    bestFor:
      'You want LLM spans in the observability backend you already run, whether that is Grafana, Datadog, or Honeycomb, rather than adopting another dashboard.',
    tradeoff:
      'It is plumbing rather than a product. You get well-shaped spans and then you build the cost views, evaluation, and prompt management yourself.',
    homepage: 'https://www.traceloop.com',
  },
  {
    name: 'Laminar',
    repo: 'lmnr-ai/lmnr',
    stars: 3127,
    license: 'Apache 2.0',
    install: 'SDK instrumentation',
    selfHost: 'Yes',
    bestFor:
      'Multi-step agents are your whole workload and you want a backend built for that shape rather than one that treats a trace as a nice-to-have.',
    tradeoff: 'Small project and small community, so expect to read source when something surprises you.',
    homepage: 'https://www.lmnr.ai',
  },
  {
    name: 'OpenLIT',
    repo: 'openlit/openlit',
    stars: 2658,
    license: 'Apache 2.0',
    install: 'OpenTelemetry instrumentation',
    selfHost: 'Yes',
    bestFor:
      'You run your own models and want GPU utilisation next to token cost, which most hosted-API-focused tools do not show you.',
    tradeoff: 'Narrower than the larger tools once you step outside self-hosted inference.',
    homepage: 'https://openlit.io',
  },
  {
    name: 'LangSmith',
    compareSlug: 'langsmith',
    license: 'Closed source',
    install: 'SDK, with first-class LangChain integration',
    selfHost: 'Enterprise plans only',
    bestFor:
      'Your stack is LangChain or LangGraph and you want the tool built by the same team, with the tightest integration available.',
    tradeoff:
      'No public repository and no self-hosting outside enterprise agreements, so your traces live somewhere you do not control.',
    homepage: 'https://www.langchain.com/langsmith',
  },
  {
    name: 'Braintrust',
    compareSlug: 'braintrust',
    license: 'Closed source',
    install: 'SDK',
    selfHost: 'No',
    bestFor:
      'Evaluation is a team workflow with reviewers and datasets, and you want the polished product rather than assembling one.',
    tradeoff:
      'Closed source, no self-hosting, and it is an evaluation product first, so request-level cost observability is not the centre of it.',
    homepage: 'https://www.braintrust.dev',
  },
]

/** Tools with a public repository, most-starred first. */
export function openSourceCompetitors(): Competitor[] {
  return COMPETITORS.filter((c) => c.repo).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
}
