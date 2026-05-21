/**
 * Static SVG diagrams used across /docs pages.
 *
 * Server-renderable (no 'use client'). Each component is a self-contained
 * <figure> with caption — drop into a docs page wherever conceptual
 * visualization helps.
 *
 * Color tokens mirror the docs prose theme:
 *   accent           : #c2410c (orange-700)  — primary edges + labels
 *   accent-bg        : #fef2e8                — accent highlight blocks
 *   border           : #e7e2da                — neutral box outlines
 *   text             : #1c1a17                — body text
 *   text-muted       : #6b6056                — secondary labels
 *   text-faint       : #9a9189                — captions
 */

interface FigureProps {
  caption: string
  children: React.ReactNode
}

function Figure({ caption, children }: FigureProps) {
  return (
    <figure className="not-prose my-6">
      <div className="rounded-lg border border-border bg-bg-elev p-4 overflow-x-auto">
        {children}
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground text-center">
        {caption}
      </figcaption>
    </figure>
  )
}

const COLORS = {
  accent: '#c2410c',
  accentBg: '#fef2e8',
  border: '#d6cfc4',
  borderStrong: '#a89c8d',
  text: '#1c1a17',
  textMuted: '#6b6056',
  bg: '#fbfaf7',
}

function Box({
  x,
  y,
  w,
  h,
  label,
  sub,
  fill = COLORS.bg,
  stroke = COLORS.border,
  textColor = COLORS.text,
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  sub?: string
  fill?: string
  stroke?: string
  textColor?: string
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 4 : h / 2 + 4)} textAnchor="middle" fontSize={13} fontWeight={600} fill={textColor} fontFamily="ui-sans-serif, system-ui">
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={11} fill={COLORS.textMuted} fontFamily="ui-monospace, monospace">
          {sub}
        </text>
      )}
    </g>
  )
}

function Arrow({ x1, y1, x2, y2, label, dashed = false, color = COLORS.borderStrong }: { x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: boolean; color?: string }) {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '4 3' : undefined}
        markerEnd="url(#arrow)"
      />
      {label && (
        <text x={midX} y={midY - 4} textAnchor="middle" fontSize={10} fill={COLORS.textMuted} fontFamily="ui-monospace, monospace">
          {label}
        </text>
      )}
    </g>
  )
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.borderStrong} />
      </marker>
      <marker id="arrowAccent" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.accent} />
      </marker>
    </defs>
  )
}

/* ───────────────────────────── 1. Quick start: SDK flow ───────────────────────────── */

export function QuickStartFlowDiagram() {
  return (
    <Figure caption="Spanlens sits between your app and the LLM provider. Logging happens out-of-band via Vercel waitUntil, so it adds 10–50 ms — never blocks the response.">
      <svg viewBox="0 0 620 220" className="w-full h-auto" role="img" aria-label="SDK integration flow">
        <ArrowDefs />
        <Box x={20} y={70} w={130} h={56} label="Your app" sub="@spanlens/sdk" />
        <Box x={200} y={70} w={150} h={56} label="Spanlens proxy" sub="decrypt + forward" />
        <Box x={400} y={70} w={180} h={56} label="OpenAI / Anthropic" sub="Gemini / Azure" />
        <Arrow x1={150} y1={98} x2={200} y2={98} label="sl_live_…" />
        <Arrow x1={350} y1={98} x2={400} y2={98} label="real key" />
        <Box x={200} y={160} w={150} h={42} label="ClickHouse" sub="fire-and-forget" fill={COLORS.accentBg} stroke={COLORS.accent} textColor={COLORS.accent} />
        <Arrow x1={275} y1={126} x2={275} y2={160} label="log" color={COLORS.accent} />
        <Box x={400} y={160} w={180} h={42} label="/requests dashboard" />
        <Arrow x1={350} y1={181} x2={400} y2={181} dashed />
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 2. OTel: attribute mapping ───────────────────────────── */

export function OtelMappingDiagram() {
  const rows = [
    { otel: 'gen_ai.system', sl: 'provider' },
    { otel: 'gen_ai.request.model', sl: 'model' },
    { otel: 'gen_ai.usage.input_tokens', sl: 'prompt_tokens' },
    { otel: 'gen_ai.usage.output_tokens', sl: 'completion_tokens' },
    { otel: 'gen_ai.input.messages', sl: 'request_body' },
    { otel: 'gen_ai.output.messages', sl: 'response_body' },
  ]
  return (
    <Figure caption="Spanlens maps the OpenTelemetry GenAI semantic conventions to its own columns. Any OTel SDK that follows the spec is automatically compatible.">
      <svg viewBox="0 0 620 270" className="w-full h-auto" role="img" aria-label="OTel attribute mapping">
        <ArrowDefs />
        <text x={100} y={28} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.textMuted} fontFamily="ui-sans-serif, system-ui">OTEL ATTRIBUTE</text>
        <text x={420} y={28} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.textMuted} fontFamily="ui-sans-serif, system-ui">SPANLENS FIELD</text>
        {rows.map((r, i) => {
          const y = 50 + i * 34
          return (
            <g key={r.otel}>
              <rect x={10} y={y} width={200} height={26} rx={4} fill={COLORS.bg} stroke={COLORS.border} />
              <text x={110} y={y + 17} textAnchor="middle" fontSize={11} fill={COLORS.text} fontFamily="ui-monospace, monospace">{r.otel}</text>
              <Arrow x1={210} y1={y + 13} x2={330} y2={y + 13} />
              <rect x={330} y={y} width={180} height={26} rx={4} fill={COLORS.accentBg} stroke={COLORS.accent} />
              <text x={420} y={y + 17} textAnchor="middle" fontSize={11} fill={COLORS.accent} fontFamily="ui-monospace, monospace" fontWeight={600}>{r.sl}</text>
            </g>
          )
        })}
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 3. Self-host: Docker architecture ───────────────────────────── */

export function SelfHostArchitectureDiagram() {
  return (
    <Figure caption="Self-host topology: web + server containers behind your reverse proxy, with Supabase (Postgres) and ClickHouse as external data stores.">
      <svg viewBox="0 0 620 320" className="w-full h-auto" role="img" aria-label="Self-host architecture">
        <ArrowDefs />
        {/* Reverse proxy */}
        <Box x={20} y={130} w={120} h={50} label="Reverse proxy" sub="Caddy / nginx" />
        {/* Docker box */}
        <rect x={180} y={30} width={250} height={260} rx={8} fill="none" stroke={COLORS.borderStrong} strokeWidth={1.5} strokeDasharray="6 3" />
        <text x={305} y={50} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.textMuted} fontFamily="ui-monospace, monospace">docker-compose</text>
        <Box x={200} y={75} w={210} h={56} label="apps/web" sub="Next.js · :3000" />
        <Box x={200} y={155} w={210} h={56} label="apps/server" sub="Hono · :3001" />
        <Arrow x1={305} y1={131} x2={305} y2={155} />
        {/* External data */}
        <Box x={470} y={75} w={130} h={56} label="Supabase" sub="auth + OLTP" />
        <Box x={470} y={155} w={130} h={56} label="ClickHouse" sub="requests OLAP" />
        <Arrow x1={410} y1={103} x2={470} y2={103} />
        <Arrow x1={410} y1={183} x2={470} y2={183} />
        {/* Client */}
        <Box x={20} y={30} w={120} h={50} label="Browser" sub="HTTPS" />
        <Arrow x1={80} y1={80} x2={80} y2={130} />
        <Arrow x1={140} y1={155} x2={200} y2={103} label="3000" />
        <Arrow x1={140} y1={155} x2={200} y2={183} label="3001" />
        {/* Client to proxy */}
        <text x={305} y={305} textAnchor="middle" fontSize={11} fill={COLORS.textMuted} fontFamily="ui-sans-serif, system-ui">
          One <tspan fontFamily="ui-monospace, monospace" fill={COLORS.accent}>docker compose up</tspan> brings up both containers.
        </text>
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 4. Traces: Gantt waterfall + Critical Path ───────────────────────────── */

export function TraceWaterfallDiagram() {
  // Spans (relative time 0..1.8s)
  const spans = [
    { label: 'answer-question', x: 0, w: 1.8, depth: 0, critical: true },
    { label: 'retrieve', x: 0, w: 0.12, depth: 1, critical: false },
    { label: 'generate', x: 0.12, w: 1.4, depth: 1, critical: true },
    { label: 'openai.chat', x: 0.12, w: 1.4, depth: 2, critical: true },
    { label: 'rerank', x: 1.52, w: 0.28, depth: 1, critical: false },
  ]
  const W = 590 // bar area width
  const ORIGIN_X = 250
  const scale = (s: number) => (s / 1.8) * W
  return (
    <Figure caption="Illustrative agent trace: answer-question (parent) fans out to retrieve, generate, and rerank in parallel. The Critical Path (orange) traces the longest dependency chain — answer-question → generate → openai.chat — which is what sets the total wall-clock time. Off-critical spans (grey) can be optimized but won't shorten total latency.">
      <svg viewBox="0 0 880 380" className="w-full h-auto" role="img" aria-label="Trace waterfall">
        <ArrowDefs />
        {/* Time axis */}
        <line x1={ORIGIN_X} y1={300} x2={ORIGIN_X + W} y2={300} stroke={COLORS.border} />
        {[0, 0.5, 1.0, 1.5, 1.8].map((t) => (
          <g key={t}>
            <line x1={ORIGIN_X + scale(t)} y1={300} x2={ORIGIN_X + scale(t)} y2={307} stroke={COLORS.borderStrong} />
            <text x={ORIGIN_X + scale(t)} y={326} textAnchor="middle" fontSize={17} fill={COLORS.textMuted} fontFamily="ui-monospace, monospace">{t}s</text>
          </g>
        ))}
        {spans.map((s, i) => {
          const y = 25 + i * 46
          const barX = ORIGIN_X + scale(s.x)
          const barW = Math.max(scale(s.w), 4)
          const fill = s.critical ? COLORS.accent : COLORS.borderStrong
          const labelText = '  '.repeat(s.depth) + (s.depth > 0 ? '└─ ' : '') + s.label
          return (
            <g key={i}>
              <text x={ORIGIN_X - 14} y={y + 23} textAnchor="end" fontSize={18} fill={s.critical ? COLORS.accent : COLORS.text} fontWeight={s.critical ? 600 : 400} fontFamily="ui-monospace, monospace">{labelText}</text>
              <rect x={barX} y={y + 4} width={barW} height={30} rx={4} fill={fill} fillOpacity={s.critical ? 0.85 : 0.55} />
              <text x={barX + barW + 10} y={y + 27} fontSize={16} fill={COLORS.textMuted} fontFamily="ui-monospace, monospace">{(s.w * 1000).toFixed(0)}ms</text>
            </g>
          )
        })}
        {/* Legend */}
        <rect x={ORIGIN_X} y={350} width={18} height={15} fill={COLORS.accent} fillOpacity={0.85} />
        <text x={ORIGIN_X + 28} y={362} fontSize={16} fill={COLORS.text} fontFamily="ui-sans-serif, system-ui">Critical Path</text>
        <rect x={ORIGIN_X + 180} y={350} width={18} height={15} fill={COLORS.borderStrong} fillOpacity={0.55} />
        <text x={ORIGIN_X + 208} y={362} fontSize={16} fill={COLORS.text} fontFamily="ui-sans-serif, system-ui">Off-critical span</text>
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 5. Alerts: Evaluation loop ───────────────────────────── */

export function AlertLoopDiagram() {
  return (
    <Figure caption="Alerts evaluate on a 1-minute tick. A rule that breaches its threshold for N consecutive evaluations fires once, then enters a cooldown to prevent storms.">
      <svg viewBox="0 0 620 140" className="w-full h-auto" role="img" aria-label="Alert evaluation loop">
        <ArrowDefs />
        <Box x={20} y={45} w={110} h={50} label="Cron tick" sub="every 60s" />
        <Box x={170} y={45} w={130} h={50} label="Query metrics" sub="ClickHouse" />
        <Box x={330} y={45} w={130} h={50} label="Compare threshold" sub="N consecutive?" />
        <Box x={495} y={45} w={110} h={50} label="Fire" sub="webhook + email" fill={COLORS.accentBg} stroke={COLORS.accent} textColor={COLORS.accent} />
        <Arrow x1={130} y1={70} x2={170} y2={70} />
        <Arrow x1={300} y1={70} x2={330} y2={70} />
        <Arrow x1={460} y1={70} x2={495} y2={70} color={COLORS.accent} />
        {/* Cooldown loop */}
        <path d="M 550 95 Q 550 130 470 130 Q 75 130 75 95" fill="none" stroke={COLORS.borderStrong} strokeDasharray="4 3" strokeWidth={1.5} markerEnd="url(#arrow)" />
        <text x={310} y={125} textAnchor="middle" fontSize={10} fill={COLORS.textMuted} fontFamily="ui-monospace, monospace">cooldown · default 10 min</text>
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 6. Datasets: Item schema ───────────────────────────── */

export function DatasetSchemaDiagram() {
  return (
    <Figure caption="Each dataset item carries an input, an optional expected output for grading, and free-form metadata. Evals and Experiments consume the same shape.">
      <svg viewBox="0 0 620 220" className="w-full h-auto" role="img" aria-label="Dataset item schema">
        <ArrowDefs />
        <rect x={20} y={20} width={380} height={180} rx={8} fill={COLORS.bg} stroke={COLORS.borderStrong} strokeWidth={1.5} />
        <text x={210} y={42} textAnchor="middle" fontSize={12} fontWeight={700} fill={COLORS.text} fontFamily="ui-monospace, monospace">DatasetItem</text>
        {[
          { f: 'id', t: 'string', n: 'auto' },
          { f: 'input', t: 'object', n: 'OpenAI messages shape' },
          { f: 'expected_output', t: 'string | null', n: 'grading target (optional)' },
          { f: 'metadata', t: 'jsonb', n: 'tags, source, weights' },
        ].map((row, i) => {
          const y = 65 + i * 30
          return (
            <g key={row.f}>
              <text x={35} y={y + 14} fontSize={11} fontFamily="ui-monospace, monospace" fontWeight={600} fill={COLORS.accent}>{row.f}</text>
              <text x={175} y={y + 14} fontSize={11} fontFamily="ui-monospace, monospace" fill={COLORS.textMuted}>{row.t}</text>
              <text x={275} y={y + 14} fontSize={10} fontFamily="ui-sans-serif, system-ui" fill={COLORS.textMuted}>{row.n}</text>
            </g>
          )
        })}
        <Box x={440} y={50} w={160} h={48} label="Evals" sub="LLM-as-judge score" />
        <Box x={440} y={130} w={160} h={48} label="Experiments" sub="diff v1 vs v2" />
        <Arrow x1={400} y1={90} x2={440} y2={74} />
        <Arrow x1={400} y1={120} x2={440} y2={154} />
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 7. Projects: Keys hierarchy ───────────────────────────── */

export function ProjectsHierarchyDiagram() {
  return (
    <Figure caption="One Organization owns many Projects. Each Project has one or more Spanlens keys (issued to your code) and one Provider key per upstream (encrypted at rest).">
      <svg viewBox="0 0 620 280" className="w-full h-auto" role="img" aria-label="Projects/keys hierarchy">
        <ArrowDefs />
        <Box x={230} y={10} w={170} h={48} label="Organization" sub="acme-corp" />
        <Box x={120} y={90} w={170} h={48} label="Project: production" />
        <Box x={340} y={90} w={170} h={48} label="Project: staging" />
        <Arrow x1={315} y1={58} x2={205} y2={90} />
        <Arrow x1={315} y1={58} x2={425} y2={90} />
        <Box x={20} y={180} w={150} h={48} label="Spanlens key" sub="sl_live_… (issued)" fill={COLORS.accentBg} stroke={COLORS.accent} textColor={COLORS.accent} />
        <Box x={185} y={180} w={120} h={48} label="OpenAI" sub="encrypted" />
        <Box x={320} y={180} w={120} h={48} label="Anthropic" sub="encrypted" />
        <Box x={455} y={180} w={120} h={48} label="Gemini" sub="encrypted" />
        <Arrow x1={205} y1={138} x2={95} y2={180} />
        <Arrow x1={205} y1={138} x2={245} y2={180} />
        <Arrow x1={205} y1={138} x2={380} y2={180} />
        <Arrow x1={205} y1={138} x2={515} y2={180} />
        <text x={310} y={260} textAnchor="middle" fontSize={11} fill={COLORS.textMuted} fontFamily="ui-sans-serif, system-ui">
          One <tspan fontFamily="ui-monospace, monospace" fill={COLORS.accent}>sl_live_…</tspan> covers every provider key under its project.
        </text>
      </svg>
    </Figure>
  )
}

/* ───────────────────────────── 8. Settings: AES-256-GCM encryption ───────────────────────────── */

export function EncryptionFlowDiagram() {
  return (
    <Figure caption="Provider keys are AES-256-GCM encrypted at rest. They&apos;re only decrypted in-memory at proxy time to set the upstream Authorization header, never logged.">
      <svg viewBox="0 0 620 200" className="w-full h-auto" role="img" aria-label="Encryption flow">
        <ArrowDefs />
        <Box x={20} y={60} w={120} h={56} label="Provider key" sub="sk-… (plaintext)" />
        <Box x={180} y={60} w={150} h={56} label="AES-256-GCM" sub="ENCRYPTION_KEY + IV" fill={COLORS.accentBg} stroke={COLORS.accent} textColor={COLORS.accent} />
        <Box x={370} y={60} w={120} h={56} label="ciphertext" sub="+ auth tag" />
        <Box x={520} y={60} w={80} h={56} label="DB" sub="Supabase" />
        <Arrow x1={140} y1={88} x2={180} y2={88} />
        <Arrow x1={330} y1={88} x2={370} y2={88} color={COLORS.accent} />
        <Arrow x1={490} y1={88} x2={520} y2={88} />
        {/* Decryption note */}
        <text x={310} y={150} textAnchor="middle" fontSize={11} fill={COLORS.textMuted} fontFamily="ui-sans-serif, system-ui">
          Decrypt only at request time → set <tspan fontFamily="ui-monospace, monospace" fill={COLORS.accent}>Authorization</tspan> header → discard.
        </text>
        <text x={310} y={170} textAnchor="middle" fontSize={11} fill={COLORS.textMuted} fontFamily="ui-sans-serif, system-ui">
          Lose <tspan fontFamily="ui-monospace, monospace" fill={COLORS.accent}>ENCRYPTION_KEY</tspan> → every stored provider key is unrecoverable.
        </text>
      </svg>
    </Figure>
  )
}
