import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { CopyInstallButton } from '@/components/landing/copy-install-button'
import { WaitlistForm } from '@/components/landing/waitlist-form'

export const metadata = { title: 'Spanlens · LLM Observability' }

const FEATURES = [
  { kicker: '01', title: 'Request log', body: 'Every call — model, tokens, cost, latency, full body. Filter, group, export.', accent: '$0.0021' },
  { kicker: '02', title: 'Cost tracking', body: 'Per-request breakdown, daily rollups, budget alerts before you blow the month.', accent: '−38%' },
  { kicker: '03', title: 'Agent tracing', body: 'Multi-step workflows as waterfall span trees. Find the one step that took 18s.', accent: '12 spans' },
  { kicker: '04', title: 'Anomaly detection', body: '3σ deviations in latency or cost vs. your 7-day baseline, flagged on arrival.', accent: '3.1σ' },
  { kicker: '05', title: 'PII + injection scan', body: 'Regex detection on request bodies at log time. Redact before it hits disk.', accent: 'SSN · email' },
  { kicker: '06', title: 'Model recommender', body: '"Your gpt-4o calls look like classification — try gpt-4o-mini." With numbers.', accent: '−$412/mo' },
]

const SURFACES = [
  { k: 'Requests',  hint: '12,481 / 1h',   body: 'Full body, headers, cost. Filter, group, replay.' },
  { k: 'Traces',    hint: '842 / day',      body: 'Waterfall with critical path & retry spans.' },
  { k: 'Prompts',   hint: '24 · v7',        body: 'Versioned library, diff, A/B, gradual rollout.' },
  { k: 'Anomalies', hint: '3 open · high',  body: '7-day rolling baseline, z-score triggers.' },
  { k: 'Security',  hint: '48 masked',      body: 'PII · secrets · injection · jailbreak detectors.' },
  { k: 'Savings',   hint: '$7.2k / mo',     body: 'Swap, cache, trim. Ranked by evidence.' },
]

const COMPAT = [
  ['OpenAI', 'sdk · azure'],
  ['Anthropic', 'sdk · bedrock'],
  ['Google', 'gemini · vertex'],
  ['Mistral', 'sdk · api'],
  ['TypeScript SDK', '@spanlens/sdk'],
  ['Python SDK', 'pip · 3.9+'],
  ['LangChain', 'js · py'],
  ['LlamaIndex', 'py'],
]

const PLANS = [
  {
    name: 'Free', price: '$0', unit: 'forever',
    bullets: ['50k req / mo', '7 day retention', 'Unlimited projects', 'Community support'],
    cta: 'Start free', href: '/signup', primary: false,
  },
  {
    name: 'Pro', price: '$0.20', unit: 'per 1k req',
    bullets: ['Unlimited projects', '30 day retention', 'PII masking · detectors', 'Slack · PagerDuty · webhooks', 'Savings recommender'],
    cta: 'Start Pro trial', href: '/signup?plan=pro', primary: true, tag: 'Most teams',
  },
  {
    name: 'Enterprise', price: 'Custom', unit: 'annual contract',
    bullets: ['Self-hosted or dedicated', 'SSO · SAML · SCIM', 'HIPAA · BAA · DPA', '1y retention · audit export', 'Dedicated Slack channel'],
    cta: 'Contact sales', href: 'mailto:hi@spanlens.io', primary: false,
  },
]

const FAQS: [string, string][] = [
  ['How does instrumentation work?', 'Swap the provider SDK for our drop-in. Same surface, same types. We record the full request and response on the wire — no extra round-trip, no sampling by default.'],
  ['What about latency overhead?', 'p99 overhead is under 3ms. Ingestion happens async in a worker. If we ever fail, your request completes anyway — Spanlens never sits on the critical path.'],
  ['How do you handle PII?', 'Detectors run at log time, before persistence. Matches can be masked or blocked. Raw bodies can be kept in-memory only; only redacted copies land on disk.'],
  ['Do you support OpenTelemetry?', 'Yes — OTLP/HTTP ingest and export. Your existing OTel tracing flows into the same span store; LLM spans get LLM-specific attributes on top.'],
  ['What\'s the data retention?', 'Free is 7 days. Pro is 30 days by default, extendable. Enterprise & self-hosted are configurable up to 1 year.'],
  ['Can I export my data?', 'Anytime. JSON, CSV, Parquet. Or pipe the raw stream to S3, BigQuery, or your warehouse via our sink connectors.'],
]

const PREVIEW_ROWS = [
  { m: 'claude-sonnet-4.5', ep: '/chat',      lat: 1240, tok: '2,104', cost: '$0.0312', st: 200, age: '2s',  anom: false },
  { m: 'gpt-4o-mini',       ep: '/extract',   lat: 410,  tok: '612',   cost: '$0.0009', st: 200, age: '5s',  anom: false },
  { m: 'gpt-4o',            ep: '/summarize', lat: 3440, tok: '3,218', cost: '$0.0482', st: 200, age: '7s',  anom: true  },
  { m: 'gemini-2.0-flash',  ep: '/rerank',    lat: 180,  tok: '240',   cost: '$0.0001', st: 200, age: '9s',  anom: false },
  { m: 'claude-haiku-4.5',  ep: '/chat',      lat: 680,  tok: '984',   cost: '$0.0018', st: 200, age: '11s', anom: false },
  { m: 'gpt-4o',            ep: '/classify',  lat: 2120, tok: '1,840', cost: '$0.0276', st: 429, age: '14s', anom: false },
]

const TRACE_SPANS = [
  { name: 'agent.run',              depth: 0, start: 0,  width: 100, critical: false, label: '8.24s' },
  { name: 'classify_intent',        depth: 1, start: 2,  width: 6,   critical: false, label: '520ms' },
  { name: 'kb_search',              depth: 1, start: 9,  width: 8,   critical: false, label: '680ms' },
  { name: 'summarize_tickets · v7', depth: 1, start: 18, width: 70,  critical: true,  label: '5.8s · critical' },
  { name: 'llm.sonnet-4.5',         depth: 2, start: 20, width: 66,  critical: true,  label: '5.4s' },
  { name: 'format_reply',           depth: 1, start: 90, width: 6,   critical: false, label: '480ms' },
]

export default function LandingPage() {
  return (
    <div className="bg-bg text-text min-h-screen">

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <MarketingNav signupLabel="Start free →" />

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 pt-12 sm:pt-[64px] lg:pt-[88px] pb-10 sm:pb-[56px] lg:pb-[72px] relative">
        {/* Version badge */}
        <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-[5px] rounded-full border border-accent-border bg-accent-bg text-accent font-mono text-[12px] tracking-[0.03em] mb-7 max-w-full">
          <span className="bg-accent text-bg px-[7px] py-[2px] rounded-full text-[10px] font-semibold tracking-[0.05em] shrink-0">NEW</span>
          <span>Python SDK is here</span>
          <code className="font-mono hidden sm:inline">· pip install spanlens</code>
        </div>

        <h1 className="text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.96] tracking-[-2px] sm:tracking-[-2.8px] font-medium max-w-[980px] mb-7 [text-wrap:balance]">
          One line.<br />
          <span className="text-text-muted">Every LLM call,</span> observed.
        </h1>

        <p className="text-[16px] sm:text-[18px] lg:text-[20px] leading-relaxed text-text-muted max-w-[640px] mb-10 [text-wrap:pretty]">
          Record every OpenAI, Anthropic, and Gemini call — cost, latency, tokens, full
          request/response. Then surface anomalies, PII, and cheaper-model
          suggestions automatically.
        </p>

        {/* Install block — stacked on mobile, inline on sm+ */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-[18px]">
          <div className="flex items-center bg-bg-elev border border-border rounded-lg p-1 shadow-[0_1px_0_var(--border)] w-full sm:w-auto">
            <div className="px-[14px] py-2 font-mono text-[14px] flex-1 sm:flex-none">
              <span className="text-text-faint">$ </span>
              npx <span className="text-accent">@spanlens/cli</span> init
            </div>
            <CopyInstallButton />
          </div>
          <div className="flex items-center bg-bg-elev border border-border rounded-lg p-1 shadow-[0_1px_0_var(--border)] w-full sm:w-auto">
            <div className="px-[14px] py-2 font-mono text-[14px] flex-1 sm:flex-none">
              <span className="text-text-faint">$ </span>
              pip install <span className="text-accent">spanlens</span>
            </div>
            <CopyInstallButton text="pip install spanlens" />
          </div>
        </div>
        <div className="font-mono text-[13px] text-text-faint block">
          TypeScript · Python · Next.js, Node, Edge · MIT · self-hostable
        </div>

        {/* Floating signal pill — hidden on mobile/tablet, visible on lg+ */}
        <div className="hidden lg:block absolute top-[110px] right-10 w-[300px] bg-bg-elev border border-border rounded-[10px] p-[14px] shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] text-text-faint tracking-[0.06em] uppercase">Anomaly · 2 min ago</span>
            <span className="w-2 h-2 rounded-full bg-accent inline-block" />
          </div>
          <div className="text-[14px] font-medium mb-1.5">
            <span className="text-accent">gpt-4o</span> latency{' '}
            <span className="font-mono">4.2×</span> baseline
          </div>
          <div className="text-[12px] text-text-muted leading-snug">
            7-day p50 was 820ms. Last 20 calls averaged 3,440ms. Upstream?
          </div>
          {/* Mini sparkline */}
          <svg viewBox="0 0 272 36" className="w-full mt-2" style={{ display: 'block' }}>
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points="2,30 22,28 42,30 62,27 82,24 102,26 122,22 142,18 162,4 182,3 202,6 222,2 262,1"
            />
          </svg>
        </div>
      </section>

      {/* ── Early access waitlist ────────────────────────────────────── */}
      <section className="border-y border-border bg-bg-elev">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div>
            <p className="font-mono text-[11px] text-text-faint tracking-[0.08em] uppercase mb-1">Early access</p>
            <p className="text-[15px] font-medium text-text">
              Get priority access before the public launch.
            </p>
            <p className="text-[13px] text-text-muted mt-0.5">
              We&apos;re onboarding alpha users now — no credit card required.
            </p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      {/* ── Dashboard preview ───────────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-10 pb-20">
        <div className="max-w-[1200px] mx-auto">
          <div className="border border-border rounded-[14px] bg-bg-elev overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
            {/* Window chrome */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-muted">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-border-strong inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-border-strong inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-border-strong inline-block" />
              </div>
              <div className="flex-1 text-center font-mono text-[11px] text-text-faint tracking-[0.04em]">
                spanlens.io / requests
              </div>
              <div className="font-mono text-[11px] text-text-faint">LIVE</div>
            </div>
            {/* Filter chips */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border overflow-x-auto">
              {['All models', 'Last 24h', 'Status: all', '+ filter'].map((f, i) => (
                <span key={f} className={`px-[10px] py-1 border rounded-[6px] font-mono text-[11px] tracking-[0.03em] text-text-muted shrink-0 ${i < 3 ? 'border-border bg-bg-muted' : 'border-border'}`}>
                  {f}
                </span>
              ))}
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-text-faint shrink-0">12,481 events / 1h</span>
            </div>
            {/* Chart strip */}
            <div className="px-4 pt-3 pb-2 border-b border-border bg-bg h-[72px] flex items-end gap-[2px]">
              {Array.from({ length: 80 }).map((_, i) => {
                const h = 10 + Math.abs(Math.sin(i * 0.35)) * 50 + (i === 44 ? 18 : 0)
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-[1px]"
                    style={{
                      height: h,
                      background: i === 44 ? 'var(--accent)' : 'var(--border-strong)',
                    }}
                  />
                )
              })}
            </div>
            {/* Table — horizontally scrollable on mobile */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                {/* Table header */}
                <div className="grid px-5 py-[10px] border-b border-border font-mono text-[11px] text-text-faint tracking-[0.05em] uppercase" style={{ gridTemplateColumns: '1.8fr 1.2fr 0.8fr 0.8fr 0.9fr 0.7fr 0.7fr', gap: '16px' }}>
                  <span>Model</span><span>Endpoint</span><span>Latency</span><span>Tokens</span><span>Cost</span><span>Status</span><span>Age</span>
                </div>
                {PREVIEW_ROWS.map((r, i) => (
                  <div
                    key={i}
                    className="grid px-5 py-[14px] font-mono text-[13px] items-center"
                    style={{
                      gridTemplateColumns: '1.8fr 1.2fr 0.8fr 0.8fr 0.9fr 0.7fr 0.7fr',
                      gap: '16px',
                      borderBottom: i < PREVIEW_ROWS.length - 1 ? '1px solid var(--border)' : 'none',
                      background: r.anom ? 'var(--accent-bg)' : 'transparent',
                    }}
                  >
                    <span className="text-text flex items-center gap-2">
                      {r.anom && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 inline-block" />}
                      {r.m}
                    </span>
                    <span className="text-text-muted">{r.ep}</span>
                    <span style={{ color: r.anom ? 'var(--accent)' : 'var(--text)' }}>{r.lat}ms</span>
                    <span className="text-text-muted">{r.tok}</span>
                    <span className="text-text">{r.cost}</span>
                    <span style={{ color: r.st === 200 ? 'var(--good)' : 'var(--bad)' }}>{r.st}</span>
                    <span className="text-text-faint">{r.age}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature grid ─────────────────────────────────────────────── */}
      <section id="product" className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-16">
        <div className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between gap-4 mb-10">
          <div>
            <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-2.5">What you get</div>
            <h2 className="text-[28px] sm:text-[36px] lg:text-[44px] font-medium tracking-[-1.2px]">The lens. Not the weight.</h2>
          </div>
          <div className="text-[14px] text-text-muted lg:max-w-[340px] leading-relaxed">
            Spanlens sits in front of your provider. No agents to run. No SDK to rewrite.
            One <code className="font-mono text-text">baseURL</code> and you&apos;re done.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {FEATURES.map((f) => (
            <div key={f.kicker} className="bg-bg p-6 sm:p-8 min-h-[180px] sm:min-h-[220px]">
              <div className="flex items-baseline justify-between mb-4">
                <span className="font-mono text-[11px] text-text-faint tracking-[0.05em]">{f.kicker}</span>
                <span className="font-mono text-[12px] text-accent">{f.accent}</span>
              </div>
              <div className="text-[18px] sm:text-[20px] font-medium tracking-[-0.3px] mb-2.5">{f.title}</div>
              <div className="text-[14px] leading-[1.55] text-text-muted">{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cost callout ─────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-10 pb-20">
        <div className="border border-border rounded-xl bg-bg-elev p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
          <div>
            <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-3">Cost visibility</div>
            <h3 className="text-[24px] sm:text-[28px] lg:text-[34px] font-medium tracking-[-0.8px] leading-[1.1] mb-4">
              See the bill before it arrives.
            </h3>
            <p className="text-[15px] leading-[1.6] text-text-muted mb-6">
              Per-team, per-model, per-route cost. Daily rollups. Budget alerts by
              Slack or webhook. One place to answer &ldquo;why did our OpenAI bill jump?&rdquo;
            </p>
            <div className="flex flex-col gap-2.5">
              {[
                ['gpt-4o', '$421.80', '$182.40', '−57%'],
                ['claude-sonnet-4', '$189.40', '$192.20', '+1.5%'],
                ['gemini-2.0-flash', '$21.40', '$24.10', '+13%'],
              ].map(([m, was, now, d]) => (
                <div key={m} className="grid text-[13px] items-baseline" style={{ gridTemplateColumns: '1fr auto auto auto', gap: '16px' }}>
                  <span className="font-mono text-text-muted">{m}</span>
                  <span className="font-mono text-text-faint line-through">{was}</span>
                  <span className="font-mono text-text">{now}</span>
                  <span className="font-mono min-w-[48px] text-right" style={{ color: (d ?? '').startsWith('−') ? 'var(--good)' : 'var(--text-muted)' }}>{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-bg-muted rounded-[10px] border border-border p-6 flex flex-col justify-between">
            <div>
              <div className="font-mono text-[11px] text-text-faint tracking-[0.06em] uppercase mb-2">This month · projected</div>
              <div className="flex items-baseline gap-3 mb-1.5">
                <span className="text-[40px] sm:text-[48px] lg:text-[56px] font-medium tracking-[-2px] leading-none">$2,481</span>
                <span className="font-mono text-[14px] text-good">−$1,218</span>
              </div>
              <div className="text-[13px] text-text-muted">vs. last month. 3 model-swap suggestions pending.</div>
            </div>
            <svg viewBox="0 0 420 72" className="w-full mt-4" style={{ display: 'block' }}>
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points="2,55 24,52 46,58 68,48 90,42 112,45 134,38 156,33 178,42 200,58 222,62 244,66 266,68 288,70 310,70 332,68 354,69 376,70 418,71"
              />
            </svg>
            <div className="flex justify-between font-mono text-[11px] text-text-faint tracking-[0.04em]">
              <span>APR 01</span><span>APR 10</span><span>APR 23 ← today</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trace showcase ───────────────────────────────────────────── */}
      <section className="border-t border-b border-border bg-bg-elev">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-16 lg:py-20 flex flex-col lg:grid lg:gap-[60px] lg:items-center gap-10" style={{ gridTemplateColumns: '380px 1fr' }}>
          <div>
            <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-3">Agent tracing</div>
            <h2 className="text-[26px] sm:text-[34px] lg:text-[40px] font-medium tracking-[-1.1px] leading-[1.05] mb-[18px]">
              Find the one span<br />that cost you 18 seconds.
            </h2>
            <p className="text-[15px] leading-[1.6] text-text-muted mb-5">
              Multi-step agents as waterfall trees. Critical path, cost attribution,
              and latency outliers — highlighted automatically.
            </p>
            <div className="flex flex-col gap-2 font-mono text-[12px] text-text-muted">
              <div><span className="text-accent">●</span> critical path · 78% of wall-clock in 1 span</div>
              <div><span className="text-accent">●</span> cost attribution · per LLM, per tool</div>
              <div><span className="text-accent">●</span> retry & error spans as first-class</div>
            </div>
          </div>
          {/* Trace preview */}
          <div className="border border-border rounded-xl bg-bg overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-[10px] border-b border-border bg-bg-muted font-mono text-[11px] text-text-faint tracking-[0.04em] uppercase flex-wrap gap-y-1">
              <span className="text-text">trace_8812</span>
              <span>· support agent · 8.24s ·</span>
              <span className="text-accent">critical: summarize_tickets v7</span>
            </div>
            <div className="p-3 overflow-x-auto">
              <div className="min-w-[400px]">
                {TRACE_SPANS.map((s, i) => (
                  <div key={i} className="grid items-center py-1.5 gap-2.5" style={{ gridTemplateColumns: '220px 1fr 80px' }}>
                    <span
                      className="font-mono text-[11.5px]"
                      style={{
                        color: s.critical ? 'var(--accent)' : 'var(--text)',
                        paddingLeft: s.depth * 14,
                      }}
                    >
                      {s.depth > 0 && <span className="text-text-faint">└ </span>}
                      {s.name}
                    </span>
                    <div className="relative h-3.5 bg-bg-muted rounded-[2px]">
                      <div
                        className="absolute top-0 h-full rounded-[2px]"
                        style={{
                          left: `${s.start}%`,
                          width: `${s.width}%`,
                          background: s.critical ? 'var(--accent)' : 'var(--border-strong)',
                          border: s.critical ? '1px solid var(--accent-border)' : 'none',
                        }}
                      />
                    </div>
                    <span
                      className="font-mono text-[10.5px] text-right"
                      style={{ color: s.critical ? 'var(--accent)' : 'var(--text-muted)' }}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product surfaces ─────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 pt-16 sm:pt-24 pb-16">
        <div className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between gap-4 mb-10">
          <div>
            <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-2.5">The product</div>
            <h2 className="text-[28px] sm:text-[36px] lg:text-[44px] font-medium tracking-[-1.2px]">Six surfaces. One source of truth.</h2>
          </div>
          <div className="text-[14px] text-text-muted lg:max-w-[360px] leading-relaxed">
            Every screen reads the same span store. Move from a cost chart to the
            exact failing request in two clicks.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {SURFACES.map((s) => (
            <div key={s.k} className="bg-bg p-6 sm:p-7 min-h-[140px] sm:min-h-[160px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[18px] font-medium tracking-[-0.3px]">{s.k}</span>
                <span className="font-mono text-[11px] text-accent tracking-[0.03em]">{s.hint}</span>
              </div>
              <div className="text-[13px] leading-[1.55] text-text-muted">{s.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Compat strip ─────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-10 pb-16">
        <div className="font-mono text-[11px] text-text-faint tracking-[0.06em] uppercase mb-5">Works with</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-[10px] overflow-hidden">
          {COMPAT.map(([n, d]) => (
            <div key={n} className="bg-bg px-[18px] py-5 flex flex-col gap-1">
              <span className="text-[14px] font-medium tracking-[-0.2px]">{n}</span>
              <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">{d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Self-host ────────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-10 pb-20">
        <div className="border border-border rounded-xl bg-bg p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
          <div>
            <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-3">Self-hostable</div>
            <h3 className="text-[24px] sm:text-[28px] lg:text-[34px] font-medium tracking-[-0.8px] leading-[1.1] mb-4">Your data, your VPC.</h3>
            <p className="text-[15px] leading-[1.6] text-text-muted mb-6">
              Run Spanlens in your cluster with Docker Compose or a single binary.
              Prompts and completions never leave your network.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Link href="/docs/self-host" className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] hover:opacity-80 transition-opacity">Self-host docs →</Link>
              <span className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px]">docker-compose.yml</span>
              <span className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px]">Single binary</span>
            </div>
          </div>
          <div className="bg-[#0f0f10] text-[#e8e8e8] rounded-lg p-5 font-mono text-[12.5px] leading-[1.7] overflow-x-auto">
            <div className="text-[#7a7a7a] mb-1"># one-liner · docker</div>
            <div>docker run -d --name spanlens \</div>
            <div>{'  '}-p 3001:3001 \</div>
            <div>{'  '}-e <span className="text-[#b4e0a0]">SUPABASE_URL</span>=<span className="text-[#f2a65a]">&quot;https://...&quot;</span> \</div>
            <div>{'  '}-e <span className="text-[#b4e0a0]">ENCRYPTION_KEY</span>=<span className="text-[#f2a65a]">&quot;$(openssl rand -base64 32)&quot;</span> \</div>
            <div>{'  '}ghcr.io/sunes26/spanlens-server:latest</div>
            <div className="text-[#7a7a7a] mt-2.5"># → curl http://localhost:3001/health</div>
          </div>
        </div>
      </section>

      {/* ── Pricing preview ──────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-10 pb-20">
        <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-3">Pricing</div>
        <h2 className="text-[28px] sm:text-[36px] lg:text-[44px] font-medium tracking-[-1.2px] mb-2">Simple. Per request.</h2>
        <p className="text-[15px] text-text-muted mb-8 max-w-[560px]">
          Free while you&apos;re small. Paid by ingested request, not by seat. Self-host is free forever.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className="rounded-xl p-6 relative"
              style={{
                border: `1px solid ${p.primary ? 'var(--border-strong)' : 'var(--border)'}`,
                background: p.primary ? 'var(--bg-elev)' : 'var(--bg)',
              }}
            >
              {p.tag && (
                <span className="absolute -top-[9px] left-5 bg-accent text-bg font-mono text-[10px] px-2 py-[2px] rounded-full tracking-[0.04em] uppercase font-semibold">
                  {p.tag}
                </span>
              )}
              <div className="text-[14px] font-medium mb-[14px]">{p.name}</div>
              <div className="flex items-baseline gap-2 mb-[18px]">
                <span className="text-[32px] font-medium tracking-[-0.8px]">{p.price}</span>
                <span className="font-mono text-[11px] text-text-faint">{p.unit}</span>
              </div>
              <div className="flex flex-col gap-[7px] mb-[18px]">
                {p.bullets.map((b) => (
                  <div key={b} className="flex gap-2 text-[13px] text-text-muted items-start">
                    <span className="font-mono text-[11px] text-text-faint pt-px">—</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
              <Link
                href={p.href}
                className="block font-mono text-[12px] text-center py-2 px-3 rounded-md font-medium"
                style={{
                  background: p.primary ? 'var(--text)' : 'transparent',
                  color: p.primary ? 'var(--bg)' : 'var(--text)',
                  border: p.primary ? 'none' : '1px solid var(--border)',
                }}
              >
                {p.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-10 pb-20">
        <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-3">FAQ</div>
        <h2 className="text-[26px] sm:text-[34px] lg:text-[40px] font-medium tracking-[-1px] mb-8">Reasonable questions.</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {FAQS.map(([q, a]) => (
            <div key={q} className="bg-bg px-5 sm:px-7 py-6">
              <div className="text-[15px] font-medium mb-2 text-text">{q}</div>
              <div className="text-[13.5px] leading-[1.55] text-text-muted">{a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-16 sm:py-20 pb-20 sm:pb-24 text-center">
        <h2 className="text-[36px] sm:text-[48px] lg:text-[64px] font-medium tracking-[-2px] leading-[1.02] mb-5">
          See what your app is saying.
        </h2>
        <p className="text-[16px] sm:text-[17px] text-text-muted max-w-[540px] mx-auto leading-relaxed mb-8">
          30-second setup. Your first 50,000 requests are on us. Cancel anytime — there&apos;s nothing to cancel.
        </p>
        <div className="inline-flex flex-wrap justify-center gap-2.5">
          <Link href="/signup" className="font-mono text-[13px] text-bg bg-text px-[18px] py-[10px] rounded-[7px] font-medium hover:opacity-90 transition-opacity">
            Start free →
          </Link>
          <Link href="/docs" className="font-mono text-[13px] text-text px-[18px] py-[10px] rounded-[7px] border border-border-strong hover:opacity-80 transition-opacity">
            Read the docs
          </Link>
        </div>
      </section>

      {/* ── Install diff ─────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-10 pb-20">
        <div className="font-mono text-[12px] text-accent tracking-[0.06em] uppercase mb-3">Install</div>
        <h2 className="text-[28px] sm:text-[36px] lg:text-[44px] font-medium tracking-[-1.2px] mb-8">It&apos;s genuinely one line.</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-bg-elev border border-border rounded-xl overflow-hidden font-mono text-[14px] leading-[1.7]">
            <div className="flex border-b border-border bg-bg-muted px-4 py-2 font-mono text-[12px] tracking-[0.04em] text-text-faint uppercase">
              app/api/chat/route.ts
            </div>
            <pre className="m-0 px-4 sm:px-6 py-5 text-text whitespace-pre overflow-x-auto text-[12px] sm:text-[14px]">
{`- import OpenAI from 'openai'
- const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
+ `}<span className="text-accent">{`import { createOpenAI } from '@spanlens/sdk/openai'`}</span>{`
+ `}<span className="text-accent">{`const openai = createOpenAI()`}</span>{`

  const res = await openai.chat.completions.create({ ... })`}
            </pre>
          </div>
          <div className="bg-bg-elev border border-border rounded-xl overflow-hidden font-mono text-[14px] leading-[1.7]">
            <div className="flex border-b border-border bg-bg-muted px-4 py-2 font-mono text-[12px] tracking-[0.04em] text-text-faint uppercase">
              app/main.py
            </div>
            <pre className="m-0 px-4 sm:px-6 py-5 text-text whitespace-pre overflow-x-auto text-[12px] sm:text-[14px]">
{`- from openai import OpenAI
- client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
+ `}<span className="text-accent">{`from spanlens.integrations.openai import create_openai`}</span>{`
+ `}<span className="text-accent">{`client = create_openai()`}</span>{`

  res = client.chat.completions.create(...)`}
            </pre>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
