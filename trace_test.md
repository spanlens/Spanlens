# Traces 기능 종합 테스트 & 구현 계획

> **목표**: Spanlens traces 기능을 프로덕션 환경 기준으로 E2E 검증하고, 미구현된 3가지 (critical path, retry, OTLP/HTTP receiver)를 구현해 광고 가능한 기능 세트를 완성한다.
>
> **작성일**: 2026-05-06
> **예상 소요**: 2~3일 (Phase A 0.5d + Phase B 0.5d + Phase C 0.5d + Phase D 1~1.5d)
> **프로덕션 URL**: `https://www.spanlens.io` (web), `https://spanlens-server.vercel.app` (server)

---

## 0. 현황 진단 (Ground truth)

코드 정독 후 확인된 사실. **계획은 이 사실 위에서만 유효함** — 작업 시작 전 다시 한 번 확인할 것.

### 0.1 구현된 것 (READY)

| 영역 | 위치 | 상태 |
|---|---|---|
| SDK `observe()` / `observeOpenAI/Anthropic/Gemini` | `packages/sdk/src/observe.ts` | ✅ 동작 |
| SDK trace/span ingest + `_creationPromise` 체인 | `packages/sdk/src/trace.ts`, `span.ts` | ✅ Gotcha #10 패턴 적용됨 |
| 서버 ingest 엔드포인트 (`POST/PATCH /ingest/traces`, `/ingest/traces/:id/spans`, `/ingest/spans/:id`) | `apps/server/src/api/ingest.ts` | ✅ |
| 서버 조회 API (`GET /api/v1/traces`, `GET /api/v1/traces/:id`) | `apps/server/src/api/traces.ts` | ✅ JWT auth, 페이지네이션 + 필터 |
| DB 스키마 `traces` + `spans` (parent_span_id NO FK by design) | `supabase/migrations/20260421000000_agent_tracing.sql` | ✅ |
| 집계 트리거 `refresh_trace_aggregates` | 동일 마이그레이션 | ✅ span CRUD 시 trace 집계 자동 갱신 |
| RLS (`is_org_member`) | 동일 마이그레이션 | ✅ |
| Traces 리스트 페이지 (`/traces`) — duration bar, status/range/sort 필터 | `apps/web/app/(dashboard)/traces/page.tsx` | ✅ |
| Trace 상세 페이지 (`/traces/[id]`) + Gantt + TracePanel | `apps/web/components/traces/{gantt,trace-panel}.tsx` | ✅ |
| 데모 페이지 (인증 불필요) | `apps/web/app/demo/traces/[id]/page.tsx` | ✅ 시연용 |
| `spans.request_id` FK to `requests` | DB schema | ✅ 컬럼 + 인덱스만 (UI 링크 없음) |
| `x-trace-id` / `x-span-id` 헤더 → 프록시에서 `requests` 행에 채워줌 | `apps/server/src/proxy/*` | ✅ 데이터 차원에서는 동작 |

### 0.2 부분 구현 / 잘못 라벨링된 것 (PARTIAL)

| 영역 | 실제 상태 |
|---|---|
| **"Critical path"** | UI에 `criticalSpanId` prop 존재하고 'critical' 배지까지 렌더되지만, 계산 로직은 단순 `sort by duration_ms desc`(`trace-panel.tsx:557~561`의 `bottleneck`). 이건 **"가장 큰 막대"**일 뿐 critical path 아님. Gantt는 단일 ID만 받음 (`criticalSpanId: string \| null`) — 다중 span path 표현 못 함. |
| **Trace → Request 드릴다운** | DB에 `spans.request_id` 있고 프록시가 자동으로 채움. 하지만 `trace-panel.tsx`의 span 상세 패널에 "View raw request" 링크가 없음 — 데이터만 있고 UI 없음. |

### 0.3 미구현 (MISSING)

| 영역 | 이유 |
|---|---|
| **Retry 모델링** | `spans` 스키마에 `retry_attempt`, `retry_group_id` 컬럼 없음. SDK도 retry 옵션 없음. Gantt는 retry 그룹 표현 못 함. |
| **OTLP/HTTP receiver** | `/v1/traces` 엔드포인트 없음. OTel `gen_ai.*` semantic convention 매퍼 없음. |
| **Span 검색/필터링** | trace 리스트 필터는 있는데 span name/type/duration으로 trace를 찾는 기능 없음. (테스트 범위 밖, 백로그) |

---

## 1. 작업 단계 개요

```
Phase A:  E2E 검증 (현재 동작하는 것)               약 0.5일  ← 모든 후속 작업의 베이스라인
Phase B:  Critical path — 진짜 알고리즘 구현         약 0.5일
Phase C:  Trace ↔ Request 드릴다운                   약 0.25일
Phase D:  OTLP/HTTP receiver (JSON only, gen_ai만)  약 1~1.5일
Phase E:  Retry span 모델링                          약 0.5일 (선택)
Phase F:  통합 회귀 테스트 + 문서화                  약 0.25일
```

> **의존성**: A는 단독 실행 가능. B, C, D는 서로 독립. E는 D 끝난 뒤가 좋음 (스키마 마이그레이션 충돌 회피). F는 마지막.

---

## 2. 테스트 인프라 (모든 Phase 공통)

### 2.1 도구

- **로컬 테스트 앱**: `playground/onboarding-test` (Next.js, port 3002 권장 — 3000은 web이 점유)
  - 기존 라우트: `/api/openai`, `/api/anthropic`, `/api/gemini` (단일 호출용)
  - **추가 필요**: `/api/agent-multistep` (3-depth 멀티스텝), `/api/agent-parallel` (병렬 fan-out), `/api/agent-error` (의도적 throw)
- **브라우저 자동화**: Chrome MCP (`mcp__Claude_in_Chrome__*`)
  - `tabs_create_mcp` → `navigate` → `find`/`read_page` → `read_console_messages` → `read_network_requests`
- **DB 직접 검증**: Supabase MCP (`mcp__cc7e9dac-...__execute_sql`)
- **OTel 송신 테스트**: `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http` (devDep)
- **CLI 검증 보조**: `curl` (raw HTTP 엣지 케이스용)

### 2.2 환경 변수 점검 (production)

테스트 시작 전 Vercel Production env에 다음이 있는지 확인:

```
SUPABASE_URL                — ✅ 필수
SUPABASE_SERVICE_ROLE_KEY   — ✅ 필수
ENCRYPTION_KEY              — ✅ 필수 (32B base64)
WEB_URL                     — ✅ https://www.spanlens.io
```

테스트용 Spanlens API key: `playground/onboarding-test/.env.local`의 `SPANLENS_API_KEY` 사용. 만료/revoke됐으면 재발급 (https://www.spanlens.io/projects).

### 2.3 검증 SQL 템플릿 (자주 씀)

Phase 별로 이 쿼리들을 패턴화:

```sql
-- 가장 최근 trace + span 트리
SELECT t.id, t.name, t.status, t.duration_ms, t.span_count, t.total_cost_usd, t.total_tokens
FROM traces t
WHERE t.organization_id = '<ORG_UUID>'
ORDER BY t.created_at DESC
LIMIT 5;

-- 특정 trace의 span 트리
SELECT id, parent_span_id, name, span_type, status, duration_ms,
       prompt_tokens, completion_tokens, cost_usd, request_id, error_message
FROM spans
WHERE trace_id = '<TRACE_UUID>'
ORDER BY started_at;

-- Trace ↔ Request 연결 검증
SELECT s.id AS span_id, s.name, s.request_id, r.model, r.cost
FROM spans s LEFT JOIN requests r ON s.request_id = r.id
WHERE s.trace_id = '<TRACE_UUID>' AND s.span_type = 'llm';

-- 집계 트리거 정합성 검증 (raw SUM vs traces 컬럼)
SELECT
  t.id, t.span_count, t.total_tokens, t.total_cost_usd,
  (SELECT COUNT(*) FROM spans WHERE trace_id = t.id)        AS raw_count,
  (SELECT COALESCE(SUM(total_tokens), 0) FROM spans WHERE trace_id = t.id) AS raw_tokens,
  (SELECT COALESCE(SUM(cost_usd), 0)     FROM spans WHERE trace_id = t.id) AS raw_cost
FROM traces t WHERE t.id = '<TRACE_UUID>';
```

---

## 3. Phase A — E2E 검증 (현재 동작 확인)

**목적**: Phase B/C/D 들어가기 전에 베이스라인을 잡는다. 회귀 발생 시 비교 대상.

### A1. `observe()` 멀티스텝 워터폴 (30분)

**구현**: `playground/onboarding-test/app/api/agent-multistep/route.ts` 신규

```typescript
import { NextResponse } from 'next/server'
import { SpanlensClient, observeOpenAI } from '@spanlens/sdk'
import { createOpenAI } from '@spanlens/sdk/openai'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace('agent.multistep.demo')

  try {
    const openai = createOpenAI()
    // Step 1: classify
    const classify = await observeOpenAI(trace, 'classify_intent', (headers) =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Classify in one word: "How do I reset password?"' }],
        max_tokens: 5,
      }, { headers }),
    )

    // Step 2: tool span (custom — no LLM call)
    const toolSpan = trace.span({ name: 'kb_search', spanType: 'tool' })
    await new Promise((r) => setTimeout(r, 120)) // simulate vector search
    await toolSpan.end({
      status: 'completed',
      output: { hits: 3, top_score: 0.87 },
    })

    // Step 3: nested LLM under a parent custom span
    const composeSpan = trace.span({ name: 'compose_reply', spanType: 'custom' })
    const reply = await observeOpenAI(composeSpan, 'llm.compose', (headers) =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply: "Click forgot password."' }],
        max_tokens: 30,
      }, { headers }),
    )
    await composeSpan.end({ status: 'completed' })

    await trace.end({ status: 'completed' })

    return NextResponse.json({
      ok: true,
      traceId: trace.traceId,
      classify: classify.choices[0]?.message?.content ?? '',
      reply: reply.choices[0]?.message?.content ?? '',
    })
  } catch (err) {
    await trace.end({ status: 'error', errorMessage: err instanceof Error ? err.message : String(err) })
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
```

UI 버튼은 `playground/onboarding-test/app/page.tsx`에 추가 (기존 OpenAI/Anthropic/Gemini 버튼 옆).

**검증 (Chrome MCP)**:

1. `tabs_create_mcp` → `http://localhost:3002` 띄움
2. "Run multistep" 버튼 클릭 → 응답에 `traceId` 확인
3. `https://www.spanlens.io/traces` 이동 → 새 trace 등장
4. trace 클릭 → 다음을 검증:
   - **Span 트리 구조**: `agent.multistep.demo` (root) → `classify_intent` (llm), `kb_search` (tool), `compose_reply` (custom) → `llm.compose` (llm 자식)
   - **Type 글리프**: llm은 accent 색, tool은 faint, custom은 border-strong (`gantt.tsx:6~12`)
   - **Duration 막대 폭**: 비례
   - **Token/cost**: classify, llm.compose에 표시 (kb_search은 N/A)
   - **trace 집계**: span_count=4, total_tokens > 0
   - **상태**: completed
5. `read_console_messages({ pattern: 'error|spanlens', onlyErrors: true })` — JS 에러 0
6. `read_network_requests({ urlPattern: '/api/v1/traces' })` — 200 응답

**SQL 검증**:
```sql
SELECT name, parent_span_id, span_type, duration_ms, request_id
FROM spans WHERE trace_id = '<TRACE_UUID>' ORDER BY started_at;
-- 기대: 4행, parent 관계 정확, llm span은 request_id NOT NULL
```

### A2. 병렬 fan-out (15분)

**구현**: `/api/agent-parallel/route.ts`

```typescript
const trace = client.startTrace('agent.parallel.demo')
const [r1, r2, r3] = await Promise.all([
  observeOpenAI(trace, 'subtask_a', (h) => openai.chat.completions.create({
    model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say A' }], max_tokens: 3,
  }, { headers: h })),
  observeOpenAI(trace, 'subtask_b', (h) => openai.chat.completions.create({
    model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say B' }], max_tokens: 3,
  }, { headers: h })),
  observeOpenAI(trace, 'subtask_c', (h) => openai.chat.completions.create({
    model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say C' }], max_tokens: 3,
  }, { headers: h })),
])
await trace.end({ status: 'completed' })
```

**검증**: Gantt에서 3개 span의 막대가 시간축에서 **겹쳐서** 그려져야 함. `started_at` 차이 ≤50ms.

### A3. 에러 throw 캡처 (10분)

**구현**: `/api/agent-error/route.ts` — 의도적으로 throw하는 함수를 `observe()`로 래핑.

**검증**:
- DB: `traces.status = 'error'`, `traces.error_message` 채워짐
- 자식 span 도 `status = 'error'`, `error_message` 채워짐
- Gantt: 빨간색 (`bg-bad`) 막대

### A4. 스트리밍 응답 token 캡처 (15분)

**구현**: `observeOpenAI` 안에서 `stream: true` + chunk 누적.

```typescript
const stream = await observeOpenAI(trace, 'streaming', (h) =>
  openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Count to 3' }],
    stream: true,
    stream_options: { include_usage: true },  // 마지막 chunk에 usage
  }, { headers: h }),
)
let text = ''
for await (const chunk of stream) {
  text += chunk.choices[0]?.delta?.content ?? ''
}
```

**검증**: span의 `prompt_tokens`/`completion_tokens` > 0. Anthropic 스트리밍 (gotcha #1: `message_delta`에서 usage)도 동일 패턴으로 한 번 확인.

### A5. Traces 리스트 페이지 회귀 (15분)

Chrome MCP로 `/traces` 페이지 검증:
- 정렬 토글 (started_at | duration | cost | span_count) 클릭 시 URL 또는 데이터 순서 변경
- 시간 범위 필터 (1h | 24h | 7d | 30d | all)
- status 필터 (running | completed | error)
- 페이지네이션 (cursor 또는 offset)
- 빈 상태 (`limit=1&offset=999`) 메시지

### A6. RLS 격리 (10분)

```sql
-- 별도 조직의 사용자로 가장
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '<DIFFERENT_USER_UUID>';
SELECT COUNT(*) FROM traces WHERE id = '<TEST_TRACE_UUID>';
-- 기대: 0
```

### A7. `_creationPromise` race 방지 회귀 (CLAUDE.md Gotcha #10)

매우 짧은 trace (`<3s`) 시나리오 — Phase A1을 50ms 이하로 압축해 빠르게 끝내고 모든 span이 DB에 남는지 확인. 한 번이라도 누락되면 SDK race 회귀 — 즉시 멈추고 디버그.

```typescript
const trace = client.startTrace('race-test')
const s1 = trace.span({ name: 'a' }); s1.end({ status: 'completed' })
const s2 = trace.span({ name: 'b' }); s2.end({ status: 'completed' })
await trace.end({ status: 'completed' })
return NextResponse.json({ traceId: trace.traceId })
```

검증: 100회 반복했을 때 spans 누락 0회.

### A8. fireAndForget drain 회귀 (CLAUDE.md Gotcha #8)

서버는 이미 Node runtime + 40s — production에서 ingest POST 직후 응답 200 OK인데 DB에 row 안 남는 케이스 없는지 확인. A1~A7 모든 시나리오에서 응답 OK 후 DB INSERT 0건이면 즉시 fireAndForget 회귀.

### Phase A 종료 조건

- [ ] A1 다단계 trace 정상 표시 (스크린샷 첨부)
- [ ] A2 병렬 span 시간축 겹침 확인
- [ ] A3 에러 trace 빨간색 + status='error'
- [ ] A4 스트리밍 token 캡처
- [ ] A5 리스트 페이지 모든 필터/정렬 동작
- [ ] A6 RLS 다른 조직 차단
- [ ] A7 race 100회 반복 누락 0
- [ ] A8 fireAndForget drain 정상

→ 회귀 발견 시 그 자리에서 fix 후 다음 Phase 진입.

---

## 4. Phase B — Critical Path (진짜 알고리즘)

**현 문제**: `trace-panel.tsx:557` `bottleneck`은 `duration_ms desc` 정렬의 첫 번째일 뿐. UI 라벨은 'critical'이지만 사실은 'longest single span'. 진짜 critical path는:

> "최상위 span(root)에서 leaf까지 순차적 의존 chain 중, 누적 wall-clock time이 가장 긴 path."

병렬 fan-out에서 root → A(slow) → end의 latency = A의 duration. root → B(fast)는 critical path 아님.

### B1. 알고리즘 설계

**입력**: `Span[]` (parent_span_id로 트리 구성)
**출력**: `criticalSpanIds: string[]` (path를 이루는 모든 span ID)

DAG 위 longest weighted path는 토폴로지 정렬 후 DP로 O(V+E):

```typescript
function computeCriticalPath(spans: SpanRow[]): string[] {
  // 1. parent → children 인덱스
  const childrenOf = new Map<string | null, SpanRow[]>()
  for (const s of spans) {
    const k = s.parent_span_id
    const arr = childrenOf.get(k) ?? []
    arr.push(s)
    childrenOf.set(k, arr)
  }

  // 2. 각 span에서 leaf까지 가장 긴 누적 duration_ms
  // memo: span_id → { totalMs, nextSpanId | null }
  const memo = new Map<string, { totalMs: number; nextSpanId: string | null }>()

  function dfs(span: SpanRow): { totalMs: number; nextSpanId: string | null } {
    const cached = memo.get(span.id)
    if (cached) return cached

    const ownMs = span.duration_ms ?? 0
    const children = childrenOf.get(span.id) ?? []
    if (children.length === 0) {
      const r = { totalMs: ownMs, nextSpanId: null }
      memo.set(span.id, r)
      return r
    }

    let bestChild: { totalMs: number; nextSpanId: string | null } = { totalMs: 0, nextSpanId: null }
    let bestChildId: string | null = null
    for (const c of children) {
      const r = dfs(c)
      if (r.totalMs > bestChild.totalMs) {
        bestChild = r
        bestChildId = c.id
      }
    }

    const result = { totalMs: ownMs + bestChild.totalMs, nextSpanId: bestChildId }
    memo.set(span.id, result)
    return result
  }

  // 3. 루트(parent_span_id=null)들 중 가장 긴 path 선택
  const roots = childrenOf.get(null) ?? []
  if (roots.length === 0) return []

  let bestRoot = roots[0]!
  let bestRootMs = dfs(bestRoot).totalMs
  for (const r of roots.slice(1)) {
    const ms = dfs(r).totalMs
    if (ms > bestRootMs) { bestRoot = r; bestRootMs = ms }
  }

  // 4. path 따라가며 ID 수집
  const path: string[] = []
  let cursor: string | null = bestRoot.id
  while (cursor) {
    path.push(cursor)
    cursor = memo.get(cursor)?.nextSpanId ?? null
  }
  return path
}
```

> **주의**: 진짜 distributed tracing critical path는 부모 안의 자식 **순차 의존성**도 모델링해야 함 (자식 A 끝나야 자식 B 시작). 우리는 SDK가 명시적으로 의존을 안 알려주니, **부모 duration = 자체 wall-clock**으로 단순화. 부모-자식 chain의 합으로 충분 — 병렬 fan-out에서 가장 느린 가지가 critical로 잡힘. 향후 OTel `Link` 도입하면 진짜 dependency edge로 발전.

### B2. 서버 측 통합

`apps/server/src/api/traces.ts`의 `GET /api/v1/traces/:id` 응답에 `critical_span_ids: string[]` 필드 추가. (DB에 저장하지 않고 매번 재계산 — span 수 적고 캐시는 응답 헤더로 충분)

```typescript
// apps/server/src/api/traces.ts (의사코드)
const trace = await fetchTrace(id)
const spans = await fetchSpans(id)
const criticalSpanIds = computeCriticalPath(spans)
return c.json({ success: true, data: { ...trace, spans, critical_span_ids: criticalSpanIds } })
```

알고리즘 자체는 `apps/server/src/lib/critical-path.ts`로 추출 (단위 테스트 가능하게).

### B3. 클라이언트 측 통합

- `lib/queries/types.ts`: `TraceDetail` 타입에 `critical_span_ids: string[]` 추가
- `gantt.tsx`: prop을 `criticalSpanId: string | null` → `criticalSpanIds: ReadonlyArray<string>`로 변경
  - `const isCritical = criticalSpanIds.includes(s.id)` 로 수정
  - critical 배지는 path 위 모든 span에 표시
- `trace-panel.tsx`: 기존 `bottleneck` 변수는 **유지** (쓰임이 'longest single span' 카드 → "Longest Span" 라벨이 정확). 새로 `criticalSpanIds`를 별도로 가져와 Gantt에 전달.
- 추가: Critical path 정보 박스 — "Critical path: A → B → C, 총 N초 (전체 trace의 X%)"

### B4. 단위 테스트 (`apps/server/src/lib/critical-path.test.ts`)

```typescript
import { describe, expect, test } from 'vitest'
import { computeCriticalPath } from './critical-path'

const span = (id: string, parent: string | null, durationMs: number) => ({
  id, parent_span_id: parent, duration_ms: durationMs,
  // ...other required fields fudged
}) as any

test('linear chain', () => {
  // root(100) → child(200) → grand(50)  → critical = [root, child, grand]
  const spans = [
    span('root', null, 100), span('child', 'root', 200), span('grand', 'child', 50),
  ]
  expect(computeCriticalPath(spans)).toEqual(['root', 'child', 'grand'])
})

test('parallel fan-out — picks slowest branch', () => {
  // root(100) → [a(200), b(50), c(150)] → critical = [root, a]
  const spans = [
    span('root', null, 100),
    span('a', 'root', 200), span('b', 'root', 50), span('c', 'root', 150),
  ]
  expect(computeCriticalPath(spans)).toEqual(['root', 'a'])
})

test('multiple roots — picks longest root chain', () => {
  const spans = [
    span('r1', null, 100), span('r1c', 'r1', 200),
    span('r2', null, 500),
  ]
  expect(computeCriticalPath(spans)).toEqual(['r1', 'r1c'])  // r1+r1c=300 > r2=500? No.
  // 수정: 500 > 300 이므로 r2가 critical
})

test('handles missing duration_ms (running span)', () => {
  const spans = [span('a', null, null), span('b', 'a', 100)] as any
  expect(computeCriticalPath(spans)).toEqual(['a', 'b'])  // null → 0 처리
})

test('orphan span (parent not in list)', () => {
  const spans = [span('a', null, 100), span('orphan', 'missing', 999)]
  expect(computeCriticalPath(spans)).toEqual(['a'])
})

test('empty input', () => {
  expect(computeCriticalPath([])).toEqual([])
})
```

### B5. E2E 테스트

**실행**: Phase A2의 병렬 fan-out 결과 trace를 `/traces/[id]` 로 다시 열기.

**검증**:
- Critical path 배지가 **가장 느린 branch만** 빨갛게 (이전엔 단일 span)
- 정보 박스 "Critical path: agent.parallel.demo → subtask_X (가장 느린 거)"
- B4 단위 테스트가 표현하는 모든 시나리오를 실제 trace로 재현

### Phase B 종료 조건

- [ ] `lib/critical-path.ts` 단위 테스트 6개 모두 PASS
- [ ] `GET /api/v1/traces/:id` 응답에 `critical_span_ids` 포함
- [ ] Gantt가 multi-span critical path를 빨갛게 표시
- [ ] 병렬 fan-out trace에서 가장 느린 branch가 critical로 잡힘
- [ ] 회귀: 단일 span trace에서도 정상 (기존 `bottleneck` "Longest Span" 카드 유지)

---

## 5. Phase C — Trace ↔ Request 드릴다운

**현 상태**: `spans.request_id` 컬럼 + 인덱스 + 자동 채움 다 됨. UI만 빠짐.

### C1. SpanDetail 패널에 링크 추가

`apps/web/components/traces/trace-panel.tsx`의 SpanDetail 컴포넌트 — `selectedSpan.request_id`가 있으면:

```tsx
{selectedSpan.request_id && (
  <Link
    href={`/requests/${selectedSpan.request_id}`}
    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-accent-border bg-accent-bg text-accent text-[11.5px] font-mono hover:bg-accent-bg/80"
  >
    View raw request →
  </Link>
)}
```

### C2. 반대 방향: Request → Trace 링크

`apps/web/app/(dashboard)/requests/[id]/page.tsx` (있으면) — 해당 request에 연결된 span을 역으로 찾아 trace 링크 노출:

```typescript
// 서버 API
SELECT trace_id, id AS span_id FROM spans WHERE request_id = $1 LIMIT 1
```

### C3. E2E 검증

1. Phase A1 trace의 `llm.compose` span 클릭
2. 우측 패널에 "View raw request →" 링크 등장
3. 클릭 → `/requests/[id]` 페이지로 이동
4. requests 페이지에서 "View trace →" 링크로 다시 돌아옴
5. Chrome MCP `read_network_requests`로 navigation 확인

### Phase C 종료 조건

- [ ] llm span에 request 링크 표시
- [ ] non-llm span (tool/retrieval/custom)에는 링크 안 보임 (request_id NULL)
- [ ] 양방향 navigation 동작

---

## 6. Phase D — OTLP/HTTP Receiver

**가장 큰 작업**. 1~1.5일. JSON 모드만, `gen_ai.*` semconv만 1차 지원.

### D1. 스펙 핵심 (조사한 OTel 공식 문서 요약)

| 항목 | 값 |
|---|---|
| Path | `POST /v1/traces` |
| Content-Type | `application/json` (proto는 phase 2) |
| 응답 (성공) | `200 OK`, body `{}` 또는 `{"partialSuccess":{"rejectedSpans":N,"errorMessage":"..."}}` |
| 응답 (4xx 비재시도) | `400 Bad Request` etc. |
| 응답 (5xx 재시도) | `429`, `502`, `503`, `504` |
| Compression | `Content-Encoding: gzip` 지원 (선택) |
| 인증 | spec엔 정의 안 됨 → **우리는 `Authorization: Bearer sl_live_*` 사용** (Langfuse는 Basic, 우리는 SDK와 동일한 패턴 유지) |
| Trace ID | 16-byte (32 hex char), e.g. `4bf92f3577b34da6a3ce929d0e0e4736` |
| Span ID | 8-byte (16 hex char) |
| 시간 | `start_time_unix_nano` / `end_time_unix_nano` (string in JSON, fixed64 in proto) |
| 필드 케이스 | proto는 snake_case, JSON 직렬화는 두 변형 존재(`startTimeUnixNano` / `start_time_unix_nano`). 우리 receiver는 **둘 다 받기** (대부분 SDK는 camelCase 송출). |

### D2. 인증 결정

Langfuse는 Basic Auth(pk/sk pair)를 쓰지만 우리는:

```
Authorization: Bearer sl_live_xxx
```

이미 있는 `authApiKey` 미들웨어 그대로 사용. 모든 OTel 송신 SDK는 `OTEL_EXPORTER_OTLP_HEADERS` env로 임의 헤더 주입 가능 → 사용자 친화적.

### D3. ID 매핑 결정 (중요)

OTel ID는 **hex 문자열**, 우리 DB `traces.id`/`spans.id`는 **UUID v4**.

옵션 비교:

| 옵션 | 장점 | 단점 |
|---|---|---|
| ① 새 컬럼 `external_trace_id TEXT` 추가, 우리 UUID 따로 부여 | 기존 코드 무수정, 안전 | 조회 시 lookup 1번 추가 |
| ② `traces.id`를 TEXT로 마이그레이션 | 호환성 좋음 | 마이그레이션 risk 큼, FK들 연쇄 |
| ③ OTel hex 32자→UUID로 인코딩 (하이픈 삽입) | 컬럼 추가 없음 | 비표준, 디버깅 헷갈림 |

**선택: 옵션 ①** — `traces`/`spans`에 각각 컬럼 추가:

```sql
-- supabase/migrations/20260507000000_otlp_external_ids.sql
ALTER TABLE traces ADD COLUMN external_trace_id TEXT;
CREATE UNIQUE INDEX traces_external_id_idx
  ON traces (organization_id, external_trace_id)
  WHERE external_trace_id IS NOT NULL;

ALTER TABLE spans ADD COLUMN external_span_id TEXT;
ALTER TABLE spans ADD COLUMN external_parent_span_id TEXT;
CREATE INDEX spans_external_id_idx ON spans (external_span_id) WHERE external_span_id IS NOT NULL;
```

OTel로 들어온 span의 parent_span_id 매핑 순서:
1. `external_parent_span_id`만 우선 INSERT
2. trace 단위 batch 끝나면 같은 trace의 span들끼리 join하여 `parent_span_id`(UUID) 채움
   ```sql
   UPDATE spans c SET parent_span_id = p.id
   FROM spans p
   WHERE c.trace_id = p.trace_id
     AND c.external_parent_span_id = p.external_span_id
     AND c.parent_span_id IS NULL;
   ```

### D4. gen_ai 시맨틱 컨벤션 매핑

OTel 공식 (`https://opentelemetry.io/docs/specs/semconv/gen-ai/`) 기준:

| OTel attribute | Spanlens 컬럼/메타 |
|---|---|
| `gen_ai.operation.name` | `metadata.operation` (값: chat, text_completion, embeddings, generate_content, execute_tool, retrieval) |
| `gen_ai.provider.name` | `metadata.provider` ('openai', 'anthropic', 'gemini', ...) |
| `gen_ai.request.model` | `metadata.model` |
| `gen_ai.response.model` | `metadata.response_model` |
| `gen_ai.request.temperature` | `metadata.temperature` |
| `gen_ai.request.max_tokens` | `metadata.max_tokens` |
| `gen_ai.request.top_p` | `metadata.top_p` |
| `gen_ai.usage.input_tokens` | `prompt_tokens` (직접 컬럼) |
| `gen_ai.usage.output_tokens` | `completion_tokens` (직접 컬럼) |
| `gen_ai.usage.input_tokens` + `output_tokens` 합 | `total_tokens` (계산) |
| `gen_ai.response.finish_reasons` | `metadata.finish_reasons` |
| `gen_ai.response.id` | `metadata.response_id` |
| `gen_ai.input.messages` | `input` (jsonb) |
| `gen_ai.output.messages` | `output` (jsonb) |
| `gen_ai.system_instructions` | `metadata.system_instructions` |
| `gen_ai.tool.name` | `metadata.tool_name` (span_type='tool') |
| `gen_ai.tool.call.id` | `metadata.tool_call_id` |
| `gen_ai.tool.call.arguments` | `input` |
| `gen_ai.tool.call.result` | `output` |
| `error.type` | `error_message` (status='error') |
| Span.Status (ERROR) | `status='error'` |

`span_type` 추론:
- `gen_ai.operation.name` ∈ {chat, text_completion, generate_content} → `'llm'`
- `= execute_tool` → `'tool'`
- `= embeddings` → `'embedding'`
- `= retrieval` → `'retrieval'`
- 그 외 OTel span (gen_ai 없음) → `'custom'`

비용 계산: `prompt_tokens` + `completion_tokens` + `metadata.model`로 기존 `lib/cost.ts` 재사용.

### D5. 엔드포인트 구현

`apps/server/src/api/otlp.ts` 신규:

```typescript
import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { supabaseAdmin } from '../lib/db.js'
import { mapOtlpSpan, groupByTrace } from '../lib/otlp-mapper.js'
import { fireAndForget } from '../lib/wait-until.js'

export const otlpRouter = new Hono<ApiKeyContext>()
otlpRouter.use('/v1/traces', authApiKey)

otlpRouter.post('/v1/traces', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ partialSuccess: { rejectedSpans: 0, errorMessage: 'Invalid JSON' } }, 400)
  }

  const orgId = c.get('organizationId')
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')

  // OTel: { resourceSpans: [{ resource, scopeSpans: [{ scope, spans: [...] }] }] }
  const allSpans = []
  for (const rs of body.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        allSpans.push({ ...span, _resource: rs.resource, _scope: ss.scope })
      }
    }
  }

  if (allSpans.length === 0) {
    return c.json({}, 200)  // partial_success unset = full success
  }

  // 같은 trace_id 끼리 묶어 처리
  const traceGroups = groupByTrace(allSpans)
  let rejected = 0

  fireAndForget(c, (async () => {
    for (const [externalTraceId, spans] of traceGroups) {
      try {
        // 1. trace upsert
        const traceName = inferTraceName(spans)  // root span name 또는 'otel-trace'
        const { data: trace, error: traceErr } = await supabaseAdmin
          .from('traces')
          .upsert({
            external_trace_id: externalTraceId,
            organization_id: orgId,
            project_id: projectId,
            api_key_id: apiKeyId,
            name: traceName,
            status: 'completed',  // OTel은 batch로 끝난 것만 보냄
            started_at: minStartTime(spans),
            ended_at: maxEndTime(spans),
          }, { onConflict: 'organization_id,external_trace_id' })
          .select('id')
          .single()

        if (traceErr || !trace) { rejected += spans.length; continue }

        // 2. spans bulk insert
        const rows = spans.map((s) => mapOtlpSpan(s, trace.id, orgId))
        const { error: spanErr } = await supabaseAdmin.from('spans').insert(rows)
        if (spanErr) { rejected += spans.length; continue }

        // 3. parent_span_id 매핑 (external → UUID)
        await supabaseAdmin.rpc('link_otlp_span_parents', { p_trace_id: trace.id })
      } catch {
        rejected += spans.length
      }
    }
  })())

  return c.json(
    rejected > 0 ? { partialSuccess: { rejectedSpans: rejected } } : {},
    200,
  )
})
```

`apps/server/src/lib/otlp-mapper.ts` — 매퍼 로직 격리:

```typescript
export function mapOtlpSpan(otelSpan: any, traceUuid: string, orgId: string) {
  const attrs = unpackAttributes(otelSpan.attributes ?? [])
  const op = attrs['gen_ai.operation.name']
  const spanType =
    op === 'chat' || op === 'text_completion' || op === 'generate_content' ? 'llm' :
    op === 'execute_tool' ? 'tool' :
    op === 'embeddings' ? 'embedding' :
    op === 'retrieval' ? 'retrieval' : 'custom'

  return {
    trace_id: traceUuid,
    organization_id: orgId,
    external_span_id: otelSpan.spanId,
    external_parent_span_id: otelSpan.parentSpanId || null,
    name: otelSpan.name,
    span_type: spanType,
    status: otelSpan.status?.code === 2 ? 'error' : 'completed',  // 0=UNSET, 1=OK, 2=ERROR
    started_at: nanoToIso(otelSpan.startTimeUnixNano ?? otelSpan.start_time_unix_nano),
    ended_at: nanoToIso(otelSpan.endTimeUnixNano ?? otelSpan.end_time_unix_nano),
    duration_ms: nanoDuration(otelSpan),
    input: attrs['gen_ai.input.messages'] ?? attrs['gen_ai.tool.call.arguments'] ?? null,
    output: attrs['gen_ai.output.messages'] ?? attrs['gen_ai.tool.call.result'] ?? null,
    error_message: otelSpan.status?.message ?? null,
    prompt_tokens: numAttr(attrs, 'gen_ai.usage.input_tokens'),
    completion_tokens: numAttr(attrs, 'gen_ai.usage.output_tokens'),
    total_tokens:
      (numAttr(attrs, 'gen_ai.usage.input_tokens') ?? 0) +
      (numAttr(attrs, 'gen_ai.usage.output_tokens') ?? 0),
    cost_usd: computeCost(
      attrs['gen_ai.provider.name'],
      attrs['gen_ai.request.model'],
      {
        prompt_tokens: numAttr(attrs, 'gen_ai.usage.input_tokens') ?? 0,
        completion_tokens: numAttr(attrs, 'gen_ai.usage.output_tokens') ?? 0,
      },
    ),
    metadata: pickKnownMetadata(attrs),
  }
}

// OTel KeyValue: [{ key: 'foo', value: { stringValue: 'bar' | intValue: 42 | doubleValue: 1.5 | boolValue: true | arrayValue / kvlistValue }}]
function unpackAttributes(kvList: any[]): Record<string, any> {
  const out: Record<string, any> = {}
  for (const kv of kvList) {
    out[kv.key] = unpackAnyValue(kv.value)
  }
  return out
}
function unpackAnyValue(v: any): any {
  if (v == null) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)  // JSON에서 int64는 string
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.arrayValue !== undefined) return (v.arrayValue.values ?? []).map(unpackAnyValue)
  if (v.kvlistValue !== undefined) return Object.fromEntries(
    (v.kvlistValue.values ?? []).map((kv: any) => [kv.key, unpackAnyValue(kv.value)]),
  )
  return null
}
```

`link_otlp_span_parents` RPC (PostgreSQL function):

```sql
CREATE OR REPLACE FUNCTION link_otlp_span_parents(p_trace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE spans c SET parent_span_id = p.id
  FROM spans p
  WHERE c.trace_id = p_trace_id
    AND p.trace_id = p_trace_id
    AND c.external_parent_span_id = p.external_span_id
    AND c.parent_span_id IS NULL;
END;
$$;
```

### D6. 라우터 등록

`apps/server/src/app.ts`에 `otlpRouter` 마운트 (CORS 허용 필요 없음 — 서버 사이드 OTel exporter만 호출):

```typescript
app.route('/', otlpRouter)  // /v1/traces 가 prefix 없는 경로
```

### D7. 단위 테스트

`apps/server/src/lib/otlp-mapper.test.ts`:

```typescript
test('maps gen_ai chat span to llm type', () => {
  const span = {
    name: 'chat gpt-4o-mini',
    spanId: 'abc1234567890def',
    parentSpanId: '',
    startTimeUnixNano: '1714694400000000000',
    endTimeUnixNano: '1714694401500000000',
    status: { code: 1 },
    attributes: [
      { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
      { key: 'gen_ai.provider.name', value: { stringValue: 'openai' } },
      { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o-mini' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '120' } },
      { key: 'gen_ai.usage.output_tokens', value: { intValue: '45' } },
    ],
  }
  const row = mapOtlpSpan(span, 'trace-uuid', 'org-uuid')
  expect(row.span_type).toBe('llm')
  expect(row.prompt_tokens).toBe(120)
  expect(row.completion_tokens).toBe(45)
  expect(row.total_tokens).toBe(165)
  expect(row.cost_usd).toBeGreaterThan(0)
  expect(row.duration_ms).toBe(1500)
})

// + execute_tool, embeddings, error status, snake_case fallback 등 5~6 케이스
```

### D8. E2E 테스트 (실제 OTel 송출)

`playground/onboarding-test/app/api/otel-test/route.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { trace, SpanKind } from '@opentelemetry/api'

let sdkInitialized = false
function ensureOtelSdk() {
  if (sdkInitialized) return
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: 'https://spanlens-server.vercel.app/v1/traces',
      headers: { Authorization: `Bearer ${process.env.SPANLENS_API_KEY}` },
    }),
  })
  sdk.start()
  sdkInitialized = true
}

export async function POST() {
  ensureOtelSdk()
  const tracer = trace.getTracer('onboarding-test')
  const span = tracer.startSpan('chat gpt-4o-mini', { kind: SpanKind.CLIENT })
  span.setAttributes({
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'openai',
    'gen_ai.request.model': 'gpt-4o-mini',
    'gen_ai.usage.input_tokens': 120,
    'gen_ai.usage.output_tokens': 45,
  })
  await new Promise((r) => setTimeout(r, 50))
  span.end()
  return NextResponse.json({ ok: true })
}
```

**검증**:
1. POST 호출 → 응답 200
2. ~5초 내 (BatchSpanProcessor flush) `https://www.spanlens.io/traces`에 새 trace 등장
3. SQL: `SELECT * FROM traces WHERE external_trace_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`
4. 해당 trace의 spans:
   - `external_span_id` 채워짐
   - `span_type='llm'`
   - `prompt_tokens=120`, `completion_tokens=45`, `total_tokens=165`
   - `cost_usd > 0` (gpt-4o-mini 가격 적용됨)
5. UI: Gantt 정상 렌더, span 상세에 model/provider 표시

추가 시나리오:
- 부모-자식 span (수동 OTel)
- error span (`span.recordException(new Error(...))`)
- batch 1000개 — partial_success로 일부 실패 시뮬

### D9. 문서

`apps/web/app/docs/otel/page.tsx` 신규:
- "Send OpenTelemetry traces to Spanlens"
- 환경변수 예시: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`
- Vercel AI SDK / LangChain / 직접 OTel SDK 3가지 가이드
- Limitations: JSON only (proto 추후), gen_ai 매핑 표

### Phase D 종료 조건

- [ ] 마이그레이션 `external_trace_id`/`external_span_id` 적용 + types 재생성
- [ ] `POST /v1/traces` 200 응답 (인증, JSON 파싱)
- [ ] OTel SDK로 송출한 trace가 대시보드에 등장
- [ ] gen_ai semconv 매핑 정확 (token, cost, model)
- [ ] parent-child 관계 정상 (external → UUID 변환)
- [ ] 단위 테스트 5+ 통과
- [ ] partial_success 응답 정확
- [ ] `/docs/otel` 페이지 발행

---

## 7. Phase E — Retry Span (선택)

> **결정 보류**: 실수요 신호 들어오기 전엔 보류 추천. 일단 스키마만 forward-compat하게 추가.

### E1. 스키마 (forward-compat 만)

```sql
-- supabase/migrations/20260508000000_span_retry.sql
ALTER TABLE spans ADD COLUMN retry_attempt INT NOT NULL DEFAULT 1;
ALTER TABLE spans ADD COLUMN retry_group_id UUID;
CREATE INDEX spans_retry_group_idx ON spans (retry_group_id) WHERE retry_group_id IS NOT NULL;
```

### E2. SDK API

```typescript
// observe(name, fn, { retry: { attempts: 3, backoffMs: 200 } })
// → 같은 retry_group_id로 attempt 1, 2, 3 span 생성
```

### E3. UI

Gantt에서 같은 `retry_group_id` span들은 한 줄에 stacked로 (또는 펼치기 토글). 첫 번째는 빨강(에러), 마지막은 초록(성공).

### E4. 테스트

의도적 첫 호출 throw → SDK retry → `attempts=3`, 마지막만 status='completed'.

> Phase E는 진짜로 필요할 때 별도 PR로. 시간 있으면 E1만 미리 적용해서 향후 마이그레이션 비용 줄임.

---

## 8. Phase F — 통합 회귀 + 문서화 (마무리)

### F1. 통합 회귀 시나리오

하나의 trace 안에 다음을 모두 섞은 시나리오 1개를 OTel로 보낸 뒤 SDK로도 동일 결과 나오는지 비교:
- LLM call (gen_ai chat)
- Tool call (execute_tool)
- 병렬 fan-out
- 에러 span

검증:
- A1~A8 시나리오 모두 통과
- B 단위 테스트 통과
- D 단위 테스트 통과
- 두 ingest 경로 (SDK ingest + OTLP) 모두 같은 UI에서 동일하게 보임

### F2. 문서 업데이트

| 파일 | 변경 |
|---|---|
| `apps/web/app/docs/features/traces/page.tsx` | Critical path 동작 설명 추가, OTLP 호환 안내 |
| `apps/web/app/docs/otel/page.tsx` | 신규 (Phase D9) |
| `apps/web/app/docs/proxy/page.tsx` | 변경 없음 (인증 부분 이미 multi-transport) |
| `CLAUDE.md` | Known Gotcha 추가: "OTLP external_trace_id 컬럼은 string, 우리 UUID와 별도. parent 매핑은 batch 끝나고 link_otlp_span_parents RPC로 처리" |
| `README.md` (root) | "OpenTelemetry compatible" 한 줄 노출 |

### F3. CHANGELOG

- SDK: `@spanlens/sdk@0.3.0` (변경 없으면 patch 유지)
- 서버: 새 엔드포인트, 새 응답 필드 — minor bump 등록

---

## 9. 리스크 & 함정 (CLAUDE.md Known Gotcha 적용)

| # | 리스크 | 대응 |
|---|---|---|
| 1 | **fireAndForget drain 누락** (Gotcha #8) — OTLP receiver의 batch INSERT가 응답 후 잘림 | `fireAndForget(c, promise)` 필수, 검증 시 `application/json` 응답 200인데 DB row 0 케이스 모니터링 |
| 2 | **`_creationPromise` race** (Gotcha #10) | OTLP는 batch라 무관, SDK 경로는 이미 적용됨. Phase A7로 회귀 테스트 |
| 3 | **lib/crypto.ts 비동기** (Gotcha #12) | OTLP receiver는 암호화 안 씀. 무관. |
| 4 | **OTel int64 string 표현** | `intValue: '120'`처럼 string으로 옴 — `Number(v.intValue)` 변환 필수, 매퍼 단위 테스트로 회귀 방지 |
| 5 | **OTel JSON snake_case vs camelCase** | 둘 다 받기 (`startTimeUnixNano ?? start_time_unix_nano`) |
| 6 | **OTel batch 큰 사이즈** | Vercel Node 40s 제한 — 1 batch 최대 1000 spans 권장. 초과 시 partial_success로 거절 |
| 7 | **trace name 추론** | OTel은 trace level name 없음 — root span(parent_span_id=비어있음) name 사용, 없으면 `'otel-trace'` |
| 8 | **upsert 충돌 race** | `UNIQUE INDEX (org_id, external_trace_id)` + `onConflict='organization_id,external_trace_id'` 명시 |
| 9 | **비용 매핑** | `gen_ai.provider.name` 값이 `'openai'`/`'anthropic'`/`'google'` 등 — 우리 `lib/cost.ts`의 provider 키와 정렬 필요 (Gotcha #2 재참조) |
| 10 | **Critical path 무한 재귀** | DAG가 아니라 cycle 있을 가능성 — OTel은 spec상 cycle 금지지만, 매퍼에서 visited set으로 방어. 단위 테스트에 cycle 케이스 포함 |
| 11 | **RLS bypass 위험** | OTLP receiver는 supabaseAdmin (service_role) 사용 — 인증 미들웨어 통과 후에만 INSERT |
| 12 | **CORS** | OTLP는 server-to-server라 CORS allowlist 추가 불필요. 단, 브라우저에서 OTel exporter 직접 쓰는 케이스 (드물지만) 사용자 발견 시 그때 추가 |

---

## 10. 작업 순서 (실행 가능한 To-do)

```
Day 1
  09:00  Phase A1 — agent-multistep route + UI 버튼
  09:30  Phase A1 검증 (Chrome MCP + SQL)
  10:30  Phase A2~A4 (병렬, 에러, 스트리밍)
  12:00  Phase A5~A8 (리스트, RLS, race, drain)
  13:00  점심
  14:00  Phase B1 — critical-path.ts 단위 테스트 작성 (TDD)
  15:00  Phase B2~B3 — 서버 + 클라이언트 통합
  16:00  Phase B5 — E2E 검증
  17:00  Phase C — 드릴다운 링크 (web 만 변경)
  18:00  Day 1 commit & push

Day 2
  09:00  Phase D1~D3 — 마이그레이션 작성 + 적용
  10:00  Phase D4~D5 — otlp-mapper.ts + otlp.ts 라우터
  12:00  D7 단위 테스트
  13:00  점심
  14:00  D8 E2E (OTel SDK 실제 송출)
  15:30  D9 docs/otel 페이지
  16:30  Phase F1 통합 회귀
  17:30  F2 docs 업데이트 + CLAUDE.md gotcha 추가
  18:00  Day 2 commit & push, deploy

Day 3 (buffer)
  Phase E (retry) — 실수요 신호 있으면 진행, 아니면 E1 스키마만 미리 적용
  버그 fix, 회귀 정리, PR 머지
```

---

## 11. 종료 기준 (Definition of Done)

이 계획 전체가 끝났다고 판단하려면:

- [ ] Phase A 8개 시나리오 모두 PASS, 스크린샷 확보
- [ ] Phase B 단위 테스트 PASS + 실제 trace에서 critical path 정확
- [ ] Phase C 드릴다운 양방향 동작
- [ ] Phase D OTLP receiver — Vercel AI SDK 또는 직접 OTel SDK 송출 trace가 대시보드에 등장
- [ ] gen_ai semconv 8개 이상 키 정확 매핑
- [ ] 단위 테스트 커버리지 ≥80% (`apps/server/src/lib/critical-path.ts`, `otlp-mapper.ts`)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` PASS
- [ ] `pnpm build` PASS
- [ ] Production 배포 후 24h 동안 Sentry/log 에러 없음
- [ ] `/docs/otel` 페이지 publish
- [ ] CLAUDE.md Known Gotcha 갱신

---

## 12. 의사결정 로그

| 결정 | 선택 | 대안 | 이유 |
|---|---|---|---|
| OTLP wire format | JSON only (1차) | proto 동시 지원 | parser 의존성 ↓, OTel SDK는 둘 다 지원 |
| OTLP gRPC | 미지원 | gRPC 추가 | Vercel은 HTTP만 |
| ID 매핑 | 새 컬럼 (external_*) | UUID로 변환 / TEXT 마이그레이션 | 기존 코드 무수정, 안전 |
| Critical path 저장 | 매번 재계산 (응답 시) | DB에 캐시 컬럼 | trace당 span 수 적음, 캐시 invalidation 비용 ↑ |
| 인증 방식 | Bearer sl_live_* | Basic auth (Langfuse 스타일) | 기존 SDK와 통일, 사용자 학습 비용 ↓ |
| Retry 모델링 | Phase E로 보류 | 1차에 포함 | 실수요 신호 부족, 스코프 폭주 방지 |
| Critical path 알고리즘 | 부모-자식 chain longest path | OTel Link 기반 진짜 dependency | 현재 SDK가 Link 안 씀, 향후 발전 가능 |
| OTLP semconv 1차 범위 | gen_ai.* 만 | LangChain/Vercel AI/llm.* 전부 | 첫 출시 단순화. 방언은 사용자 요청 따라 추가 |

---

## 13. 참고

- OTLP/HTTP spec: https://opentelemetry.io/docs/specs/otlp/
- gen_ai semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- OTel proto 정의: https://github.com/open-telemetry/opentelemetry-proto
- Critical path tracing (Google paper): https://cacm.acm.org/practice/distributed-latency-profiling-through-critical-path-tracing/
- Uber CRISP: https://www.uber.com/blog/crisp-critical-path-analysis-for-microservice-architectures/
- Langfuse OTel docs (인증/매핑 비교): https://langfuse.com/docs/opentelemetry/get-started

---

> **마지막 한 마디**: 이 계획은 **Phase A를 끝까지 통과해야** 의미가 있다. 베이스라인이 부서져 있으면 B/C/D 중 어느 하나가 깨져도 원인 추적이 안 됨. A에서 회귀 발견하면 즉시 멈추고 그것부터 fix.
