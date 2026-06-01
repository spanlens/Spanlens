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
