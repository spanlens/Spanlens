# ClickHouse 도입 계획 — requests 테이블 이관

> **상태**: 정책 확정 (Approved Policies)
> **작성일**: 2026-05-16 (최종 갱신: 2026-05-16)
> **범위**: `requests` 테이블만 ClickHouse로 이관, 그 외 전부 Supabase 유지
> **타이밍 전제**: 프로덕션 런칭 전 (마이그레이션할 운영 데이터 없음)

---

## 1. 배경 & 동기

Spanlens는 LLM 프록시 특성상 모든 API 호출마다 `requests` 테이블에 INSERT가 발생합니다. 이는 다음 문제로 이어집니다:

- 고객 규모가 늘면 `requests` 단일 테이블에 초당 수백~수천 건 쓰기 발생
- 대시보드의 모든 핵심 쿼리(provider별 집계, 비용 합산, 토큰 트렌드)가 이 테이블의 OLAP 워크로드
- PostgreSQL은 1천만 건 이상에서 컬럼 집계 쿼리가 급격히 느려짐
- JSONB 형태의 `request_body`, `response_body`는 저장 효율이 나쁨

ClickHouse는 정확히 이 워크로드(append-only, 시계열, 집계)를 위해 설계된 컬럼형 DB입니다. Langfuse, PostHog, Helicone 등 동종 업계가 모두 동일한 아키텍처를 채택했습니다.

**런칭 전인 지금이 가장 좋은 타이밍**입니다. 이관할 운영 데이터가 없고, 사용자에게 다운타임을 설명할 필요가 없습니다.

---

## 2. 범위 결정 (Scope)

### 이관 대상

| 테이블 | 결정 | 사유 |
|--------|------|------|
| `requests` | ✅ ClickHouse | append-only, 고빈도, 집계 쿼리 위주 — 완벽한 fit |

### 이관 제외 (Supabase 유지)

| 테이블 | 사유 |
|--------|------|
| `traces`, `spans` | UPDATE 필요 (status, ended_at, refresh_trace_aggregates 트리거) |
| `organizations`, `org_members`, `projects` | 트랜잭션, RLS, Auth 연동 |
| `api_keys`, `provider_keys` | 인증 hot path, 암호화 |
| `subscriptions`, `subscription_overage_charges` | Paddle 웹훅 트랜잭션 |
| `prompt_versions`, `datasets`, `eval_runs` 등 | 관계형 쿼리, 저볼륨 |
| 그 외 32개 테이블 | Supabase 유지로 충분 |

### 보류 (Phase 1 이후 결정)

| 테이블 | 사유 |
|--------|------|
| `usage_daily` | Phase 1 안정화 후 결정. 빌링 쿼터 체크의 크로스 DB 복잡도 평가 필요 |

---

## 3. 확정된 정책

Phase 1 구현 전 결정된 정책. 모든 구현은 이 정책에 부합해야 함.

### 3.1 데이터 Retention (플랜별 차등)

| 플랜 | 보존 기간 |
|------|----------|
| Free | 14일 |
| Pro | 90일 |
| Team | 365일 |
| Enterprise | 무제한 (협의) |

**구현 방식**:
- ClickHouse 테이블 TTL은 **365일**로 고정 (Free/Pro/Team 중 최장 기준)
- 조회 API에서 사용자 플랜에 따라 `created_at >= now() - INTERVAL X DAY` 필터를 **서버 미들웨어가 자동 주입**
- 사용자 플랜은 `subscriptions` 테이블에서 조회 (Supabase)
- **Enterprise는 별도 테이블 또는 TTL 비활성 partition으로 분리** (Phase 1 이후 결정)

**미들웨어 헬퍼 예시**:
```typescript
function planRetentionDays(plan: PlanTier): number {
  return { free: 14, pro: 90, team: 365, enterprise: 36500 }[plan]
}

// 모든 requests 쿼리에 자동 적용되는 WHERE 절
WHERE organization_id = {orgId} 
  AND created_at >= now() - INTERVAL {planRetentionDays(plan)} DAY
```

### 3.2 가격 & 한도 (참고용)

| 플랜 | 가격 | 한도 | 초과 | 좌석 |
|------|------|------|------|------|
| Free | $0 | 50K req/월 | **로깅 중단** (프록시는 통과) | 1 |
| Pro | $29/월 | 100K req/월 | $8/100K | 3 |
| Team | $149/월 | 1M req/월 | $5/100K | 10 |
| Enterprise | 문의 | 커스텀 | 커스텀 | unlimited |

연간 결제 시 20% 할인. Free 한도 도달 시 프록시는 통과(critical path 보호)하되 로깅 중단 + 알림.

### 3.3 백업 정책

- **ClickHouse Cloud 자동 백업**에 의존 (1일 RPO, 같은 리전)
- 위험한 마이그레이션 적용 전 **manual snapshot 의무화** (운영 룰)
- 프로덕션 환경에서 `DROP TABLE`, `TRUNCATE` 사용 금지 (CLAUDE.md 명시)
- 마이그레이션 스크립트는 **idempotent + roll-forward only** — DROP 절대 금지
- **S3 별도 export는 첫 엔터프라이즈 고객 받기 직전에 추가** (SLA 요구 시점이 정확한 타이밍)

### 3.4 PII 처리 정책

**자동 PII 마스킹은 도입하지 않음.** 대신 두 가지 메커니즘:

**(a) SDK에서 고객이 제어**:
```typescript
observeOpenAI({ logBody: 'full' | 'meta' | 'none' })  // 기본 'full'
```

| 옵션 | 저장 내용 |
|------|----------|
| `'full'` | request/response body 전체 (기본값) |
| `'meta'` | 토큰 수, 모델, latency, 에러만 (body는 null) |
| `'none'` | meta 최소화 |

**(b) Phase 1에 즉시 포함될 API 키 패턴 자동 마스킹** (logger.ts에서 INSERT 직전):
- Spanlens 키: `sl_live_*` → `sl_live_***`
- OpenAI 키: `sk-*`, `sk-proj-*` → `sk-***`
- Anthropic 키: `sk-ant-*` → `sk-ant-***`
- Gemini 키: `AIza*` → `AIza***`

자연어 PII(이름, 이메일, 주민번호, 카드 번호 등) 자동 마스킹은 **의료/금융 엔터프라이즈 고객 요구 시 도입**. 그게 정확한 트리거.

### 3.5 셀프호스트 패키징

**ClickHouse 포함 단일 `docker-compose.yml`로 패키징.** Postgres-only 모드 만들지 않음.

```yaml
# 셀프호스트 표준 배포
services:
  postgres:       # Supabase Postgres
  auth:           # Supabase GoTrue
  clickhouse:     # ← 필수 포함
  server:         # Hono (apps/server)
  web:            # Next.js (apps/web)
```

**금지 사항**:
- `if (config.useClickhouse)` 같은 코드 분기 **절대 금지** (영구 기술 부채)
- 두 가지 쿼리 경로 유지 금지

**셀프호스트 사용자 진입 부담 완화**:
- `./setup.sh` 한 번에 마이그레이션까지 자동
- README는 "5분 설치" 가이드 한 페이지

---

## 4. 아키텍처

```
                      ┌─────────────────────────────────┐
   Client App         │       Hono Server (Vercel)      │
       │              │                                 │
       ▼              │  ┌──────────┐   ┌─────────────┐ │
  /proxy/openai ──────┼──► logger.ts├──►│ ClickHouse  │ │  ← 쓰기 (INSERT)
                      │  │ + 키마스킹│   │  requests   │ │
                      │  └──────────┘   └──────┬──────┘ │
                      │                        │        │
                      │  ┌──────────┐         │        │
   Dashboard ─────────┼──► api/     ├─────────┘        │  ← 읽기 (SELECT)
                      │  │ requests │ + plan retention │
                      │  │ stats    │   필터 자동 주입 │
                      │  │ anomalies│                  │
                      │  └──────────┘                  │
                      │                                │
                      │  ┌──────────┐                  │
   /api/v1/* ─────────┼──► 나머지   ├──► Supabase ────┐│
                      │  │ API      │   Postgres     ││  ← 인증, 트랜잭션,
                      │  └──────────┘   (auth + 36개  ││     트레이싱 (UPDATE),
                      └──────────────── 테이블)──────┘│     subscriptions
                                                      │
```

**핵심 원칙**:
- Supabase 클라이언트는 그대로 유지 (Auth, RLS, 트랜잭션 영향 없음)
- ClickHouse는 **두 번째 데이터 스토어**로 추가
- 모든 requests 쿼리는 미들웨어 헬퍼 경유 (조직 격리 + plan retention 필터)
- 영향 받는 파일은 약 6~8개로 한정

---

## 5. ClickHouse 스키마

### 5.1 `requests` 테이블

```sql
CREATE TABLE requests (
    id                  UUID,
    organization_id     UUID,
    project_id          UUID,
    api_key_id          Nullable(UUID),

    provider            LowCardinality(String),
    model               LowCardinality(String),

    prompt_tokens       UInt32,
    completion_tokens   UInt32,
    total_tokens        UInt32,
    cache_read_tokens   UInt32 DEFAULT 0,
    cache_write_tokens  UInt32 DEFAULT 0,

    cost_usd            Nullable(Decimal(18, 8)),
    latency_ms          UInt32,
    proxy_overhead_ms   Nullable(UInt32),
    status_code         UInt16,

    request_body        String CODEC(ZSTD(3)),
    response_body       String CODEC(ZSTD(3)),
    error_message       Nullable(String),

    trace_id            Nullable(UUID),
    span_id             Nullable(UUID),
    prompt_version_id   Nullable(UUID),
    provider_key_id     Nullable(UUID),

    user_id             Nullable(String),
    session_id          Nullable(String),

    flags               String DEFAULT '[]',          -- JSON array
    response_flags      String DEFAULT '{}',          -- JSON object
    has_security_flags  Bool DEFAULT false,

    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (organization_id, project_id, created_at, id)
TTL toDateTime(created_at) + INTERVAL 365 DAY;
-- 365일 = Team 플랜 보존 기간. Free/Pro는 조회 시점 필터로 단축, Enterprise는 별도 테이블/partition.
```

**설계 결정 사항**:

| 항목 | 선택 | 이유 |
|------|------|------|
| Engine | `MergeTree` | 표준, append-only에 최적 |
| Partition | `toYYYYMM(created_at)` | 월별 파티션 — 시계열 쿼리 가속, drop partition 으로 retention 관리 |
| Order key | `(organization_id, project_id, created_at, id)` | 멀티테넌트 격리 + 시간 범위 쿼리 + 정렬 |
| `provider`, `model` | `LowCardinality(String)` | 유한한 값 집합, 압축 효율 극대 |
| body 컬럼 | `String CODEC(ZSTD(3))` | JSONB 대신 압축된 문자열 (3~10배 압축) |
| `flags` | JSON 문자열 | ClickHouse JSON 타입은 아직 experimental, String이 안전 |
| TTL | 365일 (Team 기준) | Free/Pro는 조회 필터로 처리. Enterprise는 별도 분리 |

### 5.2 인덱스 보조 (필요시)

쿼리 패턴에 따라 추가 가능:

```sql
-- model 부분 검색 (ILIKE)이 느릴 경우
ALTER TABLE requests ADD INDEX idx_model model TYPE bloom_filter(0.01) GRANULARITY 4;

-- trace_id 조회 (개별 trace 상세 페이지)
ALTER TABLE requests ADD INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 4;
```

> Phase 1에서는 인덱스 없이 시작, 실제 쿼리 패턴 보고 추가.

---

## 6. Phase 1: requests 이관 (~7일)

### Step 1: 인프라 결정 (0.5일)

**호스팅**: ClickHouse Cloud Development tier ($50/월)로 시작. Production tier 전환은 트래픽 보고 결정.

**로컬 개발**: Docker Compose에 추가
```yaml
clickhouse:
  image: clickhouse/clickhouse-server:24.10-alpine
  ports:
    - "8123:8123"  # HTTP
    - "9000:9000"  # Native
  volumes:
    - clickhouse_data:/var/lib/clickhouse
  environment:
    CLICKHOUSE_DB: spanlens
    CLICKHOUSE_USER: dev
    CLICKHOUSE_PASSWORD: dev
```

### Step 2: 클라이언트 통합 (0.5일)

```bash
pnpm --filter server add @clickhouse/client
```

**신규 파일**: `apps/server/src/lib/clickhouse.ts`

```typescript
import { createClient, type ClickHouseClient } from '@clickhouse/client'

let _client: ClickHouseClient | null = null

export function getClickhouse(): ClickHouseClient {
  if (_client) return _client
  _client = createClient({
    url: process.env.CLICKHOUSE_URL!,
    username: process.env.CLICKHOUSE_USER!,
    password: process.env.CLICKHOUSE_PASSWORD!,
    database: process.env.CLICKHOUSE_DB ?? 'spanlens',
    compression: { request: true, response: true },
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  })
  return _client
}
```

**환경변수** (`.env.example` 추가):
```
CLICKHOUSE_URL=https://xxx.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DB=spanlens
```

### Step 3: 마이그레이션 스크립트 (0.5일)

```
clickhouse/
  migrations/
    001_create_requests.sql
  apply.ts            # idempotent 실행기
  README.md
```

`package.json`:
```json
"scripts": { "ch:migrate": "tsx clickhouse/apply.ts" }
```

### Step 4: 쓰기 경로 교체 + API 키 마스킹 (1.5일)

**파일**: `apps/server/src/lib/logger.ts`

기존:
```typescript
await supabaseAdmin.from('requests').insert(payload)
```

목표:
```typescript
const masked = maskApiKeyPatterns(payload)  // ← Phase 1 신규
await getClickhouse().insert({
  table: 'requests',
  values: [masked],
  format: 'JSONEachRow',
})
```

**신규 헬퍼**: `apps/server/src/lib/pii-mask.ts`
```typescript
const PATTERNS = [
  /sl_live_[A-Za-z0-9]+/g,
  /sk-(?:proj-)?[A-Za-z0-9-_]+/g,
  /sk-ant-[A-Za-z0-9-_]+/g,
  /AIza[A-Za-z0-9-_]+/g,
]

export function maskApiKeyPatterns(payload: RequestLogData): RequestLogData {
  // request_body, response_body 문자열 내부의 위 패턴을 ***로 치환
}
```

**주의사항**:
1. `request_body`, `response_body`는 JSON.stringify로 직렬화
2. `flags`, `response_flags`도 JSON.stringify
3. `created_at`은 ClickHouse가 ISO8601 문자열 받음
4. CLAUDE.md Gotcha #8 — `fireAndForget(c, promise)` 패턴 유지 (Vercel drain)
5. CLAUDE.md Gotcha #12 — `crypto.ts`의 async 함수 await 빼먹지 말 것

### Step 5: 읽기 경로 교체 + plan retention 필터 (2일)

영향 받는 파일:

| 파일 | 작업 |
|------|------|
| `apps/server/src/api/requests.ts` | ClickHouse SQL로 재작성 + retention 필터 자동 주입 |
| `apps/server/src/api/stats.ts` | ClickHouse 집계 쿼리 |
| `apps/server/src/api/anomalies.ts` | ClickHouse `quantile()` 사용 |
| `apps/server/src/api/exports.ts` | ClickHouse `FORMAT CSV/JSONEachRow` |
| `apps/server/src/api/savings.ts` (있다면) | ClickHouse 집계 |

**신규 헬퍼**: `apps/server/src/lib/requests-query.ts`
```typescript
import { getClickhouse } from './clickhouse'
import { getOrgPlan } from './plans'

const RETENTION = { free: 14, pro: 90, team: 365, enterprise: 36500 }

export async function queryRequests(orgId: string, sql: string, params: object) {
  const plan = await getOrgPlan(orgId)
  const days = RETENTION[plan]
  return getClickhouse().query({
    query: `${sql} AND organization_id = {orgId:UUID}
                    AND created_at >= now() - INTERVAL ${days} DAY`,
    query_params: { orgId, ...params },
  })
}
```

**provider_keys 조인**: 애플리케이션 레이어 (방안 A) — ClickHouse 조회 후 Supabase에서 별도 조회 후 합침.

### Step 6: SDK `logBody` 옵션 추가 (1일)

**파일**: `packages/sdk/src/observe-openai.ts` (또는 동등 위치)

```typescript
interface ObserveOptions {
  logBody?: 'full' | 'meta' | 'none'  // 기본 'full'
}
```

- `'meta'`: SDK가 body를 `null`로 보내거나, 헤더 `x-spanlens-log-body: meta`를 통해 서버에 통지 → logger가 body 컬럼을 빈 문자열로 저장
- `'none'`: 동일하게 헤더 전달, 토큰 수까지 최소화

**서버측**: `apps/server/src/lib/logger.ts`에서 헤더 읽고 body 필드 처리.

**SDK 문서 업데이트** (`/docs/sdk`): 새 옵션 설명 + PII 보호 가이드.

### Step 7: 검증 & Supabase 정리 (1일)

**검증 절차**:
1. 로컬에서 모든 대시보드 페이지 동작 확인
2. SDK로 실제 LLM 호출 → ClickHouse에 row 들어가는지 확인
3. plan별 retention 필터 동작 확인 (Free 계정으로 14일 초과 데이터 안 보이는지)
4. API 키 마스킹 동작 확인 (`sk-...` 패턴이 `sk-***`로 저장)
5. 부하 테스트: 100 req/s로 5분간 INSERT → 데이터 누락 0% 확인

**Supabase 정리** (Step 6까지 1주 안정 운영 후):
```sql
-- supabase/migrations/YYYYMMDDHHMMSS_drop_requests.sql
DROP TABLE IF EXISTS requests CASCADE;
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_request_id_fkey;
-- spans.request_id는 UUID 컬럼으로 남김 (ClickHouse requests.id 참조)
```

---

## 7. Phase 2: usage_daily 결정 (이후)

Phase 1 안정화 후 결정. 선택지:

### 옵션 A: ClickHouse Materialized View
- 장점: 실시간 자동 집계
- 단점: 쿼터 체크에서 크로스 DB 읽기 발생

### 옵션 B: Supabase에 유지 + 주기적 동기화
- 장점: 쿼터 체크 단순
- 단점: 하루 늦은 데이터

### 옵션 C: usage_daily 폐기 + 매번 ClickHouse 직접 집계
- 장점: 단순함
- 단점: 쿼터 체크 hot path가 ClickHouse 의존

**판단 기준**: Phase 1 끝나고 빌링 쿼터 체크 코드를 다시 본 뒤 결정.

---

## 8. 운영 고려사항

### 8.1 비용 추정 (월별)

| 항목 | 트래픽 가정 | 예상 비용 |
|------|-----------|----------|
| ClickHouse Cloud Dev tier | 1억 row, 압축 후 ~10GB | $50 |
| 데이터 전송 (Vercel ↔ ClickHouse) | 10GB egress | $1 |
| Supabase Pro (유지) | 현재 그대로 | $25 |
| **합계** | | **~$76/월** |

### 8.2 모니터링

- ClickHouse Cloud 대시보드 — query latency, INSERT throughput
- `system.query_log` 활용 — 느린 쿼리 추적
- 알람: INSERT 실패율 > 0.1%, query p95 > 1초

### 8.3 보안

- ClickHouse Cloud의 IP 화이트리스트 활성화 (Vercel egress IP)
- TLS only
- 별도 read-only 사용자 분리 (대시보드 쿼리용)
- API 키 패턴 자동 마스킹은 logger.ts 단계에서 처리 (3.4 참조)

---

## 9. 롤백 계획

각 단계마다 롤백 가능한 commit 단위로 작업:

1. **Step 4 (쓰기 교체) 후 문제 발생** → 한 commit revert → logger.ts가 Supabase로 INSERT 복귀
2. **Step 5 (읽기 교체) 후 문제 발생** → API 파일별로 revert 가능
3. **Step 7 (Supabase 테이블 drop) 이후 문제 발생** → Supabase 마이그레이션으로 빈 테이블 재생성, 듀얼 라이트 코드 추가, 점진 복구

**핵심 안전장치**: Step 7 직전까지 Supabase의 `requests` 테이블은 그대로 남겨둠. 일주일 안정 운영 확인 후 drop.

---

## 10. 작업 분해 & 일정

| Step | 작업 | 예상 공수 | 의존성 |
|------|------|----------|--------|
| 1 | 인프라 결정 + Cloud 가입 | 0.5d | — |
| 2 | 클라이언트 통합 + 로컬 Docker | 0.5d | Step 1 |
| 3 | 마이그레이션 스크립트 + 스키마 적용 | 0.5d | Step 2 |
| 4 | logger.ts 쓰기 경로 교체 + API 키 마스킹 | 1.5d | Step 3 |
| 5 | API 라우터 읽기 경로 교체 + plan retention 필터 | 2d | Step 4 |
| 6 | SDK `logBody` 옵션 + 문서 | 1d | Step 4 |
| 7 | 검증 + Supabase 정리 | 1d | Step 5, 6 |
| | **합계** | **~7일** | |

Phase 2 (`usage_daily` 결정)는 Phase 1 안정화 1주 이후 별도 산정.

---

## 11. 검증 체크리스트

이관 완료 판단 기준:

- [ ] 모든 대시보드 페이지가 ClickHouse 데이터로 정상 렌더링
- [ ] 프록시 호출 → ClickHouse `requests`에 정확히 1 row INSERT
- [ ] provider별, 모델별, 날짜별 집계 결과가 기존 Postgres 결과와 일치
- [ ] **plan별 retention 필터 동작 확인** (Free 계정에서 14일 초과 데이터 비노출)
- [ ] **API 키 패턴 자동 마스킹 동작 확인** (sk-, sk-ant-, sl_live_, AIza 패턴)
- [ ] **SDK `logBody: 'meta'` 옵션 동작 확인** (body 컬럼 빈 값 저장)
- [ ] 멀티테넌트 격리 — 다른 조직 데이터 절대 노출되지 않음
- [ ] CSV/JSON 익스포트 정상 동작
- [ ] 이상 탐지(anomaly detection) 쿼리 정상 동작
- [ ] 부하 테스트 — 100 req/s 5분간 무손실
- [ ] CLAUDE.md `fireAndForget` 패턴 유지 확인
- [ ] `.env.example` 업데이트, Vercel 환경변수 등록
- [ ] **셀프호스트 `docker-compose.yml`에 ClickHouse 추가**
- [ ] CLAUDE.md에 ClickHouse 관련 Gotcha 추가

---

## 12. CLAUDE.md 업데이트 사항

이관 후 CLAUDE.md에 추가할 내용:

```markdown
## ClickHouse — requests 전용
- `requests` 테이블은 ClickHouse에 있음. Supabase에 없음.
- 쓰기: `apps/server/src/lib/clickhouse.ts`의 `getClickhouse().insert(...)`
- 읽기: 항상 `apps/server/src/lib/requests-query.ts`의 `queryRequests()` 헬퍼 경유
  → organization_id 격리 + plan retention 필터 자동 주입
- API 키 패턴 자동 마스킹: `apps/server/src/lib/pii-mask.ts` (sk-, sk-ant-, sl_live_, AIza)
- 다른 테이블(provider_keys 등)과 조인 필요 시 애플리케이션 레이어에서 처리
- 로컬: `docker-compose up clickhouse` → `pnpm ch:migrate`
- 환경변수: CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DB

## 셀프호스트
- ClickHouse는 셀프호스트에도 필수 포함. Postgres-only 모드 만들지 말 것.
- `if (config.useClickhouse)` 같은 코드 분기 절대 금지.

## SDK logBody 옵션
- `observeOpenAI({ logBody: 'full' | 'meta' | 'none' })`
- 헤더 `x-spanlens-log-body`로 서버에 전달
- logger.ts에서 헤더 읽고 body 저장 여부 결정
```

---

## 13. 미해결 항목 (Phase 1 이후)

| 항목 | 처리 시점 |
|------|----------|
| `usage_daily` 처리 방식 (옵션 A/B/C) | Phase 1 안정화 후, 빌링 코드 보고 결정 |
| Enterprise 별도 테이블/partition 설계 | 첫 Enterprise 고객 계약 시 |
| S3 별도 백업 export | 첫 Enterprise 고객 SLA 시점 |
| 자연어 PII 자동 마스킹 (이메일, 카드 등) | 의료/금융 Enterprise 요구 시 |
| 셀프호스트 ClickHouse 운영 가이드 문서 | Phase 1 직후 |

---

## 14. 참고 자료

- ClickHouse 공식 문서: https://clickhouse.com/docs
- `@clickhouse/client` npm: https://www.npmjs.com/package/@clickhouse/client
- Langfuse ClickHouse 마이그레이션 사례: https://langfuse.com/blog/2024-09-clickhouse-migration
- PostHog ClickHouse 도입 사례: https://posthog.com/blog/clickhouse-announcement
