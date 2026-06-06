/**
 * Changelog entries, newest first.
 *
 * Add a new entry at the top of the array. Date is the publish date in
 * YYYY-MM-DD (local intent; the RSS feed renders it as 00:00 UTC).
 *
 * Tag conventions:
 *   - 'feature'        new user-facing capability
 *   - 'improvement'    better behavior of an existing feature
 *   - 'fix'            bug fix worth mentioning to users
 *   - 'docs'           new or substantially updated documentation
 *   - 'infrastructure' user-visible infra change (faster queries, retention, etc.)
 *   - 'reliability'    durability / availability work
 *
 * Body is short markdown-like text rendered as paragraphs. Keep it 1-3
 * paragraphs, plain prose, no marketing fluff. Link to docs with markdown
 * links. The renderer parses `[label](href)` only, nothing else.
 */
export interface ChangelogEntry {
  /** YYYY-MM-DD */
  date: string
  /** Stable slug, used as anchor and feed id. Lowercase, hyphenated. */
  slug: string
  /** Short headline, under ~70 chars. */
  title: string
  /** Categorization tags, shown as small chips. */
  tags: ChangelogTag[]
  /** 1-3 short paragraphs of plain text or `[label](href)` links. */
  body: string
}

export type ChangelogTag =
  | 'feature'
  | 'improvement'
  | 'fix'
  | 'docs'
  | 'infrastructure'
  | 'reliability'

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-06-06',
    slug: 'evaluator-templates-quality-safety-cost',
    title: 'Ten built-in evaluator templates across Quality / Safety / Cost',
    tags: ['feature'],
    body: [
      'Opening [/evals](/evals) on a fresh workspace used to drop you at a blank New evaluator dialog. It now shows a curated catalogue of ten built-in templates split into three tabs — Quality (5), Safety (4), and Cost (1) — each with a recommended judge model and a tuned criterion you can run as-is or edit.',
      'Hallucination and Cost-vs-quality default to `claude-3-5-sonnet` because their rubrics need more reasoning depth; the rest run on `gpt-4o-mini` so high-volume judging stays cheap. Templates ship as DB rows (`evaluator_templates` table) rather than hard-coded constants, so new ones can land without a frontend deploy.',
      'See the full list and the prompt text for each criterion in the [Evals docs](/docs/features/evals#quick-start-with-a-template).',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'api-key-stale-tracking',
    title: 'Spanlens keys now flag stale and revoke-tier idleness',
    tags: ['improvement'],
    body: [
      'Every successful proxy auth now refreshes `api_keys.last_used_at` (throttled to one write per key per five minutes so the proxy hot path stays cheap). The dashboard buckets active keys by idleness and surfaces forgotten ones in three places.',
      'A neutral "Stale" badge appears next to the key name on [/projects](/projects) after 30 days of silence; the badge flips to accent "Consider revoking" at 90 days. The Admin sidebar entry carries a red count of stale + revoke-tier keys, and the dashboard "Needs Attention" strip surfaces a warning card with a sample key name when at least one key has crossed the 90-day line.',
      'Brand-new keys (no `last_used_at` yet) fall back to `created_at`, so an unused key isn\'t flagged on day one. Revoked keys are excluded from the count — nagging about already-disabled keys is noise. See [Projects & keys → Stale key surfacing](/docs/features/projects#stale-key-surfacing).',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'soft-delete-grace-period',
    title: 'Accidental key/prompt deletions can be restored within 72 hours',
    tags: ['improvement'],
    body: [
      'Clicking the trash icon on a Spanlens key, provider key, or prompt version used to hard-delete the row immediately, which meant a mis-click turned into a support ticket the moment proxy traffic started returning 401. Deletes now flip `is_active = false` right away (traffic stops within seconds) and queue the hard delete for 72 hours later.',
      'A new **Pending deletions** tab under [Settings](/settings) lists every queued row with a countdown and a Restore button. Click Restore to flip `is_active` back to true and the deletion is cancelled; after the window expires the hard delete runs and the row is gone for good.',
      'Both the original delete request and the restore are audited (`api_key.delete`, `pending_deletion.restore`, …) so the change trail stays intact even when the action is reversed. Full reference: [Projects & keys → Restoring an accidental deletion](/docs/features/projects#restoring-an-accidental-deletion).',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'audit-log-expanded-coverage',
    title: 'Audit log now records twenty-four actions across thirteen routes',
    tags: ['improvement'],
    body: [
      'Audit-log coverage used to be uneven — some destructive routes never wrote a row, so a security investigation often had to fall back to ClickHouse logs. Every mutation route that ships today now emits a row through a single helper, with the actor user id and IP (`x-forwarded-for` / `x-real-ip` / `cf-connecting-ip`) attached.',
      'New actions are grouped by resource: Spanlens keys, provider keys (including `rotate`), prompt versions, A/B experiments, members and invitations, workspace settings, billing checkout / cancel, projects, alerts and channels, webhooks, and the new pending-deletion restore path. See the [full table](/docs/features/audit-logs#recorded-events).',
      'The Settings audit-log tab is also rebuilt: time-window + action filters, paginated 50 per page, click any row to open a drawer with the full metadata JSON, IP, and event ID. Admins see every row; editors and viewers see an abbreviated preview on the same tab. Two new query parameters (`from`, `to`) are exposed via the REST API for ISO 8601 time-range filtering.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-04',
    slug: 'mcp-server-for-ide-agents',
    title: 'Query Spanlens from Cursor, Claude Desktop, or Continue via MCP',
    tags: ['feature'],
    body: [
      'Spanlens now ships an official MCP server, so the agent inside Cursor, Claude Desktop, or Continue can answer questions about your workspace without you leaving the editor. Ask things like *"what is our OpenAI spend this week?"*, *"any cost anomalies?"*, or *"walk me through trace X"* and the agent picks the right tool automatically.',
      'Seven read-only tools ship in v0.1: stats overview, request listing, trace discovery, agent span tree, anomalies, savings recommendations, and per-end-user analytics. The server boots only with a public-scope key (`sl_live_pub_*`) so the credential — which sits in a plaintext IDE config file — never has the power to incur LLM spend on your account.',
      'Install in one line: `npx -y @spanlens/mcp-server`. The [MCP integration guide](/docs/integrations/mcp) has the full Cursor / Claude Desktop / Continue config snippets and the safety model. The server is also listed on the official MCP Registry as `io.github.spanlens/mcp-server`.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-01',
    slug: 'langgraph-topology-view',
    title: 'LangGraph topology view in /traces',
    tags: ['feature'],
    body: [
      'Trace detail pages now have a Timeline / Graph toggle. The Graph view renders LangGraph (and any LangChain callback) traces as a node-and-edge diagram, with each `chain.*` span as a node and edges inferred from sibling execution order. Parallel fan-out, sequential transitions, and the critical path are all visible at a glance.',
      'Critical-path nodes and edges are drawn in accent color so the slowest dependency chain stands out without reading numbers. Click any node to open the existing span drawer.',
      'The Graph tab is enabled automatically when a trace contains enough `chain.*` spans to be worth the view (currently 20% of total spans). Simple two-call RAG traces continue to default to the Gantt. See the [LangGraph integration docs](/docs/integrations/langgraph) for instrumentation details.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-01',
    slug: 'public-status-page',
    title: 'Public status page at status.spanlens.io',
    tags: ['reliability'],
    body: [
      'Independent monitoring of the proxy (liveness + deep health) and the dashboard, posted at [status.spanlens.io](https://status.spanlens.io).',
      'Subscribe by email or RSS directly on the page. The page runs on Better Stack and is monitored from four global regions every 3 minutes.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-01',
    slug: 'docs-migration-guides-and-tutorials',
    title: 'Docs: migration guides, data model reference, tutorials, production guides',
    tags: ['docs'],
    body: [
      'Nine new doc pages: drop-in migration guides for [Langfuse](/docs/migrate/from-langfuse), [Helicone](/docs/migrate/from-helicone), and [LangSmith](/docs/migrate/from-langsmith), a single-page [data model reference](/docs/concepts/data-model), a dedicated [LangGraph integration](/docs/integrations/langgraph), three tutorials ([RAG chatbot](/docs/tutorials/rag-chatbot), [agent tracing](/docs/tutorials/agent-tracing), [nightly evals](/docs/tutorials/nightly-evals)), and two production guides ([reliability](/docs/production/reliability), [scaling](/docs/production/scaling)).',
      'Also: /doc (missing-s typo) now permanently redirects to /docs.',
    ].join('\n\n'),
  },
  {
    date: '2026-05-30',
    slug: 'in-app-feedback',
    title: 'In-app feedback button',
    tags: ['feature'],
    body: 'Floating feedback button on every dashboard page. Sends thoughts straight to the team without leaving your workflow.',
  },
  {
    date: '2026-05-22',
    slug: 'full-model-price-catalog',
    title: 'Full OpenAI and Anthropic model price catalog',
    tags: ['improvement', 'infrastructure'],
    body: 'Cost calculations now cover every current OpenAI and Anthropic model, including dated variants (e.g. gpt-4o-mini-2024-07-18 maps to gpt-4o-mini pricing). Tiered pricing and prompt cache discounts are honored.',
  },
  {
    date: '2026-05-19',
    slug: 'clickhouse-fallback-queue',
    title: 'Zero log loss during ClickHouse outages',
    tags: ['reliability'],
    body: [
      'When the ClickHouse insert fails, the request row is queued in a Supabase fallback table instead of dropped. A cron drains the queue every 5 minutes once ClickHouse recovers.',
      'You can monitor the queue depth from [GET /health/deep](https://server.spanlens.io/health/deep) as `fallback.queue`.',
    ].join('\n\n'),
  },
  {
    date: '2026-05-19',
    slug: 'streaming-deadline-graceful-close',
    title: 'Streaming deadline with graceful close at 290s',
    tags: ['improvement'],
    body: 'Long-running streams that approach the Vercel 300s ceiling now close gracefully at 290s, with the partial response body logged and a `truncated` badge in /requests. Previously these would silently disappear when the platform killed the function.',
  },
  {
    date: '2026-05-16',
    slug: 'requests-on-clickhouse',
    title: 'Requests moved to ClickHouse columnar storage',
    tags: ['infrastructure'],
    body: 'The `requests` table now lives in ClickHouse with monthly partitioning and ZSTD body compression. Time-range queries on /requests are 5-20x faster, storage cost is ~3x lower for the same body data.',
  },
  {
    date: '2026-05-13',
    slug: 'evals-llm-as-judge',
    title: 'Evals: LLM-as-judge scoring of production responses',
    tags: ['feature'],
    body: 'Define a reusable evaluator (criterion + judge model), run it against a sample of production traffic for a specific prompt version, get a 0..1 score per sample with reasoning. See the [Evals docs](/docs/features/evals) or the [nightly evals tutorial](/docs/tutorials/nightly-evals).',
  },
  {
    date: '2026-05-13',
    slug: 'datasets',
    title: 'Datasets: reusable test inputs for offline evaluation',
    tags: ['feature'],
    body: 'Create named datasets of (input, optional expected_output) pairs and run evaluators against them instead of sampling production. One-click "import this request as a dataset item" from the request detail view.',
  },
  {
    date: '2026-05-13',
    slug: 'human-evals',
    title: 'Human annotation queue',
    tags: ['feature'],
    body: 'Sample N requests, score them in a queue UI, capture human ratings alongside LLM-judge scores. See the [Annotation docs](/docs/features/annotation).',
  },
  {
    date: '2026-05-05',
    slug: 'unified-api-keys',
    title: 'Unified API keys (one key per project, provider-agnostic)',
    tags: ['improvement'],
    body: [
      'Spanlens keys (`sl_live_*`) are now provider-agnostic. One key authenticates calls to OpenAI, Anthropic, Gemini, and Azure OpenAI; the provider is inferred from the request URL path.',
      'Provider keys are registered separately per project and stay server-side, AES-256-GCM encrypted at rest.',
    ].join('\n\n'),
  },
  {
    date: '2026-04-30',
    slug: 'prompt-ab-significance',
    title: 'Prompt A/B comparison with statistical significance',
    tags: ['feature'],
    body: 'Compare two prompt versions on production traffic. Cost, latency, and quality (when an evaluator is attached) come with confidence intervals and significance tests so you stop shipping changes based on 10 samples.',
  },
  {
    date: '2026-04-21',
    slug: 'agent-tracing',
    title: 'Agent tracing with parallel span fan-out',
    tags: ['feature'],
    body: 'Group related LLM calls, tool calls, and retrievals into one trace tree. Spans intentionally have no foreign key on `parent_span_id` so out-of-order parallel branches never break the tree. Critical path is highlighted in the waterfall.',
  },
]
