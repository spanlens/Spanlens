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
    date: '2026-07-06',
    slug: 'public-pages-and-checkout-fixes',
    title: 'Public pages, share links, and checkout retry fixes',
    tags: ['fix'],
    body: [
      'Docs, changelog, comparison pages, and shared trace links briefly required a login after a security hardening release tightened the route guard. They are public again, and the guard now works from an explicit list of dashboard routes so new public pages can never regress behind a login wall.',
      'Two smaller fixes: closing the payment overlay without completing checkout no longer leaves the upgrade button stuck until a page reload, and aborting a streaming request now releases the upstream provider connection immediately instead of holding it until the stream deadline.',
    ].join('\n\n'),
  },
  {
    date: '2026-07-06',
    slug: 'pre-launch-reliability-and-cost-accuracy',
    title: 'More accurate Gemini cost and steadier streaming',
    tags: ['fix', 'reliability'],
    body: [
      'Gemini cost is now correct on more calls. Streaming Gemini requests used to log zero tokens and zero cost because usage arrives on the final SSE event, and Gemini 2.5 and newer under-counted reasoning (thinking) tokens. Both are fixed, so the cost you see in /requests for Gemini now matches what Google bills, streaming or not.',
      'Streaming got steadier too. If a client disconnects mid-stream the proxy now cancels the upstream call right away instead of hanging, and the log row for that request is still recorded rather than lost. During a brief ClickHouse outage the proxy keeps serving your calls instead of failing every request.',
      'The dashboard now tells the truth when something goes wrong. The requests, traces, projects, and settings lists show an error with a retry instead of a misleading empty state, billing shows an error instead of a wrong Free plan when the subscription lookup fails, and an expired session sends you to the login page instead of showing stale data.',
    ].join('\n\n'),
  },
  {
    date: '2026-07-01',
    slug: 'groq-deepseek-xai-cohere-providers',
    title: 'Four more providers: Groq, DeepSeek, xAI, and Cohere',
    tags: ['feature'],
    body: [
      'Four OpenAI-compatible providers join OpenAI, Anthropic, Gemini, Azure, Mistral, and OpenRouter. Register a provider key on /projects, then point the OpenAI SDK (or the matching @spanlens/sdk helper) at `/proxy/groq/v1`, `/proxy/deepseek/v1`, `/proxy/xai/v1`, or `/proxy/cohere/v1` with your Spanlens key. Cost, latency, and token counts land on every row in /requests. Use each provider\'s own model ids, for example `llama-3.3-70b-versatile`, `deepseek-chat`, `grok-4.3`, and `command-a-03-2025`.',
      'The TypeScript SDK adds `createGroq()`, `createDeepSeek()`, `createXai()`, and `createCohere()` factories, imported from `@spanlens/sdk/<provider>`, each with a matching observe helper. Groq, DeepSeek, and xAI capture streaming token usage automatically. Cohere\'s compatibility layer does not expose usage on streamed calls, so those rows may show cost as null while non-streaming Cohere calls are costed normally. See [the proxy guide](/docs/proxy).',
    ].join('\n\n'),
  },
  {
    date: '2026-07-01',
    slug: 'python-fastapi-middleware',
    title: 'One-line request tracing for FastAPI (Python SDK)',
    tags: ['feature'],
    body: [
      'The Python SDK (`spanlens` 0.8.0) adds `SpanlensMiddleware`. Add it with `app.add_middleware(SpanlensMiddleware, api_key=...)` and every HTTP request becomes a trace with a root span named by method and path. LLM calls made inside the handler link to that trace automatically through `request.state.spanlens`. A clean response ends the trace as completed; a 5xx or an unhandled exception ends it as error and the exception is re-raised untouched.',
      'It is pure ASGI, so it also works with Starlette, Litestar, Quart, and any ASGI app. Sampling and tail-based error capture are inherited from the client, so sampled-out successful requests do zero network work while errors are always recorded. Query strings are not captured by default because they often carry secrets or PII. See the [SDK docs](/docs/sdk).',
    ].join('\n\n'),
  },
  {
    date: '2026-07-01',
    slug: 'request-body-log-sampling',
    title: 'Control storage cost with request-body sampling',
    tags: ['feature', 'infrastructure'],
    body: [
      'High-volume workspaces can now store request and response bodies for only a fraction of requests, from Settings. Pick 100, 50, 10, or 1 percent. This is body sampling, not row sampling: every request still records its tokens, cost, latency, and model, so your usage totals and billing stay exact. Only the stored prompt and response text is sampled, which is where most of the log storage cost lives.',
      'Sampled-out requests show empty bodies in /requests, the same as the `x-spanlens-log-body=meta` mode, applied automatically at your chosen rate. Security scanning still runs on the full body first, so injection and PII flags are recorded regardless of whether the body is kept. The default is 100 percent, so nothing changes until you turn it down.',
    ].join('\n\n'),
  },
  {
    date: '2026-07-01',
    slug: 'disaster-recovery-runbook',
    title: 'Disaster recovery runbook and webhook dead-letter visibility',
    tags: ['reliability', 'docs'],
    body: [
      'A new [disaster recovery runbook](/docs/production/disaster-recovery) documents, per failure mode (ClickHouse down, Supabase down, scheduled-job dropout, a stalled background migration, webhook backlog), what data is at risk, what protects it automatically, and the exact recovery steps to run. It pairs with the existing [Reliability](/docs/production/reliability) and [Backup and restore](/docs/self-host/backup) pages.',
      'Webhook deliveries that exhaust their retries are now dead-lettered explicitly instead of sitting indistinguishable from deliveries that are merely between retries. The dead-letter count is exposed on `/health/deep`, so an external monitor can page you when a webhook endpoint has been down long enough to drop events.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-19',
    slug: 'customer-rate-limits',
    title: 'Set your own rate limits, per key and per end-user',
    tags: ['feature', 'improvement'],
    body: [
      'You can now set rate limits on your own Spanlens keys, projects, and end-users from the Projects page. Cap a key at N requests per minute, hour, or day, or cap an individual end-user (the value you pass via withUser or the x-spanlens-user header) so one customer cannot exhaust your budget. When a configured limit is hit the proxy returns a 429 to that caller, tagged with the scope that fired, while the rest of your traffic flows normally. It is the same per-key, per-end-user control you would otherwise build in front of a provider, available with one dashboard setting.',
      'At the same time, our own platform throttle stopped getting in your way. The per-minute proxy ceiling is now a pure anti-runaway safeguard: going over it no longer rejects your production calls, it lets them through and flags the spike for us instead. Your plan is gated by its monthly request quota, not by a per-minute cap, so a burst of legitimate traffic will not start returning 429s. See [Proxy docs](/docs/proxy).',
    ].join('\n\n'),
  },
  {
    date: '2026-06-16',
    slug: 'evals-methodology-rigor',
    title: 'Evaluations get statistical rigor and agent trajectory scoring',
    tags: ['feature'],
    body: [
      'LLM-as-judge evaluations get statistical rigor. Pass rates now carry confidence intervals, so a 87 percent versus 85 percent comparison can be read against its actual noise floor. Judge prompts include score anchors (explicit definitions of what counts as a 1 or a 5) so verdicts reproduce across runs. A new Pairwise mode compares two responses head-to-head instead of scoring each in isolation, which is the right primitive when the real question is whether the new version beats the last one.',
      'Agent trajectory evaluation scores the full trace rather than only the final text. For evals on traces with tool calls or sub-agents, you can specify which steps to weight and the judge sees the full execution graph. Correctness in agent systems often depends on intermediate steps (did it call the right tool, did it route correctly), and trajectory mode catches the failures that final-text scoring misses.',
      'Judge-human agreement is now computed automatically. When human labels exist on a sample, the run summary shows Pearson r for numeric scores and Cohen\'s kappa for categorical labels, so you can verify whether your judge model actually agrees with your reviewers before trusting it at scale. See [Evals docs](/docs/features/evals).',
    ].join('\n\n'),
  },
  {
    date: '2026-06-16',
    slug: 'dashboard-navigation-non-blocking',
    title: 'Dashboard navigation feels instant',
    tags: ['improvement'],
    body: [
      'Clicking into the dashboard used to freeze the marketing page for 2 to 5 seconds. The layout was blocking on sidebar prefetch, the middleware ran 2 or 3 Supabase queries in series for workspace and onboarding lookups, and the destination page had no RSC tree ready. The whole chain ran sequentially before the first paint, so even warm transitions felt sluggish.',
      'Three changes land together. The dashboard layout is now non-blocking. Shell and skeleton paint immediately while data hydrates in place via Suspense. The auth middleware runs its preferred-workspace, oldest-membership, and onboarded-status queries in parallel via Promise.all, dropping a round-trip per navigation. The "Go to dashboard" CTA prefetches the route on hover, focus, and touch so the heavy fetch starts on intent rather than click. Cold transitions go from 2 to 5 seconds of blank screen to roughly 100 milliseconds of shell with content filling as it arrives.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-13',
    slug: 'mistral-and-openrouter-providers',
    title: 'Mistral and OpenRouter are now first-class providers',
    tags: ['feature'],
    body: [
      'Two new proxies join OpenAI, Anthropic, Gemini, and Azure. Point the OpenAI SDK at `https://server.spanlens.io/proxy/mistral/v1` or `/proxy/openrouter/v1` with your Spanlens key and Mistral chat completions or any of OpenRouter\'s 100+ models route through Spanlens with cost, latency, and token counts on every row in /requests. Both APIs are OpenAI-compatible, so existing client code only needs a baseURL swap.',
      'OpenRouter is a meta-provider that fronts models from 30+ vendors behind one key — `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4-5`, `meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-r1`, and so on. For these calls Spanlens prefers the `usage.cost` field on OpenRouter\'s response (the authoritative billed amount, which captures any volume discount or upstream-provider margin we don\'t see) over our local price-table lookup. Streaming responses get the same treatment via the final SSE chunk.',
      'Register a provider key from /projects and the dropdown now lists both. Evaluators and experiments can also use Mistral or OpenRouter as the judge or run model — the New Evaluator dialog reads the live model catalog, so any new model in `model_prices` shows up automatically. See [the proxy guide](/docs/proxy) for code samples in TypeScript, Python, and curl.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-12',
    slug: 'dashboard-breakdown-charts',
    title: 'Three new breakdown charts on the main dashboard',
    tags: ['feature'],
    body: [
      'The dashboard now answers the obvious follow-up questions to the headline KPIs. Three new charts sit in a single block between Traffic & spend and Spend forecast: token volume split into prompt vs completion as a stacked area, errors broken out into 4xx / 429 / 5xx bands (429 is split out so quota issues read as a different escalation than schema regressions or upstream outages), and a cost-by-model horizontal bar that surfaces the top six (provider, model) pairs sorted by spend.',
      'The token chart reuses the existing timeseries endpoint with two new fields (`promptTokens`, `completionTokens`); the error chart pulls 429 specifically via a new `errors429` field; the cost-by-model chart reads from the existing `useStatsModels` hook so no extra request is made. All three respect the dashboard time range selector and re-render in place when you switch 24h / 7d / 30d.',
      'See your spend trend? Now you can see whether it was tokens or model mix, and what kind of errors are driving the noise — without opening Requests.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-12',
    slug: 'openai-embeddings-cost-tracking',
    title: 'OpenAI embedding calls now show up with cost in /requests',
    tags: ['improvement'],
    body: [
      'RAG workloads send a lot more embedding calls than chat completions (retrieval queries fire roughly 10× per user query versus one chat completion), so the previously missing embedding cost was a meaningful slice of the dashboard total — anywhere from 30% to 50% for a retrieval-heavy app. The proxy and parser already handled the traffic correctly; the gap was a missing pricing row.',
      'The three OpenAI embedding models now have list prices in `model_prices` and the in-memory fallback: `text-embedding-3-small` ($0.020 / 1M tokens), `text-embedding-3-large` ($0.130 / 1M), and `text-embedding-ada-002` ($0.100 / 1M). Completion price stays at 0 — embeddings are input-only. New rows land with the correct `cost_usd` immediately; historical rows are unaffected.',
      'See [Cost tracking](/docs/features/cost-tracking) for the formula and the model price table.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-12',
    slug: 'webhook-ssrf-hardening',
    title: 'Webhook URLs are validated against private and cloud-metadata addresses',
    tags: ['improvement'],
    body: [
      'The webhook target URL used to only require the `https://` scheme. That left the door open to register a URL resolving to a private IP, loopback, link-local, or a cloud-provider metadata endpoint (the AWS IMDS at 169.254.169.254 / GCP metadata.google.internal / Azure metadata.azure.internal). Spanlens would then dutifully POST your org events at that internal target on every event tick. The 2019 Capital One breach was the same class of bug.',
      'Webhook create and update now resolve the hostname and reject any URL that lands on a blocked CIDR (the RFC 1918 ranges, 127.0.0.0/8 loopback, 169.254.0.0/16 link-local including IMDS, IPv6 loopback and unique-local, plus the IPv4-mapped form so `::ffff:169.254.169.254` cannot slip through). The same check runs again at every dispatch so a DNS rebinding mid-stream cannot bypass the registration-time check.',
      'No customer-facing migration is needed — existing webhooks were re-validated and only addresses pointing at internal targets are rejected on the next save. If you see a `BLOCKED_IP` or `BLOCKED_HOSTNAME` error code on a previously-working webhook, the target was unsafe and should be moved to a public endpoint.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-12',
    slug: 'vercel-ai-integration-guide',
    title: 'Dedicated Vercel AI SDK integration guide',
    tags: ['docs'],
    body: [
      'The Vercel AI SDK adapter (`@spanlens/sdk/vercel-ai`) shipped with the SDK back in 0.3.0 but lived as a short section on the SDK page. The standalone guide at [/docs/integrations/vercel-ai](/docs/integrations/vercel-ai) now covers `generateText`, `streamText`, `generateObject`, `streamObject`, multi-step tool calls, attaching to a long-lived trace for chat sessions, pairing with the proxy for billing-grade cost, and a troubleshooting FAQ. Same shape as the LangGraph / LlamaIndex / MCP guides — the four major TypeScript integrations now read consistently.',
      'No SDK change. If you already wired `createSpanlensTracker` into a project, nothing has to move.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-09',
    slug: 'feedback-public-roadmap',
    title: 'Public feedback page with voting and admin response',
    tags: ['feature'],
    body: [
      'The submit-only feedback box is now a public roadmap. Visit [/feedback](/feedback) without logging in to read every suggestion ranked by community votes. Each item carries a status chip (new, planned, in progress, shipped, declined), the original message, and a public response from the Spanlens team when one is posted. Items moved to shipped link out to the matching changelog entry.',
      'Signed in users can upvote any item, un-vote with the same click, and submit a new suggestion from the inline panel. The vote count updates optimistically and rolls back if the server rejects the write. Anonymous visitors see the same list but the vote pill links to sign in instead of casting a vote — no anonymous voting, no spam channel.',
      'Behind the scenes the new `/api/v1/feedback` endpoints follow the standard error envelope from the [API errors reference](/docs/api/errors), and admin status updates run through a separate authenticated endpoint that stamps the responder and timestamp on each row.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-09',
    slug: 'error-envelope-catalog-complete',
    title: 'Every API endpoint now returns the standard error envelope',
    tags: ['improvement'],
    body: [
      'The standard `{ error: { code, message, requestId } }` envelope rolled out for the first 8 routers in Sprint 7 has reached every endpoint the server exposes — proxy, ingest, OTLP, every `/api/v1/*` route, every webhook handler, every cron endpoint. The 18 stable codes in the [API errors reference](/docs/api/errors) cover every 4xx and 5xx the server emits.',
      'For SDK users this means `if (err.code === "RATE_LIMIT")` works against any response from any path. The TypeScript catch path narrows to a single `SpanlensApiError` shape regardless of which router answered. A new `INJECTION_BLOCKED` code (HTTP 422) joins the catalog for proxy requests rejected by the security policy when prompt injection is detected.',
      'The change is fully backward compatible. Existing clients that read `error.message` keep working; clients that want stable identifiers can switch to `error.code` at their own pace.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-08',
    slug: 'shares-workspace-dashboard',
    title: 'Workspace dashboard and redaction presets for shared links',
    tags: ['feature'],
    body: [
      'A new [Shared links](/shares) page under the Admin section of the dashboard lists every active public share in your workspace, not just the ones you created. Sort by newest, most viewed, or expiring soonest. Each row carries redaction chips so you can spot a leak at a glance, a view counter, and a one click revoke. Any organization member can revoke any share, so a leaked token from a teammate does not need an admin to clean up.',
      'The share creation modal on trace and request pages now offers three redaction presets instead of asking you to flip every toggle individually. Pick "Marketing / external" to hide PII, cost, and token counts in one click. Pick "Internal team" to show everything for a Slack channel inside your trust boundary. Pick "Custom" to keep manual control. Flipping any toggle silently switches the preset chip to Custom so the dialog never lies about what is selected.',
      'See [Shared links](/docs/features/shares) for the full guide including the API endpoints for scripting bulk audit or revoke.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-08',
    slug: 'share-viewer-iopreview-og',
    title: 'Cleaner public share viewer with input and output side by side',
    tags: ['improvement'],
    body: [
      'The public `/share/<token>` page now renders input and output as two columns on desktop and stacks them on mobile. Each pane scrolls independently so a 200 KB response body no longer pushes the request out of view. The legacy stacked layout inside an expander was awkward to compare; the split panel matches how most readers actually scan an LLM call.',
      'The share header also gets a Copy link button with a confirming "Copied" state, and the page now emits Open Graph and Twitter card metadata. A link pasted in Slack, X, or LinkedIn now produces a useful preview card showing the trace name or the provider and model rather than a blank URL.',
      'Search engine indexing stays off by default. The viewer still respects every redaction flag you picked when you published the share.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-08',
    slug: 'otlp-faster-batches',
    title: 'OTLP ingest is 50 to 200 ms faster per batch',
    tags: ['improvement'],
    body: [
      'The OTLP receiver at `/v1/traces` used to call a synchronous Postgres function after every span insert to resolve parent linkage. On hot traces with hundreds of spans per batch that added 50 to 200 ms to the receiver p95. We moved the linkage step to a background migration that scans a new partial index in 500 row chunks, so the receiver now finishes as soon as the bulk insert returns.',
      'OpenTelemetry SDK users should see the latency drop immediately with no client changes. A new hourly watchdog at `/cron/detect-orphan-spans` alerts if too many spans accumulate without a resolved parent, so a stuck background job surfaces fast.',
      'Child spans whose parent arrives in a later batch render with a temporary null parent until the background job runs, typically within minutes. The UI has always tolerated null parents (parallel agent spans use them legitimately) so the eventual consistency window is visually invisible.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-08',
    slug: 'proxy-rate-limit-headers',
    title: 'Standard rate limit headers on every proxy response',
    tags: ['improvement'],
    body: [
      'Every response from `/proxy/*` and `/api/v1/*` now carries four rate limit headers so your client can back off without guessing. `X-RateLimit-Limit` is the requests allowed per window, `X-RateLimit-Remaining` is the requests left right now, `X-RateLimit-Reset` is the unix epoch second at which the window rolls over, and `X-RateLimit-Window` is the window length (currently 60s).',
      'On a 429 the response also includes `Retry-After: 60` so a naive retry after sleep loop still works. Use `X-RateLimit-Reset` if you want to sleep until the next minute boundary precisely instead.',
      'See the [proxy reference](/docs/proxy) for the full header list and the per plan limits.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-08',
    slug: 'evaluators-regex-json-schema',
    title: 'Code evaluators: regex and JSON Schema (no LLM cost)',
    tags: ['feature'],
    body: [
      'Two new evaluator types ship alongside the existing LLM as judge evaluator. The `regex` type checks the response body against a configured pattern and scores 1 on match (or 0 when you flag `must_not_match` to invert the check). The `json_schema` type validates the response body against a JSON Schema document via Ajv and scores 1 when the body conforms.',
      'Neither type calls a judge model so neither type spends LLM credits. Use them for the cheap, fast checks where an LLM would be overkill. Catch when the response stops being valid JSON. Catch when a forbidden phrase slips through. Run them on every dataset row without worrying about cost.',
      'Create them from the [Evals](/evals) page using the new evaluator dialog. Pick the type from the dropdown and the rest of the form swaps to the matching configuration. See the [Evals guide](/docs/features/evals) for the full reference.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'events-unified-read-switch-live',
    title: 'Unified events table now powers every dashboard read',
    tags: ['infrastructure', 'reliability'],
    body: [
      'The dashboard now reads requests, stats, and traces from the unified `events` table. Same data, single source. The `requests` / `traces` / `spans` write paths still run as a safety net, but the read switch behind `USE_EVENTS_FOR_REQUESTS=1` is live across `/api/v1/requests`, every `/api/v1/stats/*` endpoint, `/api/v1/traces`, and `/api/v1/traces/:id`.',
      'Why this matters in practice: future token kinds (`vision_input_tokens`, `reasoning_tokens`, cache-write tiers) land in the open Map columns without a schema migration, the stats pipeline gets the same shape as established append-only event-table designs (PostHog / Datadog APM), so an upgrade path stays open, and the per-route read switch keeps a flag-flip rollback available for the entire stage.',
      'Operational guard rails ship alongside: every route falls back to the original Postgres/requests path if the events read throws, a daily reconciliation cron alerts on >1% row-count drift, and the read switch double-gates on a separate `EVENTS_BACKFILL_COMPLETE=1` env so an env flip alone cannot expose an empty list.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'events-table-backfill-and-read-switch',
    title: 'Events table backfill + read switch for /api/v1/requests',
    tags: ['infrastructure'],
    body: [
      'Second and third stages of the events-table unification. Stage 2 lands a background migration that copies historical `requests` rows into the new `events` table in chunks of 5,000, ordered by `(created_at, id)` so the migration only ever scans a narrow window. Six months of data backfills in a day or so without touching the proxy hot path.',
      'Stage 3 wires a feature flag, `USE_EVENTS_FOR_REQUESTS=1`, that flips `/api/v1/requests` to read from `events` instead of `requests`. The events helper projects every column back into the shape the dashboard expects, so a flip-flop test (flag on → flag off) returns byte-identical rows. Subsequent PRs extend the same flag pattern to `/api/v1/stats/*` and `/api/v1/traces`.',
      'Activation is incremental and reversible by design. Stage 2 starts with a single SQL INSERT into `background_migrations`; Stage 3 is a Vercel env-var flip plus redeploy. Either can be rolled back without a code change.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'events-table-shadow-write',
    title: 'Unified events table now shadow-writes every LLM call',
    tags: ['infrastructure'],
    body: [
      'First stage of the events-table unification work. New ClickHouse `events` table where an LLM generation, a trace, and a span are all variants of the same row shape — the same idea production-grade event analytics stores like PostHog have long converged on. Token kinds (vision input, reasoning, cache write) and per-provider cost breakdowns live in `Map(String, …)` columns so new keys don\'t need a column migration.',
      'Stage 1 is shadow-only: every successful `requests` insert and every `/ingest/traces` or `/ingest/spans` call also fans out a best-effort write to `events`. Reads are unchanged, so the dashboard still queries `requests` and the Postgres trace tables. A failed event write logs to the console but never affects the source insert.',
      'Stage 2 (background-migration backfill) and Stage 3 (feature-flag dashboard reads, route by route) ship over the coming weeks. The eventual win is one query for "show me everything in this trace" instead of the current cross-database join.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'background-migration-framework',
    title: 'Background migration framework for long-running data backfills',
    tags: ['infrastructure'],
    body: [
      'When Spanlens needs to rewrite a billion-row table (think: switching from a single `score` float to four typed value columns), the natural approach of a SQL migration that backfills inline is the wrong one. It either takes locks that spike p99 latency or it blows past Vercel\'s 5-minute function timeout halfway through the backfill, leaving the table half-rewritten.',
      'New framework based on the standard chunked-backfill-with-advisory-lock pattern that PostHog and similar OSS analytics stacks use: a `background_migrations` table tracks long-running data work; a 5-minute cron picks up a pending row, takes a Postgres advisory lock so two workers can\'t race, runs chunks (~5k rows at a time) until close to the function timeout, persists the cursor, and yields. The next tick resumes from the cursor. A heartbeat sentinel reclaims rows from crashed workers.',
      'Admin-only view at Settings → **Background migrations** shows what\'s pending / running / completed / failed, with progress percentage, last heartbeat, attempts counter, and cancel / retry buttons. This is engineering work that most users never see, but it unlocks the kind of schema evolution we were avoiding before.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'dogfooding-experiment-and-playground',
    title: 'A/B experiments and Playground also instrumented with Spanlens',
    tags: ['infrastructure'],
    body: [
      'Follow-up to the eval-runner dogfooding shipped earlier. Every A/B experiment now posts an `ab_experiment` trace with one `ab_item` span per dataset item, and every Playground run posts a `playground_call` trace with the underlying LLM fetch as its only span.',
      'Together with the eval-runner integration this covers all three places Spanlens itself spends LLM money on the customer\'s behalf. We see our own per-arm A/B cost, judge agreement, and Playground tinkering in /traces, so every dollar we spend running someone else\'s eval shows up on our own dashboard.',
      'Same fail-open helper as before. No env vars set on the deployment → every method becomes a no-op and nothing changes for the customer. Coverage is opt-in by activation.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'spanlens-dogfoods-itself',
    title: 'Spanlens now instruments itself with Spanlens',
    tags: ['infrastructure'],
    body: [
      'Every eval run on our own server now posts an `eval_run` trace to a dedicated Spanlens-team workspace, with one `llm_judge` span per sample. We see our own LLM-as-judge cost, latency, and error rate in the same [/traces](/traces) view our customers use, and when something regresses we notice on the same dashboard you do.',
      'The integration is fail-open by design. If the internal workspace is unreachable or the API key is missing, the tracing helper degrades to a stub so customer evals never fail because our own observability stopped working. Spans chain their POSTs behind the parent trace creation, matching the SDK\'s `_creationPromise` pattern so the server-side ownership check never races.',
      'No user-facing config to flip. The production env is registered server-side. The point of this entry is the engineering commit: when we say we use Spanlens for our own LLM work, we mean it.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'llm-judge-typed-scores',
    title: 'LLM judge can score categorical, boolean, and free-text rubrics',
    tags: ['feature'],
    body: [
      'The third and final piece of today\'s typed score work. An evaluator can now point at any of your workspace\'s score configs and the LLM-as-judge runner will ask for the right shape of answer, whether a boolean for pass/fail rubrics, a category from your allow-list, a short free-text label, or the legacy 0..1 numeric score.',
      'Pick the config in the New evaluator dialog. The default is still the legacy numeric path so every existing evaluator continues to run bit-identically; the new behaviour is fully opt-in. For boolean judges the run summary becomes a pass rate; for categorical and free-text it surfaces the per-category distribution and sample notes on the run page instead of a misleading average.',
      'Under the hood: Gemini\'s strict response schema is regenerated to match the active config so its JSON output stays valid, and 23 new unit tests cover the bug-prone edges (case-sensitive categorical allow-list, boolean string aliases, the parser tolerating either `{"score": …}` or `{"value": …}` on the numeric path).',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'annotation-typed-widgets',
    title: 'Annotation: type-aware rating widgets and distribution charts',
    tags: ['feature'],
    body: [
      'Follow-up to the typed score configs that shipped earlier today. The [/annotation](/annotation) page now picks the right input widget based on the active score config: chip rows for categorical scores, a pass/fail toggle for boolean, a textarea for free-text, and the existing stars / slider for numeric.',
      'New filter-bar control lets you switch the active config without leaving the page (`?config=<uuid>` is URL-backed for deep links). The stat strip aggregate switches with it, showing average score, top category, pass rate, or note count depending on what the config measures.',
      'A small distribution panel under the stat strip shows the spread at a glance: category bars for categorical, a split pass/fail bar for boolean, a five-bucket histogram for numeric, and the latest five notes for free-text. Keyboard quick-rate is type-aware too, so `1`..`9` picks the n-th category, `y`/`n` toggles boolean, and `1`..`5` stays for star configs.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'typed-score-configs',
    title: 'Score configs: categorical, boolean, and free-text scoring',
    tags: ['feature'],
    body: [
      "Until today every eval result and every reviewer score was a single number on a 0..1 slider. That covers \"how helpful is this answer\" but it can't represent a persona check (\"on brand\" / \"off brand\"), a pass/fail toggle (toxicity, PII leak), or a reviewer's free-form note.",
      'New page at [Settings → Score configs](/settings/score-configs). Pick a type (Numeric, Categorical, Boolean, or Free text), give it a name, and the annotation queue will pick the right input widget automatically. Workspaces already had a default `Helpfulness` 0..1 config seeded for backward compatibility, so existing dashboards keep working.',
      'This is the foundation PR; the annotation page widget switch, the LLM-judge response parser, and the per-type aggregation charts ship in follow-ups over the coming days.',
    ].join('\n\n'),
  },
  {
    date: '2026-06-06',
    slug: 'evaluator-templates-quality-safety-cost',
    title: 'Ten built-in evaluator templates across Quality / Safety / Cost',
    tags: ['feature'],
    body: [
      'Opening [/evals](/evals) on a fresh workspace used to drop you at a blank New evaluator dialog. It now shows a curated catalogue of ten built-in templates split across three tabs covering Quality (5), Safety (4), and Cost (1). Each ships with a recommended judge model and a tuned criterion you can run as-is or edit.',
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
      'Brand-new keys (no `last_used_at` yet) fall back to `created_at`, so an unused key isn\'t flagged on day one. Revoked keys are excluded from the count, since nagging about already-disabled keys is noise. See [Projects & keys → Stale key surfacing](/docs/features/projects#stale-key-surfacing).',
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
      'Audit-log coverage used to be uneven, and some destructive routes never wrote a row, so a security investigation often had to fall back to ClickHouse logs. Every mutation route that ships today now emits a row through a single helper, with the actor user id and IP (`x-forwarded-for` / `x-real-ip` / `cf-connecting-ip`) attached.',
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
      'Seven read-only tools ship in v0.1: stats overview, request listing, trace discovery, agent span tree, anomalies, savings recommendations, and per-end-user analytics. The server boots only with a public-scope key (`sl_live_pub_*`), so the credential, which sits in a plaintext IDE config file, never has the power to incur LLM spend on your account.',
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
