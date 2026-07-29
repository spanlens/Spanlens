/**
 * Section index data for the six /docs/<section> hub pages.
 *
 * Those six paths returned 404 until 2026-07-29 (Google Search Console logged
 * /docs/features as "Not found"), because every docs page lives one level
 * deeper and no section had an index. The hub pages also give each section's
 * children a second internal link: previously they were reachable only from
 * the sidebar.
 *
 * `title` and `description` are copied from each child page's own metadata.
 * `sections.test.ts` fails if they drift apart, or if a page is added under a
 * section directory without being listed here.
 */

export interface DocsSectionPage {
  title: string
  href: string
  description: string
}

export interface DocsSectionGroup {
  /** Empty for sections small enough to render as one flat list. */
  title: string
  pages: DocsSectionPage[]
}

export interface DocsSection {
  /** Path segment under /docs. */
  slug: string
  title: string
  description: string
  groups: DocsSectionGroup[]
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: 'concepts',
    title: 'Concepts',
    description:
      'How Spanlens models LLM observability: the signals worth capturing, the entities they map to, and how traces, evals, and prompt versions relate.',
    groups: [
      {
        title: '',
        pages: [
          {
            title: 'LLM observability',
            href: '/docs/concepts/llm-observability',
            description:
              'What LLM observability is, the five signal categories worth capturing, and how Spanlens maps each one to a concrete entity in the data model.',
          },
          {
            title: 'Agent tracing',
            href: '/docs/concepts/agent-tracing',
            description:
              'How Spanlens models agent traces: trace root, agent steps, LLM calls, tool calls, parent/child links, and critical path computation.',
          },
          {
            title: 'Evals',
            href: '/docs/concepts/evals',
            description:
              'How Spanlens models evals: LLM-as-judge scoring, human annotation, judge-to-human correlation as a metric, and drift detection across prompt versions.',
          },
          {
            title: 'Prompt management',
            href: '/docs/concepts/prompt-management',
            description:
              'How Spanlens versions prompts, runs Prompt A/B with Welch t-test on latency and cost, computes z-test on error rate, and rolls back without deploys.',
          },
          {
            title: 'Data model',
            href: '/docs/concepts/data-model',
            description:
              'Spanlens data model in one page: Request, Trace, Span, Prompt Version, Eval, Dataset, and how they relate for billing, debugging, and quality questions.',
          },
        ],
      },
    ],
  },
  {
    slug: 'features',
    title: 'Features',
    description:
      'Request logs, agent traces, prompt versioning and A/B, evals, anomaly detection, PII scanning, cost tracking, and workspace administration.',
    groups: [
      {
        title: 'Core',
        pages: [
          {
            title: 'Requests',
            href: '/docs/features/requests',
            description:
              'Complete log of every LLM call routed through Spanlens, model, tokens, cost, latency, full request/response bodies.',
          },
          {
            title: 'Saved Filters',
            href: '/docs/features/saved-filters',
            description:
              'Save named filter combinations on the /requests page and restore them instantly from a dropdown on future visits.',
          },
          {
            title: 'Users',
            href: '/docs/features/users',
            description:
              'End-user attribution and per-user analytics for LLM usage. Tag requests with x-spanlens-user and see who is spending what.',
          },
          {
            title: 'Traces',
            href: '/docs/features/traces',
            description:
              'Agent tracing with nested span trees. See exactly where time goes when your LLM agent calls five tools in sequence.',
          },
        ],
      },
      {
        title: 'Prompts and evaluation',
        pages: [
          {
            title: 'Prompts',
            href: '/docs/features/prompts',
            description:
              'Version-controlled prompt templates with typed variables and real-data A/B comparison. See latency, cost, and error rate for every version you ship.',
          },
          {
            title: 'Prompts Playground',
            href: '/docs/features/prompts-playground',
            description:
              'Interactive console inside the Prompts tab, select a version, set model, temperature, and variables, then run it immediately and see cost and token counts.',
          },
          {
            title: 'Prompt A/B',
            href: '/docs/features/prompt-ab',
            description:
              'Route live production traffic across two prompt versions and measure latency, cost, and error rate with statistical significance.',
          },
          {
            title: 'Evals',
            href: '/docs/features/evals',
            description:
              'LLM-as-judge evaluation, automatically score production responses on a 0..1 scale and quantify quality per prompt version.',
          },
          {
            title: 'Datasets',
            href: '/docs/features/datasets',
            description:
              'Reusable (input, expected_output) test sets. Use in Evals and Experiments instead of pulling from live production traffic.',
          },
          {
            title: 'Experiments',
            href: '/docs/features/experiments',
            description:
              'Offline side-by-side comparison, run a dataset against two prompt versions and compare outputs, scores, and cost without touching production traffic.',
          },
          {
            title: 'Annotation',
            href: '/docs/features/annotation',
            description:
              'Human star-rating for production responses. Pearson r correlation with LLM judge scores makes judge reliability visible at a glance.',
          },
        ],
      },
      {
        title: 'Reliability',
        pages: [
          {
            title: 'Security (PII + prompt injection)',
            href: '/docs/features/security',
            description:
              'Automatic PII detection and prompt-injection scanning on every LLM request and response, with optional blocking mode and real-time alert emails.',
          },
          {
            title: 'Anomalies',
            href: '/docs/features/anomalies',
            description:
              '3-sigma statistical anomaly detection on latency, cost, and error rate per (provider, model) bucket. No ML, no configuration.',
          },
          {
            title: 'Alerts',
            href: '/docs/features/alerts',
            description:
              'Threshold-based alert rules for budget, error rate, and p95 latency. Delivered via email (Resend), Slack, or Discord webhooks.',
          },
          {
            title: 'Webhooks',
            href: '/docs/features/webhooks',
            description:
              'Receive Spanlens events (request created, trace completed, alert triggered) as real-time HTTP POST payloads on your own server.',
          },
        ],
      },
      {
        title: 'Cost',
        pages: [
          {
            title: 'Cost tracking',
            href: '/docs/features/cost-tracking',
            description:
              'Accurate per-request USD cost computed from provider token prices. Handles dated model variants via longest-prefix matching.',
          },
          {
            title: 'Savings',
            href: '/docs/features/savings',
            description:
              'Model recommendations based on your real token distribution. Cheaper substitutes with estimated monthly savings, confidence tiers, and email alerts.',
          },
          {
            title: 'Billing & quotas',
            href: '/docs/features/billing',
            description:
              'How Spanlens charges you. Plan quotas, overage rates per 100K requests, the hard cap that stops runaway spend, and what an invoice looks like.',
          },
        ],
      },
      {
        title: 'Workspace',
        pages: [
          {
            title: 'Projects, Spanlens keys & provider keys',
            href: '/docs/features/projects',
            description:
              'Scope your traffic into projects (dev / staging / prod, per-service). Each Spanlens key (sl_live_…) carries its own pool of encrypted provider keys.',
          },
          {
            title: 'Shared links',
            href: '/docs/features/shares',
            description:
              'Publish a public read-only render of any trace or request via a share link, with redaction presets, view counts, and one-click revoke.',
          },
          {
            title: 'Keys & encryption',
            href: '/docs/features/settings',
            description:
              'How Spanlens stores and protects your AI provider keys. AES-256-GCM encryption at rest, decrypted only in memory during proxy forwarding.',
          },
          {
            title: 'Members & invitations',
            href: '/docs/features/members-invitations',
            description:
              'Multi-user workspaces with admin, editor, and viewer roles, email invitations with auto-accept, and an audit log of every membership event.',
          },
          {
            title: 'Audit Logs',
            href: '/docs/features/audit-logs',
            description:
              'Chronological record of every organization-level change: API keys, provider keys, member invitations, role changes, and billing plan switches.',
          },
          {
            title: 'Data Export',
            href: '/docs/features/export',
            description:
              'Download request logs, traces, anomalies, and security flags as CSV, JSONL, or JSON. Streamed exports handle millions of rows.',
          },
        ],
      },
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    description:
      'Spanlens integrations for LangChain, LangGraph, CrewAI, LlamaIndex, Vercel AI SDK, Instructor, Flowise, OpenAI Assistants, AWS Bedrock, and MCP.',
    groups: [
      {
        title: '',
        pages: [
          {
            title: 'LangChain integration',
            href: '/docs/integrations/langchain',
            description:
              'Trace LangChain (JS and Python) chains, agents, and tools with one callback handler. Every chain run, LLM call, and tool invocation becomes a Spanlens span.',
          },
          {
            title: 'LangGraph integration',
            href: '/docs/integrations/langgraph',
            description:
              'Trace LangGraph node and edge execution with Spanlens. One callback handler captures the full graph topology, parallel fan-out, and tool calls.',
          },
          {
            title: 'CrewAI integration',
            href: '/docs/integrations/crewai',
            description:
              'Trace CrewAI crews, agents, and tasks with Spanlens. One install captures the full crew execution tree with per-agent cost and latency.',
          },
          {
            title: 'LlamaIndex integration',
            href: '/docs/integrations/llamaindex',
            description:
              'Trace LlamaIndex query engines and agents with Spanlens. One callback handler maps every CBEventType to a span so the trace mirrors your RAG pipeline.',
          },
          {
            title: 'Vercel AI SDK integration',
            href: '/docs/integrations/vercel-ai',
            description:
              'Trace generateText, streamText, generateObject, and streamObject with Spanlens. Two callbacks spread into the AI SDK options log every call automatically.',
          },
          {
            title: 'OpenAI Assistants API integration',
            href: '/docs/integrations/openai-assistants',
            description:
              'Trace OpenAI Assistants API threads, runs, and steps with Spanlens. Tool calls and code-interpreter steps render as a span tree per run.',
          },
          {
            title: 'Instructor integration',
            href: '/docs/integrations/instructor',
            description:
              'Trace Instructor structured-output calls with Spanlens. Captures the Pydantic schema, retry count, and per-retry token cost.',
          },
          {
            title: 'Flowise integration',
            href: '/docs/integrations/flowise',
            description:
              'Connect Flowise visual flows to Spanlens. Flowise calls go through the Spanlens proxy and each node executions becomes a span.',
          },
          {
            title: 'AWS Bedrock integration',
            href: '/docs/integrations/bedrock',
            description:
              'Capture AWS Bedrock model invocations (Claude, Llama, Mistral, Titan) with Spanlens. SigV4 auth handled by your SDK; Spanlens proxies the wire.',
          },
          {
            title: 'MCP integration',
            href: '/docs/integrations/mcp',
            description:
              'Query Spanlens LLM cost, traces, and anomalies from Cursor, Claude Desktop, or Continue via MCP. Public-scope keys stay safe in plaintext IDE config.',
          },
        ],
      },
    ],
  },
  {
    slug: 'production',
    title: 'Production',
    description:
      'Running Spanlens under real traffic: outage behaviour, the fallback queue, recovery runbooks, and tuning for high-throughput workloads.',
    groups: [
      {
        title: '',
        pages: [
          {
            title: 'Reliability',
            href: '/docs/production/reliability',
            description:
              'How Spanlens degrades during a partial outage, what the fallback queue does, and how to monitor the proxy so it never silently drops logs.',
          },
          {
            title: 'Disaster recovery',
            href: '/docs/production/disaster-recovery',
            description:
              'Operator runbook for Spanlens outages: what data is at risk per failure mode, how fallback queues protect it, and recovery steps for ClickHouse and Supabase.',
          },
          {
            title: 'Scaling',
            href: '/docs/production/scaling',
            description:
              'Latency budget, log body trade-offs, sampling, and self-hosting tuning for high-throughput LLM workloads on Spanlens.',
          },
        ],
      },
    ],
  },
  {
    slug: 'tutorials',
    title: 'Tutorials',
    description:
      'Walkthroughs: instrument a RAG chatbot, trace a multi-step agent with parallel tool calls, and run nightly LLM-as-judge evals on production traffic.',
    groups: [
      {
        title: '',
        pages: [
          {
            title: 'Add observability to a RAG chatbot',
            href: '/docs/tutorials/rag-chatbot',
            description:
              'End-to-end tutorial. Take a basic RAG chatbot, add Spanlens, and see retrieval + generation as one trace with token cost and per-step latency.',
          },
          {
            title: 'Multi-step agent tracing',
            href: '/docs/tutorials/agent-tracing',
            description:
              'Tutorial: trace an agent that classifies intent, fans out to parallel tools, and composes an answer. Per-step cost and critical path in one waterfall.',
          },
          {
            title: 'Nightly evals on production traffic',
            href: '/docs/tutorials/nightly-evals',
            description:
              'Tutorial: set up an LLM-as-judge evaluator on a nightly sample of production traffic and catch prompt quality regressions before users complain.',
          },
        ],
      },
    ],
  },
  {
    slug: 'migrate',
    title: 'Migrate to Spanlens',
    description:
      'Migration guides from Langfuse, Helicone, and LangSmith: code diffs, data model mapping, and dual-running so you switch without losing history.',
    groups: [
      {
        title: '',
        pages: [
          {
            title: 'Migrate from Langfuse to Spanlens',
            href: '/docs/migrate/from-langfuse',
            description:
              'Move from Langfuse to Spanlens in under 30 minutes. Code diffs, data model mapping, and dual-running steps so you can switch without losing history.',
          },
          {
            title: 'Migrate from Helicone to Spanlens',
            href: '/docs/migrate/from-helicone',
            description:
              'Move from Helicone to Spanlens in under 15 minutes. Base URL swap, properties to user / session mapping, and what to do about the AI Gateway features.',
          },
          {
            title: 'Migrate from LangSmith to Spanlens',
            href: '/docs/migrate/from-langsmith',
            description:
              'Move from LangSmith to Spanlens in under 45 minutes: traceable-to-observe() mapping, LangChain callback swap, and schema migration.',
          },
        ],
      },
    ],
  },
]

/** Section slugs that have a hub page, for breadcrumb and sitemap lookups. */
export const DOCS_SECTION_SLUGS = DOCS_SECTIONS.map((s) => s.slug)

export function findDocsSection(slug: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((s) => s.slug === slug)
}

/**
 * Same lookup, but throws rather than returning undefined. The six hub pages
 * call this at module scope with a literal slug, so a typo should fail the
 * build instead of rendering an empty page.
 */
export function getDocsSection(slug: string): DocsSection {
  const section = findDocsSection(slug)
  if (!section) throw new Error(`Unknown docs section: ${slug}`)
  return section
}
