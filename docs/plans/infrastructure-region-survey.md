# Infrastructure Region Survey — 2026-05-18

> **Plan reference:** `docs/plans/launch-readiness-master-plan.md` § P1.7
> **Owner:** sunes26
> **Refresh cadence:** review whenever a new infra provider is added or an
> existing one is moved between regions.

This doc enumerates every place customer data sits at rest or transits in
flight, with the **legal jurisdiction** that applies, the **physical
region** the provider runs in, and the **mitigations** Spanlens has in place.
It exists for three purposes:

1. **Internal awareness** — Single solo maintainer; if a customer asks
   "where is my data," this is the answer sheet.
2. **DPA input (P1.6, legal track)** — Privacy Policy and the GDPR Data
   Processing Addendum need this verbatim.
3. **EU-region PoC trigger criteria (§ "When to revisit")** — captures the
   cost/effort math so we don't relitigate it every customer call.

---

## Current footprint (2026-05-18)

| Component                | Provider           | Region (physical)        | Jurisdiction | Data classes              | How verified |
|--------------------------|--------------------|--------------------------|--------------|---------------------------|--------------|
| Proxy / API functions    | Vercel             | `iad1` (Washington DC, US East) | US           | API key SHA-256, request/response bodies (in-flight), trace metadata | `vercel inspect` of latest prod deployment — `λ api/index … [iad1]` |
| Marketing / dashboard    | Vercel             | `iad1` (Washington DC, US East) | US           | Session cookies (HTTP-only), no request bodies | `vercel inspect` of `spanlens-web` deployment — all routes `[iad1]` |
| Edge cache / TLS termination | Vercel Edge Network | Global anycast (e.g. `icn1` Seoul observed for KR clients) | Distributed  | TLS handshake, response headers only — no body persistence at the edge | `X-Vercel-Id: icn1::iad1::…` header on `/health` from Seoul client |
| Postgres (auth, orgs, projects, keys, billing) | Supabase | `ap-northeast-2` Seoul (Northeast Asia) | South Korea  | User accounts, org membership, encrypted provider keys (AES-256-GCM), billing metadata | `supabase projects list` — "Northeast Asia (Seoul)" |
| Request log store        | ClickHouse Cloud   | **⏸️ Operator verification pending** — likely `us-east-1` Development tier; confirm by checking `CLICKHOUSE_URL` host suffix in Vercel env  | likely US    | Full `requests` table — request/response bodies, tokens, cost, latency | Need `vercel env pull` + parse host (action item below) |
| Rate-limit / KV          | Upstash Redis      | `IAD1` (US East)         | US           | Sliding-window counters keyed by `proxy:{org_id}` and `api:{token_hash}`; TTL 60s — no body content | Master plan note 2026-05-18 (P1.1): `upstash-kv-aqua-flask, Free tier, IAD1` |
| Error monitoring         | Sentry             | Default US (`*.ingest.sentry.io`) | US           | Stack traces with secrets/tokens redacted by `beforeSend` | `lib/sentry.ts` + Sentry project DSN (US suffix in DSN) |
| Transactional email      | Resend             | US default               | US           | Recipient address, subject, body (invite emails, key-leak alerts) | Resend's region option is opt-in EU; we are on default |
| Billing / payments       | Paddle Billing     | Ireland (EU)             | EU/Ireland   | Card / IBAN / customer name & address (Paddle is **Merchant of Record** — they hold the financial PII, not us) | Paddle entity = `Paddle.com Market Limited`, Dublin |
| Marketing analytics      | None deployed yet  | n/a                      | n/a          | n/a                       | Grep — no GA / PostHog / Plausible scripts in `apps/web/app/layout.tsx` |

### Data-flow summary

- **In-flight**: TLS terminates at the nearest Vercel edge POP (Seoul, Tokyo,
  Frankfurt, etc. depending on the client), then proxies to the `iad1`
  function. Outbound LLM calls leave `iad1` directly to OpenAI / Anthropic /
  Google.
- **At rest**: Account data in Seoul (Supabase), request logs and KV
  counters in US East (ClickHouse Cloud + Upstash), payment data in Ireland
  (Paddle).
- **Encryption**: All inter-region hops are TLS 1.2+. Provider keys are
  AES-256-GCM at rest in Supabase. Request bodies are stored unencrypted at
  the column level in ClickHouse — protected by ClickHouse Cloud's
  underlying disk encryption only.

### Trans-border transfers (GDPR Art. 44 lens)

| From → To                                | Mechanism                        |
|------------------------------------------|----------------------------------|
| EU customer → `iad1` (proxy)             | Standard Contractual Clauses (SCC) — Vercel is the processor; we are the controller |
| EU customer → Supabase Seoul             | SCC + adequacy decision (KR was adequacy-recognized by the EU Commission in 2026-01) |
| EU customer → ClickHouse Cloud `us-east-1` | SCC (assuming US East; reconfirm in action item) |
| EU customer → Upstash `IAD1`             | SCC                              |
| EU customer → Sentry US / Resend US      | SCC                              |
| EU customer → Paddle IE                  | Intra-EU, no SCC needed          |

---

## EU residency — cost / effort analysis

Source pricing observed 2026-05-18 from each provider's public pricing page.
Numbers are USD/month at our current development tier (replaceable when we
land a real EU customer ask).

| Component                 | Single-region (today)     | Dual-region with EU mirror  | Notes                              |
|---------------------------|---------------------------|-----------------------------|------------------------------------|
| Vercel functions          | $0 (Hobby) → $20 (Pro)    | $20 — Pro lets you set per-project default region. No per-region cost. | Just toggle `regions: ['fra1']` on a second project. |
| Supabase                  | $0 Free / $25 Pro         | $50 (two Pro projects)      | No multi-region within a single project; provision a second EU project. Data sync is on us. |
| ClickHouse Cloud          | $50 Dev tier (US)         | $100 (two Dev tiers)        | Cloud doesn't offer multi-region replication on Dev tier; need Production tier ($200+) or app-level fan-out. |
| Upstash Redis             | $0 Free / $10 Pay-as-go   | $0–$20 (regional Redis is per-instance) | Globally replicated tier exists ($60+/mo) — overkill for rate-limit only. |
| Paddle                    | n/a (single org, EU-based) | n/a                         | Paddle handles geo on their side. |
| Sentry                    | $0 Developer              | $0 (Sentry has EU data residency without extra cost on paid plans) | Toggle on signup; can't switch existing org. |
| Resend                    | $0 Free (3K emails/mo)    | $20 Pro (multi-region available) | Configurable per-key region. |
| **Total ground-floor cost** | **~$50/mo**             | **~$120/mo**                | Excluding engineering effort below. |

**Engineering effort** (rough order of magnitude — not committed):

| Work item                                           | Estimate |
|-----------------------------------------------------|----------|
| `organizations.data_region` column + signup flow    | 1 day    |
| Proxy routing by `data_region` (geo-DNS or per-region Vercel project) | 3 days |
| Supabase EU project provisioning + schema mirror via migrations | 2 days |
| ClickHouse EU instance + dual-write or per-org routing | 3 days |
| Backfill / migration path for an org switching regions | 2 days (deferred — start as "region is permanent") |
| Documentation + DPA addendum                        | 1 day    |
| **Total**                                           | **~12 working days** |

### Decision (2026-05-18)

**Do not build EU residency yet.** Triggers that would flip this:

1. ≥1 EU paying customer with a contractual EU-only data requirement, **or**
2. ≥3 EU paying customers without a hard requirement (still worth building
   for the sales narrative), **or**
3. A specific compliance ask (SOC 2 customer demands data locality, etc.)

Until one of those fires, the mitigation is: be explicit in the DPA about
the US/Seoul split, rely on SCC, and surface a "Data location" line in the
sign-up confirmation page (P1.6 will land this when Privacy Policy is
finalized).

### When the trigger fires

The single technical decision point is **which** of the two paths to take:

- **Path A — Per-region Vercel project, app-level routing.** Cheapest, most
  flexible, but doubles ops surface area.
- **Path B — Vercel Pro multi-region from the same project (`vercel.json`
  `regions: ['iad1', 'fra1']`).** Simpler config, but functions run
  everywhere by default — DB lookups can cross regions if not pinned, which
  defeats the residency goal.

If/when triggered: spin off `docs/plans/eu-region-architecture.md` and
default to Path A unless a customer has specific latency asks (in which
case Path B may justify the extra complexity).

---

## Action items

> Tracked here, not in the master plan, because they are housekeeping
> rather than P1 success criteria.

- [ ] **Confirm ClickHouse Cloud region.** Run `vercel env pull` against
  `spanlens-server`, read the host suffix of `CLICKHOUSE_URL`
  (`*.us-east-1.aws.clickhouse.cloud` vs `*.eu-west-1.aws.clickhouse.cloud`
  vs other) and update the table above.
- [ ] **Sentry EU residency on next paid upgrade.** Sentry's EU data
  storage is a paid-plan org-level setting and **not** migratable for an
  existing org. If we ever migrate to a paid plan, do it on the same day so
  we don't pay then re-migrate.
- [ ] **Resend region.** Free tier is US-only; if/when an EU customer asks
  about outbound email residency, regenerate the API key with the EU
  region option set.
- [ ] **Marketing copy disclaimer (deferred to P1.6).** Once Privacy Policy
  1.0 lands, add a single-line "Data is stored in the US (request logs) and
  Seoul, KR (account data)" line under the pricing FAQ. Today the landing
  page does not claim "global" or "worldwide" in a residency-relevant
  context (`terms/page.tsx:188` uses "worldwide royalty-free license," which
  is the standard SaaS terms-of-service phrasing and not a data-residency
  claim).

## How this doc relates to the master plan

| Master plan checkbox                                 | Status |
|------------------------------------------------------|--------|
| 현 인프라 리전 전수 확인 + 문서화                       | ✅ this doc |
| DPA에 데이터 위치 명시 (SCC 포함)                       | ⏸️ legal track (P1.6) — input ready here |
| EU 리전 옵션 비용 분석 완료                              | ✅ "EU residency — cost / effort analysis" above |
| PoC 진행 여부 의사결정 — 첫 EU 유료 고객 발생 후 트리거    | ✅ "Decision (2026-05-18)" above |
| (PoC 진행 시) 별도 `eu-region-architecture.md` plan 작성 | ⏸️ not triggered |
| 마케팅에서 "글로벌" 표현 시 데이터 위치 disclaimer 포함    | ✅ landing reviewed — no offending copy today |
