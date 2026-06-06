# Langfuse 벤치마킹 → Spanlens 구현 계획

> **작성일**: 2026-06-05
> **상태**: 계획 단계
> **범위**: launch 직전 ~ launch +6개월 (Phase 4A → 4B → 5)
> **저자 의도**: Claude/엔지니어가 이 문서만 보고 각 항목을 독립 실행 가능하도록 작성

---

## 목차

- [실행 요약](#실행-요약)
- [공통 원칙 & 작업 규약](#공통-원칙--작업-규약)
- [Phase 4A — launch 직전 (1-2주, 5개 항목)](#phase-4a--launch-직전-1-2주-5개-항목)
  - [4A.1 Prompt Redis 캐시 (lock + invalidate)](#4a1-prompt-redis-캐시-lock--invalidate)
  - [4A.2 Soft Delete 큐 (PendingDeletion)](#4a2-soft-delete-큐-pendingdeletion)
  - [4A.3 Audit Log 뷰어 UI](#4a3-audit-log-뷰어-ui)
  - [4A.4 Token Prefix + last_used_at 표시](#4a4-token-prefix--last_used_at-표시)
  - [4A.5 기본 평가 템플릿 시드](#4a5-기본-평가-템플릿-시드)
- [Phase 4B — launch 직후 (2-3주, 3개 항목)](#phase-4b--launch-직후-2-3주-3개-항목)
  - [4B.1 ScoreConfig 타입화](#4b1-scoreconfig-타입화)
  - [4B.2 평가 실행에 OTel 스팬](#4b2-평가-실행에-otel-스팬)
  - [4B.3 백그라운드 마이그레이션 프레임워크](#4b3-백그라운드-마이그레이션-프레임워크)
- [Phase 5 — 전략적 (6-8주, 3개 항목)](#phase-5--전략적-6-8주-3개-항목)
  - [5.1 `events` 통합 스키마 (ClickHouse)](#51-events-통합-스키마-clickhouse)
  - [5.2 Code Eval 샌드박스](#52-code-eval-샌드박스)
  - [5.3 3-Stage Ingestion + S3 캐시](#53-3-stage-ingestion--s3-캐시)
- [차별화 강화 (병행, 항목별 1-2주)](#차별화-강화-병행-항목별-1-2주)
  - [D.1 인-라인 PII 자동 마스킹](#d1-인-라인-pii-자동-마스킹)
  - [D.2 모델 추천 자동 적용](#d2-모델-추천-자동-적용)
  - [D.3 트래픽 Routing Rules](#d3-트래픽-routing-rules)
  - [D.4 공유 링크 SEO 최적화](#d4-공유-링크-seo-최적화)
  - [D.5 README 배지 라이브 갱신](#d5-readme-배지-라이브-갱신)
- [의존성 그래프](#의존성-그래프)
- [위험 관리](#위험-관리)

---

## 실행 요약

### 총 작업량
- Phase 4A: **7-10일** (5개)
- Phase 4B: **2-3주** (3개)
- Phase 5: **6-8주** (3개)
- 차별화 강화: **항목당 1-2주** (5개, 병행 가능)

**전체**: 약 4-5개월 (solo dev 기준, 작업 90% 가동률 가정)

### 작업 순서 원칙
1. **launch 직전 안전한 win부터** — 사용자 신뢰 + UX 즉시 개선
2. **인프라(7번) → 데이터(5번)** 순서 — 백그라운드 마이그레이션 없이 events 스키마 도입 불가
3. **차별화 강화는 Phase 4B와 병행** — 마케팅 자산 빨리 만들기

### 핵심 게이트
- Phase 4A 완료 = launch 가능 상태
- Phase 4B 완료 = 평가 카테고리 동등 도달
- Phase 5 완료 = Langfuse 핵심 영역 95% 도달

---

## 공통 원칙 & 작업 규약

모든 항목 작업 시 따를 규약. CLAUDE.md의 gotcha 28개를 전제로 함.

### A. 마이그레이션 작성
- 새 SQL 파일: `supabase/migrations/YYYYMMDDHHMMSS_desc.sql`
- **기존 파일 수정 금지**
- 멱등 작성 (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS)
- NOT NULL 추가 시 DEFAULT 같이 (backfill 자동화)
- RLS 새 테이블: `ALTER TABLE t ENABLE ROW LEVEL SECURITY` + 정책
- 마이그레이션 후 즉시 `supabase gen types`

### B. ClickHouse 컬럼 추가
- **migration PR 먼저 머지 + production 적용 → 그 다음 INSERT 코드 PR** (gotcha #21)
- `input_format_skip_unknown_fields: 1` 안전망 신뢰
- `toClickhouseTimestamp()` 헬퍼 필수 (gotcha #18)
- 숫자 컬럼은 응답에서 `Number()` 변환 (gotcha #19)
- 새 컬럼은 `lib/logger.ts`에도 동시 반영 (fallback queue 일관성, gotcha #23)

### C. 코드 변경
- 새 모듈 추가 시 `apps/server/src/lib/` 기존 패턴 따름 (singleton + 인메모리 캐시 + Sentry 통합)
- `lib/crypto.ts`의 함수는 모두 async → await 필수 (gotcha #12)
- 새 Vercel Edge fire-and-forget은 `fireAndForget(c, promise)` 사용 (gotcha #8)
- ClickHouse 헬퍼는 `lib/clickhouse.ts` + `lib/requests-query.ts` 경유 (gotcha #3)

### D. UI 변경
- 새 라우트 추가 시 `(dashboard)/` 그룹 + 미들웨어 인증
- 페이지에서 `apiGet<T>` 등 `lib/api.ts` 사용
- 새 데이터 fetch는 `lib/queries/use-*.ts` TanStack Query 훅으로
- 날짜 포맷팅은 `lib/utils.ts`의 `formatDate()` (gotcha #22)
- onboarding/dashboard navigation은 `window.location.href` (gotcha #15)

### E. 인증 미들웨어 선택
- read API + 외부 도구 호출 가능성 → `authJwtOrApiKey`
- write API → `authApiKey` + `requireFullScope`
- admin → `authJwt` + `requireSystemAdmin`
- `app.ts` mount 순서: 더 구체적인 라우터를 wildcard 라우터보다 먼저

### F. 검증 명령
```bash
# 변경 범위별 최소 검증
pnpm --filter server typecheck && pnpm --filter server lint && pnpm --filter server test
pnpm --filter web typecheck && pnpm --filter web lint
pnpm typecheck && pnpm lint  # 크로스 패키지
```

### G. 커밋 규약
- Conventional Commits: `type(scope): description`
- type: feat | fix | refactor | perf | test | docs | chore
- scope: web | server | sdk | db | proxy | clickhouse | mcp

---

# Phase 4A — launch 직전 (1-2주, 5개 항목)

## 4A.1 Prompt Redis 캐시 (lock + invalidate)

### 목표
프록시 호출 핫 패스에서 Supabase 조회 제거. p50 latency -20~40ms.

### 현재 상태
- `apps/server/src/lib/resolve-prompt-version.ts`: 매 프록시 호출 시 Supabase 조회
- `apps/server/src/api/prompts.ts:385`: 버전 생성/수정 시 캐시 무효화 없음
- 프록시는 `X-Spanlens-Prompt-Version` 헤더 → resolve → DB 조회 → 적용

### 변경 사항

#### DB
없음 (캐시만 추가)

#### 새 파일
1. `apps/server/src/lib/prompt-cache.ts` — Redis Lua script 캐시 래퍼

```typescript
// 인터페이스 스케치 (실제 구현 시 채움)
export async function getCachedPromptVersion(
  projectId: string,
  name: string,
  versionOrLabel: string | number,
): Promise<PromptVersion | null>

export async function invalidatePromptCache(
  projectId: string,
  name: string,
): Promise<void>

export async function setCachedPromptVersion(
  projectId: string,
  name: string,
  versionOrLabel: string | number,
  version: PromptVersion,
): Promise<void>
```

#### Lua Script (Upstash Free 호환, gotcha #24)
```lua
-- prompt_set.lua: SET with version invalidation
-- KEYS[1] = "prompt:<proj>:<name>:<verOrLabel>"
-- KEYS[2] = "prompt:<proj>:<name>:lock"
-- ARGV[1] = JSON value
-- ARGV[2] = TTL seconds

local lock = redis.call('GET', KEYS[2])
if lock then return nil end  -- 다른 쓰기 진행 중, 캐시 skip

redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
```

```lua
-- prompt_invalidate.lua: 모든 버전 무효화
-- KEYS[1] = "prompt:<proj>:<name>:lock"
-- ARGV[1] = lock TTL
-- ARGV[2] = pattern "prompt:<proj>:<name>:*"

redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])

local cursor = '0'
repeat
  local result = redis.call('SCAN', cursor, 'MATCH', ARGV[2], 'COUNT', 100)
  cursor = result[1]
  for _, key in ipairs(result[2]) do
    if key ~= KEYS[1] then redis.call('DEL', key) end
  end
until cursor == '0'

return 1
```

#### 기존 파일 수정
1. `apps/server/src/lib/resolve-prompt-version.ts`
   - 함수 시작에 `getCachedPromptVersion()` 호출
   - 캐시 hit 시 즉시 반환
   - 캐시 miss 시 기존 DB 로직 → `setCachedPromptVersion()`

2. `apps/server/src/api/prompts.ts`
   - `POST /api/v1/prompts` 직후 `invalidatePromptCache()` 호출
   - `DELETE /api/v1/prompts/:name/:version` 직후 동일

3. `apps/server/src/api/prompt-experiments.ts`
   - 새 A/B 실험 시작/종료 시 invalidate (라벨 변경되므로)

### 작업 단계
- [ ] (0.5d) `lib/prompt-cache.ts` 스켈레톤 + Upstash Redis 클라이언트 통합
- [ ] (0.5d) Lua script 2개 작성 + 로컬 테스트
- [ ] (0.5d) `resolve-prompt-version.ts` 캐시 통합
- [ ] (0.5d) `api/prompts.ts`, `api/prompt-experiments.ts` invalidation 통합
- [ ] (0.5d) 단위 테스트: cache hit/miss/concurrent invalidate

### 검증
- 로컬: `pnpm dev` + curl로 같은 promptName/version 2회 호출 → 두 번째는 Redis hit (로그 확인)
- 동시성: 1 thread가 invalidate 중일 때 다른 thread의 set이 reject 되는지
- production: Sentry에 `cache.miss` rate 메트릭 추가 → 24시간 후 hit rate 90%+ 확인

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| Upstash Free `redis.set()` silent reject | 100% Lua script 경유 (gotcha #24) |
| 캐시 stale (invalidate 실패) | TTL 5분 (긴급 안전망) |
| Lua script 에러로 fallback 안 됨 | try/catch + DB fallback + Sentry 알림 |

### 의존성
없음 (독립 작업)

### 작업량
**1.5-2일**

---

## 4A.2 Soft Delete 큐 (PendingDeletion)

### 목표
사용자 실수로 키/프롬프트 삭제 시 72시간 grace + Restore. 지원 티켓 제거.

### 현재 상태
- `apps/server/src/api/apiKeys.ts`: `DELETE` 즉시 hard delete
- `apps/server/src/api/providerKeys.ts`: 동일
- `apps/server/src/api/prompts.ts`: 동일
- `apps/server/src/api/evals.ts`: archived_at 컬럼은 있는데 실제 복구 UI 없음

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260606000000_pending_deletions.sql`

```sql
CREATE TABLE IF NOT EXISTS pending_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'api_key', 'provider_key', 'prompt_version', 'evaluator', 'dataset'
  )),
  resource_id UUID NOT NULL,
  resource_snapshot JSONB NOT NULL,  -- 복원용 row 백업
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ NOT NULL,  -- requested_at + 72h
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ,
  UNIQUE (resource_type, resource_id, organization_id)
    WHERE cancelled_at IS NULL AND executed_at IS NULL
);

CREATE INDEX IF NOT EXISTS pending_deletions_scheduled_idx
  ON pending_deletions (scheduled_for)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;

ALTER TABLE pending_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_deletions_select ON pending_deletions
  FOR SELECT USING (is_org_member(organization_id));

CREATE POLICY pending_deletions_insert ON pending_deletions
  FOR INSERT WITH CHECK (is_org_member(organization_id));

CREATE POLICY pending_deletions_update ON pending_deletions
  FOR UPDATE USING (is_org_member(organization_id));
```

#### 기존 라우터 수정 패턴
**Before:**
```typescript
// apps/server/src/api/apiKeys.ts
app.delete('/:id', async (c) => {
  await supabaseAdmin.from('api_keys').delete().eq('id', id)
  return c.json({ success: true })
})
```

**After:**
```typescript
app.delete('/:id', async (c) => {
  const { data: keyRow } = await supabaseAdmin
    .from('api_keys').select('*').eq('id', id).single()

  if (!keyRow) return c.json({ error: 'NOT_FOUND' }, 404)

  await supabaseAdmin.from('pending_deletions').insert({
    organization_id: keyRow.organization_id,
    resource_type: 'api_key',
    resource_id: id,
    resource_snapshot: keyRow,
    requested_by: c.get('userId'),
    scheduled_for: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
  })

  // 즉시 비활성화 (트래픽 차단), 실제 row는 유지
  await supabaseAdmin.from('api_keys')
    .update({ is_active: false })
    .eq('id', id)

  return c.json({ success: true, restoreUntil: ... })
})
```

#### 새 라우터
**파일**: `apps/server/src/api/pendingDeletions.ts`

엔드포인트:
- `GET /api/v1/pending-deletions` — 목록
- `POST /api/v1/pending-deletions/:id/restore` — 취소 + is_active 복원
- (cron) `/cron/execute-pending-deletions` — 72시간 지난 것 실제 삭제

#### Cron 추가
**파일**: `apps/server/src/api/cron.ts`

```typescript
app.post('/cron/execute-pending-deletions', requireCronSecret, async (c) => {
  const { data: due } = await supabaseAdmin.from('pending_deletions')
    .select('*')
    .lte('scheduled_for', new Date().toISOString())
    .is('cancelled_at', null)
    .is('executed_at', null)
    .limit(100)

  for (const pd of due) {
    try {
      // resource_type별 실제 삭제
      await hardDeleteByType(pd.resource_type, pd.resource_id)
      await supabaseAdmin.from('pending_deletions')
        .update({ executed_at: new Date().toISOString() })
        .eq('id', pd.id)
    } catch (err) {
      // Sentry 알림 + 다음 cron에서 재시도
    }
  }
})
```

`apps/server/vercel.json`에 cron 추가:
```json
{ "path": "/cron/execute-pending-deletions", "schedule": "0 */6 * * *" }
```

#### UI
**파일**: `apps/web/app/(dashboard)/settings/pending-deletions/page.tsx`

- 삭제 예정 목록 + 남은 시간 + Restore 버튼
- `lib/queries/use-pending-deletions.ts` 훅 추가

### 작업 단계
- [ ] (0.5d) 마이그레이션 작성 + `pnpm gen types`
- [ ] (0.5d) `apps/server/src/api/pendingDeletions.ts` 라우터
- [ ] (0.5d) 4개 기존 라우터 (apiKeys, providerKeys, prompts, evals) hard delete → soft delete 전환
- [ ] (0.5d) Cron 핸들러 + vercel.json
- [ ] (0.5d) UI 페이지 + 훅
- [ ] (0.5d) 단위 테스트 + E2E (실수로 삭제 → 복원)

### 검증
- 키 삭제 → `pending_deletions` row 생성 + `is_active=false`
- 72시간 (테스트에선 scheduled_for 과거로 강제) → cron 실행 → 실제 hard delete
- 복원 → `is_active=true` 회복

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| `resource_snapshot` JSONB 크기 폭증 | prompt_version 같은 큰 row는 path만 저장 (별도 백업 테이블) |
| Cron 실패 → 무한 누적 | UNIQUE 제약 + 에러는 Sentry + 다음 실행에서 자동 재시도 |
| 이미 cascade delete된 자식 row | resource_snapshot 충분, 부모 복원 불가는 OK (UI에 표시) |

### 의존성
없음

### 작업량
**2-3일**

---

## 4A.3 Audit Log 뷰어 UI

### 목표
이미 있는 `audit_logs` 테이블 + API를 UI로 노출. 컴플라이언스 + 디버깅.

### 현재 상태
- `supabase/migrations/`: `audit_logs` 테이블 있음 (service_role only)
- `apps/server/src/api/auditLogs.ts`: `GET /api/v1/audit-logs` 라우터 있음
- `apps/web/app/(dashboard)/`: 페이지 없음

### 변경 사항

#### 새 페이지
**파일**: `apps/web/app/(dashboard)/settings/audit-logs/page.tsx`

기능:
- 시간 범위 필터 (7d / 30d / 90d / custom)
- 액션 타입 필터 (api_key.create, provider_key.add, member.invite 등)
- 사용자 필터 (드롭다운)
- 페이지네이션 (50/page)
- row 클릭 시 metadata JSONB 상세 표시 (drawer)

#### 새 컴포넌트
**파일**: `apps/web/components/audit-logs/AuditLogsTable.tsx`
- 컬럼: Time / User / Action / Resource / IP / Details (확장)

**파일**: `apps/web/components/audit-logs/AuditLogDetailDrawer.tsx`
- JSONB metadata 트리 뷰

#### 새 훅
**파일**: `apps/web/lib/queries/use-audit-logs.ts`

```typescript
export function useAuditLogs(params: {
  from?: string
  to?: string
  action?: string
  userId?: string
  page?: number
  limit?: number
})
```

#### 사이드바
**파일**: `apps/web/components/layout/Sidebar.tsx`
- Settings 그룹에 "Audit Logs" 메뉴 추가 (admin 역할만, PermissionGate)

### 작업 단계
- [ ] (0.5d) `use-audit-logs.ts` 훅 + 타입
- [ ] (0.5d) `AuditLogsTable.tsx` + 필터 UI
- [ ] (0.5d) `AuditLogDetailDrawer.tsx`
- [ ] (0.5d) 페이지 + 사이드바 등록 + admin 가드

### 검증
- admin/editor/viewer로 각각 접근 → admin만 보여야 함
- 액션 타입 필터링 동작
- 페이지네이션 + 시간 범위 동작

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| audit_logs 테이블 누락 액션 | `apps/server/src/lib/`에 auditLog() 헬퍼 호출 누락된 라우터 찾기 (별도 cleanup PR) |
| 큰 metadata JSONB UI 느림 | drawer는 lazy 로드 |

### 의존성
없음

### 작업량
**2일**

---

## 4A.4 Token Prefix + last_used_at 표시

### 목표
키 목록에 prefix + 마지막 사용 시각 노출. 오래된 키 정리 유도.

### 현재 상태
- `api_keys.key_prefix`: 컬럼 있음 (생성 시 첫 12자)
- `api_keys.last_used_at`: **없음** — proxy 호출 시 throttled write 필요
- `provider_keys`: `last_used_at` 이미 있고 ClickHouse 쿼리로 enrich
- UI: 키 목록에 prefix 노출 약함

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260607000000_api_keys_last_used_at.sql`

```sql
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS
  last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS api_keys_last_used_at_idx
  ON api_keys (organization_id, last_used_at DESC NULLS LAST);
```

#### Throttled Write
**파일**: `apps/server/src/middleware/authApiKey.ts`

매 호출마다 UPDATE 하면 DB 부담. 5분에 한 번 cap:

```typescript
// 메모리 내 last write 시각 추적 (per-process)
const lastWriteCache = new Map<string, number>()
const THROTTLE_MS = 5 * 60 * 1000

async function maybeUpdateLastUsed(apiKeyId: string) {
  const last = lastWriteCache.get(apiKeyId) ?? 0
  if (Date.now() - last < THROTTLE_MS) return
  lastWriteCache.set(apiKeyId, Date.now())

  // fire-and-forget UPDATE
  fireAndForget(
    null,
    supabaseAdmin.from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKeyId)
  )
}
```

`authApiKey` 미들웨어 마지막에 `maybeUpdateLastUsed(apiKeyId)` 호출.

#### API 응답
**파일**: `apps/server/src/api/apiKeys.ts`

`GET /api/v1/api-keys` 응답에 `lastUsedAt`, `keyPrefix` 명시 포함 (already there일 가능성 — 확인).

#### UI
**파일**: `apps/web/app/(dashboard)/settings/api-keys/` (또는 현재 위치)

- 표 컬럼: `Name | Prefix (sl_live_abc12...) | Scope | Last Used | Created | Actions`
- 30일 미사용은 회색 배지 + "Stale" 표시
- 90일 미사용은 빨간 배지 + "Consider revoking" 툴팁

### 작업 단계
- [ ] (0.5d) 마이그레이션 + 인덱스
- [ ] (0.5d) authApiKey throttled write 헬퍼
- [ ] (0.5d) API 응답 검증 + UI 업데이트
- [ ] (0.5d) Stale digest cron 확인 (`lib/stale-key-digest.ts`)이 새 컬럼 사용하도록 갱신

### 검증
- 키 생성 → 사용 → `last_used_at` 채워짐
- 5분 내 100회 호출 → UPDATE 1번만
- UI에서 stale 배지 노출

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| serverless 다중 인스턴스에서 throttle 중복 | DB UPDATE 자체는 idempotent, 5분 ±α 정확도면 충분 |
| 메모리 누수 | Map 크기 10000 cap, LRU 강퇴 (Node Map은 insertion order) |

### 의존성
없음

### 작업량
**1.5-2일**

---

## 4A.5 기본 평가 템플릿 시드

### 목표
신규 사용자가 "어떤 평가부터" 막힘 없도록 빌트인 템플릿 제공.

### 현재 상태
- `apps/web/app/(dashboard)/evals/evals-client.tsx`: 3개 템플릿 (response quality, PII leak, persona match) 하드코딩
- DB에 템플릿 시드 없음

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260608000000_default_evaluator_templates.sql`

```sql
CREATE TABLE IF NOT EXISTS evaluator_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,  -- 'readability', 'hallucination', etc.
  name TEXT NOT NULL,
  description TEXT,
  criterion TEXT NOT NULL,  -- LLM prompt
  recommended_judge_provider TEXT,  -- 'openai', 'anthropic'
  recommended_judge_model TEXT,
  score_data_type TEXT NOT NULL CHECK (score_data_type IN ('NUMERIC', 'CATEGORICAL', 'BOOLEAN')),
  score_min FLOAT, score_max FLOAT,
  score_categories JSONB,
  category TEXT,  -- 'quality', 'safety', 'cost' 그룹핑
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 시드 (10개)
INSERT INTO evaluator_templates (slug, name, description, criterion, recommended_judge_provider, recommended_judge_model, score_data_type, score_min, score_max, category) VALUES
('readability', 'Readability', 'How clear and well-structured is the response?',
  'Rate the readability of the response on a scale of 0 to 1...', 'openai', 'gpt-4o-mini', 'NUMERIC', 0, 1, 'quality'),
('hallucination', 'Hallucination', 'Does the response contain factually incorrect statements?',
  '...', 'anthropic', 'claude-3-5-haiku', 'NUMERIC', 0, 1, 'safety'),
('toxicity', 'Toxicity', 'Does the response contain harmful or offensive language?',
  '...', 'openai', 'gpt-4o-mini', 'BOOLEAN', NULL, NULL, 'safety'),
('relevance', 'Query Relevance', 'How relevant is the response to the input query?',
  '...', 'openai', 'gpt-4o-mini', 'NUMERIC', 0, 1, 'quality'),
('completeness', 'Completeness', 'Does the response fully answer the question?',
  '...', 'openai', 'gpt-4o-mini', 'NUMERIC', 0, 1, 'quality'),
('conciseness', 'Conciseness', 'Is the response appropriately concise?',
  '...', 'openai', 'gpt-4o-mini', 'NUMERIC', 0, 1, 'quality'),
('factuality', 'Factuality', 'Are the claims supported by evidence?',
  '...', 'anthropic', 'claude-3-5-sonnet', 'NUMERIC', 0, 1, 'safety'),
('pii_leak', 'PII Leak', 'Does the response expose personal data?',
  '...', 'openai', 'gpt-4o-mini', 'BOOLEAN', NULL, NULL, 'safety'),
('persona_match', 'Persona Match', 'Does the response match the expected brand voice?',
  '...', 'openai', 'gpt-4o', 'NUMERIC', 0, 1, 'quality'),
('cost_efficiency', 'Cost vs Quality', 'Could a cheaper model produce a similar response?',
  '...', 'anthropic', 'claude-3-5-sonnet', 'BOOLEAN', NULL, NULL, 'cost');
```

(실제 criterion 프롬프트는 별도 시드 SQL에 풀어 작성)

#### API
**파일**: `apps/server/src/api/evals.ts`

`GET /api/v1/evaluators/templates` 추가 — 카테고리별 그룹핑된 템플릿 목록.

#### UI
**파일**: `apps/web/app/(dashboard)/evals/components/TemplatePicker.tsx`

- 카테고리 탭 (Quality / Safety / Cost)
- 카드 형식, "Use this template" 클릭 시 NewEvaluatorDialog에 prefill
- 추천 judge 모델 표시 + 1회 실행 추정 비용

#### 훅
**파일**: `apps/web/lib/queries/use-evaluator-templates.ts`

### 작업 단계
- [ ] (1d) 시드 마이그레이션 + 10개 criterion 작성 (실제 효과 LLM으로 검증)
- [ ] (0.5d) 라우터 + 훅
- [ ] (0.5d) TemplatePicker 컴포넌트 + Dialog 통합
- [ ] (0.5d) /docs/quick-start에 "Try a template" 섹션 추가

### 검증
- 신규 organization → /evals 첫 진입 시 TemplatePicker 노출
- 템플릿 선택 → 평가자 생성 → 데이터셋에 실행 → 결과 표시

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| Criterion 프롬프트 품질 나쁨 | 각 템플릿마다 자체 dogfooding 데이터셋으로 baseline 측정 (별도 작업) |
| 카테고리 분류 모호 | 우선 3개 카테고리, 추후 확장 |

### 의존성
- **권장**: 4B.1 (ScoreConfig 타입화)와 같이 머지 — score_data_type 컬럼이 ScoreConfig와 일관성 유지

### 작업량
**2-3일**

---

# Phase 4B — launch 직후 (2-3주, 3개 항목)

## 4B.1 ScoreConfig 타입화

### 목표
스코어를 NUMERIC만이 아니라 CATEGORICAL/BOOLEAN/TEXT까지 지원. 휴먼 평가 UX 개선 + 카테고리 분포 분석.

### 현재 상태
- `eval_results.score`: numeric 0..1 only
- `human_evals.score`: numeric 0..1 + `raw_score` (UI 원본)
- UI: 슬라이더만

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260620000000_score_configs.sql`

```sql
CREATE TABLE IF NOT EXISTS score_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  data_type TEXT NOT NULL CHECK (data_type IN ('NUMERIC','CATEGORICAL','BOOLEAN','TEXT')),
  min_value FLOAT,
  max_value FLOAT,
  categories JSONB,  -- ['excellent','good','poor']
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, name)
);

-- 스코어 테이블에 string value 추가 (categorical/boolean/text용)
ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS score_value_string TEXT,
  ADD COLUMN IF NOT EXISTS score_config_id UUID REFERENCES score_configs(id);

ALTER TABLE human_evals
  ADD COLUMN IF NOT EXISTS score_value_string TEXT,
  ADD COLUMN IF NOT EXISTS score_config_id UUID REFERENCES score_configs(id);

-- RLS
ALTER TABLE score_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY score_configs_select ON score_configs
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY score_configs_write ON score_configs
  FOR ALL USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- 기본 NUMERIC 0..1 config (모든 org에 자동 생성)
INSERT INTO score_configs (organization_id, name, description, data_type, min_value, max_value)
SELECT id, 'default_numeric', 'Default 0..1 numeric scale', 'NUMERIC', 0, 1
FROM organizations
ON CONFLICT DO NOTHING;
```

#### API
**파일**: `apps/server/src/api/scoreConfigs.ts` (신규)

엔드포인트:
- `GET /api/v1/score-configs`
- `POST /api/v1/score-configs`
- `PATCH /api/v1/score-configs/:id`
- `DELETE /api/v1/score-configs/:id` (archive)

**파일**: `apps/server/src/api/human-evals.ts` 수정
- POST 시 `score_config_id` 받기
- 응답에 config 포함

#### Lib
**파일**: `apps/server/src/lib/score-validation.ts` (신규)

```typescript
export function validateScoreValue(
  config: ScoreConfig,
  numericValue?: number,
  stringValue?: string,
): { ok: boolean; error?: string }
```

#### UI
**파일**: `apps/web/app/(dashboard)/settings/score-configs/page.tsx` (신규)
- ScoreConfig CRUD

**파일**: `apps/web/app/(dashboard)/feedback/feedback-client.tsx` 수정
- ScoreConfig 선택 드롭다운
- 타입별 입력 위젯:
  - NUMERIC → 슬라이더
  - CATEGORICAL → 라디오
  - BOOLEAN → 토글
  - TEXT → textarea

**파일**: `apps/web/components/charts/CategoricalDistribution.tsx` (신규)
- 카테고리별 막대 차트 (recharts)

#### 집계 쿼리
**파일**: `apps/server/src/lib/stats-queries.ts` 수정

`getScoreStats()` 함수에 data_type 분기 추가:
- NUMERIC: AVG, P50, P95
- CATEGORICAL: COUNT GROUP BY value
- BOOLEAN: pass rate
- TEXT: count + sample

### 작업 단계
- [ ] (1d) 마이그레이션 + 기본 config 시드
- [ ] (1d) `scoreConfigs.ts` 라우터 + 검증 lib
- [ ] (1d) human-evals 라우터 수정 + eval-runner.ts 수정
- [ ] (1d) ScoreConfig 설정 페이지
- [ ] (1d) Feedback 페이지 입력 위젯 분기
- [ ] (1d) 카테고리 분포 차트 + 대시보드 통합
- [ ] (0.5d) 마이그레이션 테스트 (기존 score_value_string null 안전)

### 검증
- 기존 numeric score는 변함없이 작동 (backward compat)
- 새 CATEGORICAL config 생성 → 라디오 입력 → DB에 string 저장
- BOOLEAN 통계: pass rate 계산 정확
- 평가 페이지에서 categorical 결과 분포 차트 표시

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| 기존 코드가 `score` 컬럼만 쓰는 곳 누락 | grep으로 `.score` 검색, 전부 score_value_string 폴백 추가 |
| ClickHouse `requests`에는 score 컬럼 없어서 영향 없음 | 확인됨 |
| eval-runner LLM 응답 파싱이 numeric 가정 | 타입별 파서 분기 |

### 의존성
- 4A.5 (기본 템플릿)에 score_data_type 컬럼 추가했음 — 일관성 유지

### 작업량
**6-7일**

---

## 4B.2 평가 실행에 OTel 스팬 (Dogfooding)

### 목표
평가 실행 자체를 Spanlens trace로 기록. 디버깅 + 마케팅 ("우리도 우리 걸로 관측함").

### 현재 상태
- `apps/server/src/lib/eval-runner.ts`: LLM 호출 시 자체 트레이싱 없음
- `apps/server/src/lib/experiment-runner.ts`: 동일

### 변경 사항

#### 자체 SDK 통합
**파일**: `apps/server/src/lib/internal-tracing.ts` (신규)

```typescript
import { SpanlensClient } from '@spanlens/sdk'

// 자체 호스트 키 사용 (별도 internal project)
const internalClient = new SpanlensClient({
  apiKey: process.env.SPANLENS_INTERNAL_API_KEY!,
  baseUrl: process.env.SPANLENS_INTERNAL_BASE_URL ?? 'http://localhost:3001',
})

export async function traceInternal<T>(
  name: string,
  metadata: Record<string, unknown>,
  fn: (trace: TraceHandle) => Promise<T>,
): Promise<T> {
  const trace = internalClient.startTrace(name, { metadata })
  try {
    const result = await fn(trace)
    await trace.end({ status: 'completed' })
    return result
  } catch (err) {
    await trace.end({
      status: 'error',
      error_message: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
```

#### eval-runner.ts 통합
```typescript
export async function runEvalJob(jobId: string) {
  return traceInternal('eval_job', { jobId }, async (trace) => {
    const span1 = trace.span({ name: 'fetch_samples', spanType: 'retrieval' })
    const samples = await fetchSamples(...)
    await span1.end({ output: { count: samples.length } })

    for (const sample of samples) {
      const span2 = trace.span({ name: 'llm_judge', spanType: 'llm' })
      const result = await callJudgeLLM(...)
      await span2.end({
        prompt_tokens: ...,
        completion_tokens: ...,
        cost_usd: ...,
      })
    }

    return result
  })
}
```

#### experiment-runner.ts 동일 패턴

#### 환경 변수
- `SPANLENS_INTERNAL_API_KEY`: 별도 internal project의 sl_live_*
- `SPANLENS_INTERNAL_BASE_URL`: 보통 자기 자신 (localhost or production URL)

#### 별도 internal Project 생성
한 번만:
- Spanlens 대시보드에서 "spanlens-internal" project 생성
- API key 발급 → Vercel env에 등록

### 작업 단계
- [ ] (0.5d) `internal-tracing.ts` + 환경 변수 통합
- [ ] (0.5d) eval-runner.ts에 traceInternal 통합
- [ ] (0.5d) experiment-runner.ts 통합
- [ ] (0.5d) playground-runner.ts 통합 (옵션)
- [ ] (0.5d) 자체 trace 표시 검증

### 검증
- 평가 실행 → /traces 페이지에서 "eval_job" trace 노출
- 각 sample에 대해 llm_judge span 표시
- 비용/latency 시각화

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| 무한 재귀 (eval이 trace 만들고 trace가 eval 트리거) | internal project에는 평가 자동화 disable |
| 자기 자신 호출 latency 폭증 | SDK는 fire-and-forget이라 user code 블록 안 됨 |
| 토큰 비용 ↑ | 자체 사용분이라 marginal cost 거의 없음 (자기 LLM 키 안 씀) |

### 의존성
- SDK `@spanlens/sdk` 동작 검증 끝나 있어야 함 (이미 v0.6.1)

### 작업량
**2-3일**

---

## 4B.3 백그라운드 마이그레이션 프레임워크

### 목표
장시간 데이터 마이그레이션 (예: ClickHouse 백필) 안전하게 실행. Phase 5의 `events` 스키마 도입 전제조건.

### 현재 상태
- `deploy-server.yml`: `supabase db push --linked` → Vercel deploy 직렬화
- 30분+ 마이그레이션은 CI timeout
- 컬럼 backfill, ClickHouse 데이터 재처리 같은 일회성 잡 자동화 없음

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260625000000_background_migrations.sql`

```sql
CREATE TABLE IF NOT EXISTS background_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,  -- 'backfill_events_from_requests_2026_07'
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')) DEFAULT 'pending',
  state JSONB NOT NULL DEFAULT '{}',  -- 진행 상태 (last_processed_id 등)
  worker_id TEXT,  -- 현재 lock 보유 worker
  lock_acquired_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS background_migrations_status_idx
  ON background_migrations (status, last_heartbeat_at);
```

#### 프레임워크 인터페이스
**파일**: `apps/server/src/lib/background-migrations/index.ts` (신규)

```typescript
export interface IBackgroundMigration {
  name: string
  validate(): Promise<{ ok: boolean; reason?: string }>
  run(state: any, ctx: MigrationContext): Promise<{
    done: boolean
    state: any
    progress?: { current: number; total: number }
  }>
}

export interface MigrationContext {
  heartbeat: () => Promise<void>
  log: (msg: string) => void
  abortSignal: AbortSignal
}
```

#### Runner
**파일**: `apps/server/src/lib/background-migrations/runner.ts`

```typescript
const HEARTBEAT_INTERVAL_MS = 15_000
const LOCK_TIMEOUT_MS = 60_000  // 4 heartbeat 누락 시 stale

export async function runMigration(name: string) {
  // 1. PG advisory lock 시도
  const workerId = `${process.env.VERCEL_REGION ?? 'local'}-${process.pid}-${Date.now()}`
  const lockKey = hashName(name)

  const { data: locked } = await supabaseAdmin.rpc('pg_try_advisory_lock', { key: lockKey })
  if (!locked) throw new Error('LOCK_BUSY')

  try {
    // 2. status = running, worker_id 기록
    await supabaseAdmin.from('background_migrations')
      .update({ status: 'running', worker_id: workerId, started_at: new Date().toISOString() })
      .eq('name', name)

    // 3. heartbeat interval 시작
    const heartbeatTimer = setInterval(async () => {
      await supabaseAdmin.from('background_migrations')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('name', name)
    }, HEARTBEAT_INTERVAL_MS)

    // 4. migration 실행 (chunked)
    const migration = await loadMigration(name)
    let state = (await supabaseAdmin.from('background_migrations').select('state').eq('name', name).single()).data.state
    let done = false

    while (!done) {
      const result = await migration.run(state, ctx)
      state = result.state
      done = result.done
      // 매 chunk마다 state 저장
      await supabaseAdmin.from('background_migrations')
        .update({ state }).eq('name', name)
    }

    clearInterval(heartbeatTimer)
    await supabaseAdmin.from('background_migrations')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('name', name)

  } catch (err) {
    await supabaseAdmin.from('background_migrations')
      .update({ status: 'failed', error_message: String(err) })
      .eq('name', name)
    throw err
  } finally {
    await supabaseAdmin.rpc('pg_advisory_unlock', { key: lockKey })
  }
}
```

#### Cron
**파일**: `apps/server/src/api/cron.ts`

```typescript
app.post('/cron/run-background-migrations', requireCronSecret, async (c) => {
  const { data: pending } = await supabaseAdmin
    .from('background_migrations')
    .select('name')
    .eq('status', 'pending')
    .limit(1)

  if (!pending?.length) return c.json({ noWork: true })

  // 또는 stale running (4 heartbeat 누락) 복구
  const staleCutoff = new Date(Date.now() - 60_000).toISOString()
  await supabaseAdmin
    .from('background_migrations')
    .update({ status: 'pending' })
    .eq('status', 'running')
    .lt('last_heartbeat_at', staleCutoff)

  // fire-and-forget으로 시작 (Vercel 함수는 backgroud 5분 한계)
  fireAndForget(c, runMigration(pending[0].name))

  return c.json({ started: pending[0].name })
})
```

`vercel.json`:
```json
{ "path": "/cron/run-background-migrations", "schedule": "*/5 * * * *" }
```

**중요 제한:** Vercel 함수 maxDuration 300s. 즉 한 번 cron 실행에서 5분만 작업 가능. migration은 **chunked** 설계 필수 (한 chunk = 4분 이내, state 저장 → 다음 cron이 이어받음).

#### Admin UI
**파일**: `apps/web/app/(dashboard)/settings/background-migrations/page.tsx`

- pending/running/completed/failed 마이그레이션 목록
- 진행률 (progress.current / progress.total)
- 수동 트리거 / 취소 버튼 (admin only)

#### 마이그레이션 정의 폴더
**파일**: `apps/server/src/lib/background-migrations/registry/`

```
registry/
├── index.ts  ← name → migration 매핑
├── backfillEventsFromRequests.ts  ← Phase 5에서 추가
└── ...
```

### 작업 단계
- [ ] (1d) DB 마이그레이션 + RPC 함수 (pg_try_advisory_lock 래퍼)
- [ ] (1-2d) 프레임워크 인터페이스 + runner + heartbeat
- [ ] (1d) Cron 핸들러 + stale 복구
- [ ] (1d) 첫 테스트 마이그레이션 ("no-op" 또는 작은 backfill)
- [ ] (1d) Admin UI
- [ ] (0.5d) 문서: 새 마이그레이션 작성 가이드

### 검증
- 테스트 마이그레이션 등록 → cron 5분 후 자동 시작
- 중간에 Vercel 함수 timeout → 다음 cron에서 state 이어받기
- 동시에 같은 마이그레이션 2번 실행 시도 → advisory lock으로 1번만
- stale running (15초 heartbeat 4번 누락) → 다음 cron에서 pending 복구

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| Vercel maxDuration 300s에 chunk가 안 끝남 | chunk size를 4분 이내로 조정 (LIMIT 동적) |
| 같은 cron 호출에서 마이그레이션 2개 시작 | cron 핸들러는 1개만 시작 (위 코드처럼) |
| Supabase advisory lock이 connection 종료 시 풀림 | fire-and-forget 안에서 lock 유지, finally에서 명시 unlock |
| Cron schedule 5분이라 reaction 느림 | 수동 트리거 API도 같이 제공 |

### 의존성
- Phase 5.1 (events 스키마)가 이거 없이는 못 함

### 작업량
**5-7일**

---

# Phase 5 — 전략적 (6-8주, 3개 항목)

## 5.1 `events` 통합 스키마 (ClickHouse)

### 목표
ClickHouse `events` 테이블로 traces/spans/requests 통합. trace 시각화 깊이 + Map 컬럼으로 새 토큰 종류 무마이그레이션 + 실험 쿼리 단순화.

### 현재 상태
- Postgres: `traces`, `spans` (관계형 + 작음, 수만 row)
- ClickHouse: `requests` (대용량, 평면 22컬럼)
- cross-join 필요한 쿼리 많음

### 설계 결정

**옵션 A: 완전 대체 (Langfuse 패턴)**
- ClickHouse events 테이블 하나로 통합
- Postgres traces/spans deprecate
- 기존 모든 쿼리 재작성

**옵션 B: 점진적 (권장)**
- ClickHouse events 추가 (신규)
- requests + spans를 events에 dual-write 6개월
- 검증 후 reading switch
- 안정화 후 Postgres deprecate

**권장: B**. 리스크 ↓, 롤백 가능.

### 변경 사항

#### ClickHouse 마이그레이션
**파일**: `clickhouse/migrations/004_create_events.sql`

```sql
CREATE TABLE IF NOT EXISTS events (
  -- 식별자
  id UUID,
  organization_id UUID,
  project_id UUID,
  trace_id UUID,
  span_id UUID,
  parent_span_id Nullable(UUID),

  -- trace 정보 (denormalized, 모든 span에 복사)
  trace_name LowCardinality(String),
  trace_status LowCardinality(String),  -- running | completed | error
  trace_metadata String CODEC(ZSTD(3)),  -- JSON

  -- span 정보
  span_name LowCardinality(String),
  span_type LowCardinality(String),  -- llm | tool | retrieval | embedding | custom
  span_status LowCardinality(String),
  span_level LowCardinality(String),  -- DEBUG | DEFAULT | WARNING | ERROR
  span_metadata String CODEC(ZSTD(3)),

  -- 시간
  start_time DateTime64(3, 'UTC'),
  end_time Nullable(DateTime64(3, 'UTC')),
  latency_ms UInt32 DEFAULT 0,
  time_to_first_token Nullable(UInt32),

  -- LLM 메타 (llm span만)
  provider LowCardinality(String) DEFAULT '',
  model LowCardinality(String) DEFAULT '',
  prompt_version_id Nullable(UUID),
  prompt_name LowCardinality(String) DEFAULT '',
  prompt_version UInt32 DEFAULT 0,

  -- 사용량/비용 (Map 유연성)
  usage_details Map(String, UInt32) DEFAULT map(),  -- {input, output, cache_read, cache_write}
  cost_details Map(String, Decimal(18,8)) DEFAULT map(),  -- {input, output, total}
  total_tokens UInt32 DEFAULT 0,
  total_cost_usd Nullable(Decimal(18,8)),

  -- 도구
  tool_definitions Map(String, String) DEFAULT map(),
  tool_calls String CODEC(ZSTD(3)) DEFAULT '',
  tool_call_names Array(LowCardinality(String)) DEFAULT [],

  -- 입출력
  input String CODEC(ZSTD(3)) DEFAULT '',
  output String CODEC(ZSTD(3)) DEFAULT '',

  -- 사용자/세션
  user_id Nullable(String),
  session_id Nullable(String),
  environment LowCardinality(String) DEFAULT 'production',
  release LowCardinality(String) DEFAULT '',
  tags Array(LowCardinality(String)) DEFAULT [],

  -- 실험
  experiment_id Nullable(UUID),
  experiment_name LowCardinality(String) DEFAULT '',

  -- 스코어
  scores_avg Map(String, Float64) DEFAULT map(),
  score_categories Map(String, String) DEFAULT map(),

  -- 보안
  has_security_flags Bool DEFAULT false,
  security_flags Array(LowCardinality(String)) DEFAULT [],

  -- 시스템
  status_code UInt16 DEFAULT 0,
  error_message Nullable(String),
  truncated UInt8 DEFAULT 0,
  service_tier LowCardinality(String) DEFAULT '',
  proxy_overhead_ms Nullable(UInt32),

  created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(start_time)
ORDER BY (organization_id, project_id, trace_id, start_time, span_id)
TTL toDateTime(start_time) + INTERVAL 365 DAY;
```

핵심 결정:
- `ORDER BY (org, project, trace_id, time, span_id)` — 한 trace의 모든 span이 인접 → 시각화 빠름
- `usage_details Map` — 새 토큰 종류 추가 시 마이그레이션 불필요
- `scores_avg Map` — 여러 평가자 점수 집계
- `tags Array` — 검색 가능

#### Dual-Write
**파일**: `apps/server/src/lib/logger.ts` 수정

기존 `logRequestAsync()` 옆에 `logEventAsync()` 추가:
```typescript
export async function logEventAsync(event: EventRecord) {
  await getClickhouse().insert({
    table: 'events',
    values: [event],
    format: 'JSONEachRow',
  })
}
```

프록시 핸들러 (openai.ts 등)에서:
```typescript
// 기존 requests INSERT 유지
fireAndForget(c, logRequestAsync(requestRecord))

// 추가: events INSERT (같은 데이터 + span 정보)
fireAndForget(c, logEventAsync({
  ...,
  span_type: 'llm',
  span_name: model,
  trace_id: trace_id ?? span_id,  // 표준 trace가 없으면 self-trace
}))
```

Ingest API (`api/ingest.ts`)에서도 trace/span 생성/업데이트 시 events에 동시 쓰기.

#### Reading Switch
6개월 dual-write 후, 새 쿼리 헬퍼 추가:

**파일**: `apps/server/src/lib/events-query.ts` (신규)
```typescript
export function eventsScope(orgId: string, options?: { ignoreRetention?: boolean })
export async function selectEvents<T>(...) // SELECT FROM events
export async function countEvents(...)
```

대시보드 페이지 하나씩 마이그레이션 (feature flag `USE_EVENTS_TABLE`).

#### Backfill
백그라운드 마이그레이션 (Phase 4B.3 의존):

**파일**: `apps/server/src/lib/background-migrations/registry/backfillEventsFromRequests.ts`
- requests + traces + spans → events 변환
- chunk size: 50,000 row, ~3분
- 진행 상황 `state.last_created_at`

### 작업 단계
- [ ] (1d) ClickHouse 마이그레이션 + 로컬 테스트
- [ ] (2d) `logEventAsync` + 프록시 통합 + ingest 통합
- [ ] (2d) `events-query.ts` 헬퍼 + 기존 패턴 미러
- [ ] (3d) 백필 마이그레이션 작성 + 로컬 검증 (1M row 모의 데이터)
- [ ] (1주) 대시보드 페이지별 reading switch (feature flag)
- [ ] (1주) production dual-write 안정화 + dashboard 검증
- [ ] (3d) Postgres traces/spans deprecate 결정 (이건 나중)

### 검증
- dual-write 후: `requests` row 수 ≈ `events` row 수 (LLM span만 count)
- trace 시각화: events의 ORDER BY로 한 trace 모든 span 한 쿼리에 가져옴
- 새 토큰 종류 추가 (예: `vision_input_tokens`) — Map에 자동 들어감

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| dual-write 비용 (CH INSERT 2배) | CH는 INSERT 저렴, latency 영향 없음 (fire-and-forget) |
| 백필 중 dual-write가 새 row 만들어 충돌 | events 테이블에 UNIQUE 없음 (CH 특성), dedup은 reading 시 |
| 6개월 dual-write 비용 | 디스크 +30% (events는 압축 잘됨), 가치 충분 |
| 스키마가 너무 큰 row → ZSTD도 안 도움 | input/output 외 대형 필드 없음 |

### 의존성
- 4B.3 (백그라운드 마이그레이션) 필수
- 5.2 (Code Eval) — events에 eval span 자동 기록

### 작업량
**3-4주** (코드 1-2주 + 안정화 1-2주)

---

## 5.2 Code Eval 샌드박스

### 목표
JavaScript/Python 코드 기반 평가 (LLM 안 씀). deterministic 평가 + 비용 절약.

### 현재 상태
- `apps/server/src/lib/eval-runner.ts`: LLM-as-judge만

### 설계 결정

**옵션 A: vm2 (in-process)** — 빠르지만 escape vulnerabilities
**옵션 B: AWS Lambda** — 안전하지만 운영 부담
**옵션 C: Vercel Sandbox (베타)** — 안전 + Vercel 통합, 다만 베타
**옵션 D: Fly Machines / Cloudflare Workers** — 외부 의존

**권장: C → B fallback**. Vercel Sandbox GA 되면 즉시 전환, 그전엔 Lambda. vm2는 피함.

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260715000000_code_evaluators.sql`

```sql
ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'llm_judge'
    CHECK (type IN ('llm_judge', 'code')),
  ADD COLUMN IF NOT EXISTS code_language TEXT
    CHECK (code_language IN ('javascript', 'python')),
  ADD COLUMN IF NOT EXISTS code_body TEXT,  -- 사용자 코드
  ADD COLUMN IF NOT EXISTS code_timeout_ms INT DEFAULT 5000;
```

#### Lambda 함수 배포
**파일**: `infra/lambda/code-eval-runner/index.js` (신규 디렉토리)

```javascript
// AWS Lambda 핸들러
exports.handler = async (event) => {
  const { language, code, input, output, metadata } = event

  if (language === 'javascript') {
    // isolated-vm 또는 worker_threads로 격리
    const result = await runJavaScript(code, { input, output, metadata })
    return { score: result.score, reason: result.reason }
  }

  if (language === 'python') {
    // child_process.spawn python3, stdin으로 코드/데이터 전달
    const result = await runPython(code, { input, output, metadata })
    return { score: result.score, reason: result.reason }
  }
}
```

- 메모리: 256MB
- timeout: 10s (사용자 5s + 마진)
- 함수 격리: 함수당 fresh container

#### Server 통합
**파일**: `apps/server/src/lib/code-eval-dispatcher.ts` (신규)

```typescript
export async function dispatchCodeEval(opts: {
  language: 'javascript' | 'python'
  code: string
  input: any
  output: any
  metadata?: any
  timeoutMs: number
}): Promise<{ score: number | null; reason?: string; error?: string }>
```

내부 분기:
- `LANGFUSE_CODE_EVAL_DISPATCHER=vercel-sandbox` (Vercel Sandbox GA 시)
- `LANGFUSE_CODE_EVAL_DISPATCHER=aws-lambda` (기본)
- `LANGFUSE_CODE_EVAL_DISPATCHER=insecure-local` (개발 only, vm2)

#### eval-runner.ts 수정
```typescript
if (evaluator.type === 'code') {
  result = await dispatchCodeEval({
    language: evaluator.code_language,
    code: evaluator.code_body,
    input, output, metadata,
    timeoutMs: evaluator.code_timeout_ms,
  })
} else {
  // 기존 LLM-as-judge
}
```

#### UI
**파일**: `apps/web/app/(dashboard)/evals/components/CodeEvaluatorForm.tsx` (신규)

- 언어 선택 (JS/Python)
- CodeMirror 에디터
- 예제 input/output 미리보기
- "Test Run" 버튼 → 샘플 데이터로 즉시 실행
- timeout 슬라이더 (1-10s)

#### 인터페이스 규약
사용자 코드는 다음 형식 반환:
```javascript
// JavaScript
function evaluate(input, output, metadata) {
  // input.length, output.tokens 등 접근 가능
  return {
    score: 0.8,  // 0..1 or null
    reason: 'Response is concise',
  }
}
```

```python
# Python
def evaluate(input, output, metadata):
    return {
        'score': 0.8,
        'reason': 'Response is concise',
    }
```

#### 보안
- 네트워크 접근 금지 (Lambda VPC + 외부 SG block)
- 파일시스템 read-only (Lambda 기본)
- 환경 변수 접근 차단
- 메모리 256MB 한도
- 코드 길이 10KB 제한
- 위험 패턴 사전 검사 (eval, Function, import os/subprocess 등)

### 작업 단계
- [ ] (2d) Lambda 함수 작성 + 배포 자동화 (Terraform 또는 SAM)
- [ ] (1d) DB 마이그레이션
- [ ] (2d) `code-eval-dispatcher.ts` + 3개 dispatcher 구현
- [ ] (1d) eval-runner.ts 통합
- [ ] (2d) UI (에디터 + Test Run)
- [ ] (1d) 보안 검토 + 위험 패턴 검사기
- [ ] (1d) 문서 + 예제 (도입 가이드)

### 검증
- 간단한 평가 ("output 길이가 100자 이상이면 1, 아니면 0")
- timeout 동작 (무한 루프 → 5s 후 강제 중단)
- 위험 패턴 차단 (`require('fs')` → 거부)
- Vercel/Lambda dispatcher 둘 다 동작

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| Lambda 콜드 스타트 latency | provisioned concurrency 또는 dispatch 시점에 warm-up call |
| isolated-vm vulnerabilities | Lambda 격리 자체로 충분 (사용자 코드 escape → Lambda container까지만) |
| 사용자 코드가 LLM 호출 | 외부 네트워크 차단, 시도 시 timeout |
| Python 런타임 추가 비용 | 첫 release는 JS만, Python은 phase 2 |
| 사용자가 키 같은 secrets export 시도 | 환경 변수 차단 + Lambda execution role 최소 권한 |

### 의존성
- Vercel Sandbox GA 시기에 따라 (현재 베타)
- AWS 계정 + Lambda + 모니터링 (CloudWatch)

### 작업량
**2-3주**

---

## 5.3 3-Stage Ingestion + S3 캐시

### 목표
SDK trace/span POST 페일오버 강화 + 스키마 변경 후 과거 이벤트 재처리 가능.

### 현재 상태
- `apps/server/src/lib/logger.ts`: 직접 ClickHouse INSERT, 실패 시 `requests_fallback` (Supabase jsonb)
- 7일/100회 retry 후 만료

### 범위
**중요**: 프록시 path엔 S3 stage 추가 No-Go (latency 민감). **ingest path (/ingest/traces, spans)만** 적용.

### 설계

```
POST /ingest/traces/...
  ↓ authApiKey
  ↓ S3에 batch 업로드 (JSONL, gzip)
  ↓ Redis 큐 enqueue (s3_key, attempt=0)
  ↓ 즉시 200 응답 (event IDs 반환)

Worker (별도 큐 컨슈머):
  ↓ Redis 큐 pull
  ↓ S3에서 다운로드
  ↓ 처리 + ClickHouse INSERT
  ↓ 성공: ack
  ↓ 실패: attempt++, 지수 백오프 재큐
```

### 변경 사항

#### Worker 분리 결정
Vercel cron으론 throughput 부족. **별도 worker 컨테이너 필요.**

**옵션 A: 새 Vercel function (cron 1분)** — 처리량 낮음 (300s × 60 = 5h/일 처리)
**옵션 B: Fly.io / Railway worker** — 24/7 가동, $10-30/월
**옵션 C: GitHub Actions cron** — 무료, 5분 interval, 6시간 timeout

**권장: B (Fly.io)** — 가장 안정. C는 backup.

#### S3 / R2 설정
- R2 (Cloudflare) 권장 — egress 무료, 한국 latency 양호
- 버킷: `spanlens-ingest-cache`
- TTL: 30일
- 키 포맷: `org/<orgId>/yyyy/mm/dd/<uuid>.jsonl.gz`

#### Server 측 변경
**파일**: `apps/server/src/api/ingest.ts`

```typescript
app.post('/ingest/traces', authApiKey, requireFullScope, async (c) => {
  const body = await c.req.json()

  // 1. S3 업로드
  const s3Key = await uploadIngestBatchToS3({
    organizationId: c.get('organizationId'),
    batch: body,
  })

  // 2. Redis 큐 enqueue
  await ingestionQueue.enqueue({ s3Key, attempt: 0 })

  // 3. 즉시 응답
  return c.json({ accepted: true, batchSize: body.length }, 207)
})
```

**파일**: `apps/server/src/lib/ingest-queue.ts` (신규)
- Upstash Redis list 기반 큐 또는 SQS
- enqueue(item), dequeue(count), ack(id)

#### Worker
**별도 레포 또는 `apps/worker/`** 신규:

```
apps/worker/
├── src/
│   ├── index.ts  ← 메인 루프 (Redis pull)
│   ├── processBatch.ts  ← S3 다운로드 + ClickHouse INSERT
│   └── retry.ts
├── Dockerfile
└── fly.toml
```

```typescript
// src/index.ts
while (true) {
  const item = await ingestionQueue.dequeue()
  if (!item) {
    await sleep(1000)
    continue
  }

  try {
    const batch = await downloadFromS3(item.s3Key)
    await processBatch(batch)  // 기존 logger.ts 로직 호출
    await ingestionQueue.ack(item.id)
  } catch (err) {
    if (item.attempt < 5) {
      const delayMs = Math.min(60_000, 1000 * Math.pow(2, item.attempt))
      await ingestionQueue.enqueueWithDelay({ ...item, attempt: item.attempt + 1 }, delayMs)
    } else {
      // dead letter
      await ingestionQueue.deadLetter(item)
    }
  }
}
```

#### Fly.io 배포
**파일**: `apps/worker/fly.toml`

```toml
app = "spanlens-worker"
primary_region = "icn"

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 8080  # health check
  protocol = "tcp"

[deploy]
  strategy = "rolling"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

- 비용: ~$5/월 (shared 1 CPU, 512MB)
- Region: icn (서울)
- Health check: `/healthz` (워커가 큐 polling 살아있는지)

#### 모니터링
- Sentry: worker 에러 captureException
- 메트릭: 큐 길이, dead letter 수, 평균 처리 latency (Sentry custom metrics)

### 작업 단계
- [ ] (2d) S3/R2 설정 + 업로드 헬퍼
- [ ] (2d) Upstash Redis 큐 + enqueue/dequeue/ack
- [ ] (1d) ingest.ts 라우터 수정 (3-stage flow)
- [ ] (3d) Worker 컨테이너 + processBatch 구현
- [ ] (1d) Fly.io 배포 + health check
- [ ] (2d) dead letter UI + 재시도 트리거
- [ ] (3d) 통합 테스트 + production 점진 rollout (feature flag)

### 검증
- Ingest 호출 → S3에 파일 생성 + 큐에 항목 enqueue → 즉시 응답
- worker가 1분 이내에 ClickHouse INSERT 완료
- worker 죽임 → 재시작 후 큐에서 이어받기
- 5회 retry 후 dead letter
- 30일 후 S3 객체 자동 만료

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| 추가 인프라 비용 ($5-15/월) | 가치 충분, MRR 기준 |
| Worker latency (1분+) | SDK는 비동기, end-user latency 영향 없음 |
| S3 비용 (이벤트당 작아도 누적) | R2 사용 + 30일 TTL |
| 기존 `requests_fallback`와 중복 | ingest path만 신규, requests_fallback은 기존 path 유지 |
| Worker 다운 시 큐 누적 | 알림 (Sentry rule: 큐 길이 > 1000) |

### 의존성
- 5.1 (events 스키마)와 같이 가면 시너지 — worker가 events에 쓰기

### 작업량
**3-4주**

---

# 차별화 강화 (병행, 항목별 1-2주)

## D.1 인-라인 PII 자동 마스킹

### 목표
현재 `security-scan.ts`는 플래그만. 실제로 LLM에 보내기 전에 마스킹하는 옵션 추가 → "DLP-as-a-service" 포지션.

### 현재 상태
- `apps/server/src/lib/security-scan.ts`: 6개 PII 정규식 (email, phone, SSN, card, API key, IP) — 감지만
- `lib/pii-mask.ts`: 응답 로깅 시 마스킹 (저장 전)

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260612000000_pii_mask_policy.sql`

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pii_mask_in_request BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pii_mask_in_response BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pii_mask_patterns JSONB NOT NULL DEFAULT '["email","phone","ssn","card"]';
```

#### Proxy 수정
**파일**: `apps/server/src/proxy/openai.ts` (다른 proxy도 동일)

```typescript
const project = await getProject(projectId)

if (project.pii_mask_in_request) {
  body = maskPiiInBody(body, project.pii_mask_patterns)
}

// fetch upstream...

if (project.pii_mask_in_response) {
  responseBody = maskPiiInBody(responseBody, project.pii_mask_patterns)
}
```

#### Lib
**파일**: `apps/server/src/lib/pii-mask-deep.ts` (신규)

기존 `pii-mask.ts`는 표면적 마스킹. 새 deep 마스킹:
- JSON tree 재귀 순회
- 패턴 매치 시 `[EMAIL_REDACTED]` 등으로 교체
- 마스킹된 row 수 카운트 → security_flags에 기록

#### UI
**파일**: `apps/web/app/(dashboard)/security/page.tsx` 또는 settings

- 프로젝트별 토글:
  - "Mask PII in requests (before sending to LLM)"
  - "Mask PII in responses (before storing)"
- 패턴 선택 체크박스 (email/phone/SSN/card/IP)

#### 옵션: 사용자 정의 패턴
**파일**: 동일 마이그레이션에 `pii_custom_patterns JSONB` (정규식 배열)

### 작업 단계
- [ ] (1d) 마이그레이션 + 프로젝트 설정 API
- [ ] (2d) `pii-mask-deep.ts` + proxy 통합
- [ ] (1d) UI 토글
- [ ] (1d) 단위 테스트 (false positive 최소화)
- [ ] (1d) 사용자 정의 패턴 (옵션)

### 검증
- 마스킹 on + email 포함 prompt → LLM에 `[EMAIL_REDACTED]`로 도달
- 마스킹 off → 원본 그대로
- LLM 응답에 PII 포함 → 마스킹 후 저장

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| False positive (예: "MAX_BUFFER_SIZE = 1000"이 IP로 매치) | 정규식 엄격화 + 사용자 정의 비활성 옵션 |
| LLM 응답 품질 저하 (마스킹된 입력으로 추론) | "기본 off" + 명시적 opt-in |
| 마스킹 처리 latency | 짧은 정규식 1-2ms, 영향 미미 |

### 작업량
**4-5일**

---

## D.2 모델 추천 자동 적용

### 목표
현재 추천만 표시. "어드민 승인 시 다음 호출부터 자동 스왑" 기능. PromptGPT/PortKey 영역 점유.

### 현재 상태
- `apps/server/src/lib/model-recommend.ts`: 추천 생성
- `apps/web/app/(dashboard)/savings/`: 표시만
- 사용자가 직접 코드에서 모델 바꿔야 함

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260618000000_model_swap_rules.sql`

```sql
CREATE TABLE IF NOT EXISTS model_swap_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  from_model TEXT NOT NULL,  -- 'gpt-4o'
  to_model TEXT NOT NULL,    -- 'gpt-4o-mini'
  match_provider TEXT NOT NULL,  -- 'openai'
  is_active BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  applied_count INT NOT NULL DEFAULT 0,
  savings_realized_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, from_model)
);
```

#### Proxy 수정
**파일**: `apps/server/src/proxy/openai.ts`

```typescript
const swapRule = await getActiveSwapRule(projectId, requestedModel)
if (swapRule) {
  body.model = swapRule.to_model
  // 응답 헤더에 표시
  c.header('x-spanlens-model-swapped', `${swapRule.from_model}->${swapRule.to_model}`)
  // 카운터 증가 (fire-and-forget)
  fireAndForget(c, incrementSwapCount(swapRule.id))
}
```

#### UI
**파일**: `apps/web/app/(dashboard)/savings/savings-client.tsx` 수정

- 추천 카드 옆에 "Apply rule" 버튼 (admin only)
- 클릭 → 확인 다이얼로그 → rule 활성화
- "Active swap rules" 섹션:
  - 적용 횟수, 실제 절감액 표시
  - "Deactivate" 버튼

### 작업 단계
- [ ] (1d) 마이그레이션
- [ ] (1d) Proxy 통합 + 캐시 (rules는 빈번 조회)
- [ ] (1d) UI: 활성화/비활성화/적용 통계
- [ ] (0.5d) 응답 헤더 SDK 처리 (선택적)
- [ ] (0.5d) Audit log (누가 룰 활성화했는지)

### 검증
- 룰 활성화 → 다음 OpenAI 호출이 `gpt-4o-mini`로 실제 라우팅
- 헤더 `x-spanlens-model-swapped` 응답에 포함
- 적용 횟수 + 절감액 누적

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| 사용자 모르게 모델 바뀜 → 품질 저하 | 명시적 활성화 + 응답 헤더 표시 + audit |
| 적용 시 응답 품질 차이 → 컴플레인 | "Compare A/B" 기능 (rule 적용 전후 평가) — Phase 6 |
| 룰 캐시 stale | 5분 TTL, write 시 invalidate |

### 작업량
**3-4일**

---

## D.3 트래픽 Routing Rules

### 목표
"VIP 사용자는 GPT-4o, 일반은 GPT-4o-mini" 같은 룰 기반 라우팅. AI Gateway 영역 점유.

### 현재 상태
- `prompt-traffic-routing.ts`: prompt A/B만 (50/50 split)
- 사용자/세션 기반 라우팅 없음

### 변경 사항

#### DB 마이그레이션
**파일**: `supabase/migrations/20260625000000_routing_rules.sql`

```sql
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL,  -- {user_id_in: ['vip1'], session_tag: 'premium'}
  action JSONB NOT NULL,  -- {provider: 'openai', model: 'gpt-4o'}
  is_active BOOLEAN NOT NULL DEFAULT true,
  applied_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Conditions DSL
간단 시작 (확장 가능):
```json
{
  "user_id_in": ["vip1", "vip2"],     // x-spanlens-user 헤더 매칭
  "session_id_starts_with": "prem_",  // x-spanlens-session
  "tag_includes": "premium",
  "time_range": { "from": "09:00", "to": "18:00" },
  "percentage": 50                    // 트래픽 %
}
```

#### Proxy 수정
모든 proxy 핸들러에 라우팅 lookup 추가:

```typescript
const rule = await matchRoutingRule(projectId, {
  userId: c.req.header('x-spanlens-user'),
  sessionId: c.req.header('x-spanlens-session'),
  tags: c.req.header('x-spanlens-tags')?.split(','),
})

if (rule) {
  // override provider + model
  body.model = rule.action.model
  if (rule.action.provider !== currentProvider) {
    // cross-provider 라우팅 (예: OpenAI 요청을 Anthropic으로)
    return forwardToOtherProvider(rule.action.provider, body)
  }
}
```

#### UI
**파일**: `apps/web/app/(dashboard)/settings/routing/page.tsx` (신규)

- 룰 목록 (우선순위 정렬, 드래그로 재정렬)
- 룰 생성 폼 (visual builder)
- "Test rule" — 가상 조건으로 어떤 룰이 매치되는지

### 작업 단계
- [ ] (1d) 마이그레이션 + DSL 설계
- [ ] (2d) `matchRoutingRule()` + 인메모리 캐시
- [ ] (2d) Proxy 통합 (4개 proxy + cross-provider 라우팅)
- [ ] (2d) UI: 룰 빌더 + 우선순위 재정렬
- [ ] (1d) 통계 (룰별 적용 횟수)

### 검증
- VIP 유저 호출 → GPT-4o 라우팅
- 일반 유저 → GPT-4o-mini
- 룰 percentage=50 → 절반만 라우팅

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| Cross-provider 라우팅 시 API 호환성 (OpenAI body → Anthropic body) | 변환 레이어 필요 — 1차는 same-provider only |
| 복잡한 conditions 평가 latency | 인메모리 캐시 + 단순 condition만 (jsonpath 같은 거 X) |
| 룰 순서 의도와 다름 | UI에 명확한 우선순위 표시 + 매치 시뮬레이터 |

### 작업량
**1.5-2주**

---

## D.4 공유 링크 SEO 최적화

### 목표
`/share/:token`을 SEO 자산으로. Schema.org markup + sitemap → 백링크 + 트래픽.

### 현재 상태
- `shared_links.indexable` 플래그 있음
- `/share/[token]/page.tsx`에서 meta tag 일부 설정
- sitemap에 share 링크 없음

### 변경 사항

#### Schema.org JSON-LD
**파일**: `apps/web/app/share/[token]/page.tsx` 수정

```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{
  __html: JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `${trace.name} - Spanlens Trace`,
    description: `LLM agent trace observed by Spanlens: ${trace.span_count} spans, ${trace.total_tokens} tokens, $${trace.total_cost}.`,
    author: { '@type': 'Organization', name: trace.organization_name },
    datePublished: trace.created_at,
    publisher: { '@type': 'Organization', name: 'Spanlens', logo: { ... } },
  })
}} />
```

#### Sitemap 통합
**파일**: `apps/web/app/sitemap.ts` 수정

```typescript
const indexableShares = await fetchIndexableShareTokens()  // limit 10000
return [
  ...staticUrls,
  ...indexableShares.map(s => ({
    url: `https://spanlens.io/share/${s.token}`,
    lastModified: s.created_at,
    changeFrequency: 'never',
    priority: 0.5,
  }))
]
```

#### OG 이미지 동적 생성
**파일**: `apps/web/app/share/[token]/opengraph-image.tsx`

Next.js Image Response API:
```tsx
export default async function Image({ params }) {
  const trace = await fetchShare(params.token)
  return new ImageResponse(
    <div style={{...}}>
      <h1>{trace.name}</h1>
      <p>{trace.span_count} spans · {trace.total_tokens} tokens · ${trace.total_cost}</p>
      <img src="https://spanlens.io/logo.svg" />
    </div>
  )
}
```

#### robots.txt 갱신
indexable=true인 공유만 허용:
```
User-agent: *
Allow: /share/
Disallow: /api/
```

#### 메타 태그 강화
- `<meta name="description">` 동적
- `<meta property="og:type" content="article">`
- `<meta property="og:image">` (위 동적 생성)
- `<link rel="canonical">`

### 작업 단계
- [ ] (1d) Schema.org JSON-LD
- [ ] (1d) Sitemap 통합 + 캐시 (1시간)
- [ ] (1d) OG 이미지 동적 생성
- [ ] (1d) robots.txt + meta 강화
- [ ] (0.5d) Google Search Console 등록 + 색인 요청

### 검증
- Google Rich Results Test 통과
- `site:spanlens.io/share` 검색 결과 노출 (3-4주 후)
- OG 이미지 카드 표시 (Twitter Validator + LinkedIn Post Inspector)

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| 인덱스되면 안 되는 trace가 indexable=true로 잘못 설정 | 기본 false + 사용자 명시적 토글 |
| Sitemap 크기 폭증 (수만 trace) | 10000 limit + 우선순위 낮음 |
| OG 이미지 생성 비용 (Next.js 함수) | Vercel cache 1년 |

### 작업량
**4-5일**

---

## D.5 README 배지 라이브 갱신

### 목표
`/badge/:token`을 동적 통계로. "5K requests proxied this month" 같은 라이브 배지 → viral 자산.

### 현재 상태
- `apps/server/src/api/badge.ts`: 정적 SVG (로고만)

### 변경 사항

#### API 수정
**파일**: `apps/server/src/api/badge.ts`

```typescript
app.get('/badge/:token/:metric', async (c) => {
  const token = c.req.param('token')
  const metric = c.req.param('metric')  // 'requests' | 'traces' | 'cost' | 'spans'

  // public share token으로 권한 확인
  const share = await getShareByToken(token)
  if (!share || share.revoked_at) return notFound()

  // 메트릭 캐시 (5분 TTL)
  const value = await getCachedMetric(share.organization_id, metric)

  const svg = renderBadge({
    label: `Spanlens ${metric}`,
    value: formatNumber(value),
    color: '#3b82f6',
  })

  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300')
  return c.body(svg)
})
```

#### 배지 종류
- `/badge/:token/requests` — 이번 달 요청 수
- `/badge/:token/traces` — trace 수
- `/badge/:token/cost` — 절감액 (savings 페이지 연동)
- `/badge/:token/uptime` — proxy uptime %

#### Markdown 스니펫 생성 UI
**파일**: `apps/web/app/(dashboard)/settings/badges/page.tsx` (신규)

- 배지 미리보기
- "Copy markdown" 버튼:
  ```
  [![Spanlens](https://spanlens.io/badge/abc123/requests)](https://spanlens.io/share/abc123)
  ```
- 사용자가 README에 붙여넣기

#### SVG 렌더링
**파일**: `apps/server/src/lib/badge-svg.ts` (신규)

shields.io 스타일 SVG 생성기. 또는 외부 의존 (shields.io의 endpoint badge 활용):
```
https://img.shields.io/endpoint?url=https://api.spanlens.io/badge/abc123/requests.json
```

`badge.ts`가 endpoint badge JSON 반환:
```json
{
  "schemaVersion": 1,
  "label": "spanlens",
  "message": "5,237 requests",
  "color": "blue"
}
```

→ 렌더링은 shields.io에 위임, 우리는 데이터만.

### 작업 단계
- [ ] (0.5d) `badge-svg.ts` 또는 shields.io endpoint JSON 반환
- [ ] (1d) 메트릭 캐시 + 5분 TTL
- [ ] (1d) UI: 배지 종류 선택 + Markdown 복사
- [ ] (0.5d) Rate limit (per-IP 60/min 유지)

### 검증
- GitHub README에 붙여넣기 → 배지 정상 렌더링
- 5분 후 값 갱신
- 토큰 revoke 시 404

### 리스크 & 대응
| 리스크 | 대응 |
|---|---|
| 트래픽 폭증 (인기 OSS 프로젝트 README에 임베드) | Vercel CDN 캐시 + 5분 TTL |
| 메트릭 노출이 경쟁자 분석에 사용됨 | indexable 옵션 분리 + redact 옵션 |
| GitHub README가 이미지 차단 | shields.io 통한 우회 |

### 작업량
**3-4일**

---

# 의존성 그래프

```
Phase 4A (병렬 작업 가능):
  ├── 4A.1 Prompt Redis Cache  ────────────┐
  ├── 4A.2 Soft Delete Queue  ─────────────┤
  ├── 4A.3 Audit Log Viewer  ──────────────┤
  ├── 4A.4 Token Prefix + last_used  ──────┤
  └── 4A.5 Default Eval Templates  ────────┤
                                            │
Phase 4B:                                   ▼
  ├── 4B.1 ScoreConfig 타입화 ◄── 4A.5와 데이터 일관성
  ├── 4B.2 Internal OTel Tracing
  └── 4B.3 Background Migration Framework ──┐
                                            │
Phase 5:                                    ▼
  ├── 5.1 events 통합 스키마 ◄────── 4B.3 필수
  │     ├── dual-write
  │     └── backfill (background migration)
  ├── 5.2 Code Eval Sandbox
  └── 5.3 3-Stage Ingestion ◄─── events 스키마와 시너지

차별화 강화 (Phase 4B 병행):
  ├── D.1 PII Auto-Masking ◄─── security-scan.ts 기반
  ├── D.2 Auto Model Swap ◄─── model-recommend.ts 기반
  ├── D.3 Routing Rules
  ├── D.4 Share SEO
  └── D.5 Live Badges
```

크리티컬 패스: **4B.3 → 5.1**. 다른 건 병렬 가능.

---

# 위험 관리

## 일정 리스크

| 시나리오 | 영향 | 대응 |
|---|---|---|
| Phase 4A가 launch 일정 압박 | launch 연기 또는 일부 항목 후순위 | 4A.3, 4A.4 만 launch 전 필수, 나머지는 +1주 |
| 4B.3 백그라운드 마이그레이션이 어려움 | 5.1 지연 | Vercel cron 한정 사용으로 우회 (chunk 4분 한정) |
| 5.1 dual-write에서 데이터 불일치 발견 | 6개월 지연 | 매주 reconciliation 쿼리 + 알림 |
| 5.2 Vercel Sandbox GA 안 됨 | Lambda 운영 부담 | AWS 비용 $20-50/월 감수 |

## 기술 리스크

| 리스크 | 영향 | 완화 |
|---|---|---|
| Upstash Free 한계 (gotcha #24) | 4A.1 작동 불가 | Pay-as-you-go 전환 ($0.20/100만 cmd) |
| ClickHouse events 테이블 마이그레이션 실수 | 5.1 롤백 | dual-write 6개월 — reading switch가 진짜 마이그레이션 |
| Code eval Lambda escape | 보안 사고 | network 차단 + 최소 IAM + 사후 감사 |
| Worker 분리 시 운영 부담 | 5.3 지연 | Fly.io 자동 deploy + Sentry 알림 |

## 비즈니스 리스크

| 리스크 | 영향 | 완화 |
|---|---|---|
| Helicone/PortKey가 같은 기능 출시 | 차별화 약화 | 차별화 강화 항목 우선 (D.1-D.5) |
| 사용자가 events 스키마 마이그레이션 중 데이터 불일치 보고 | 신뢰 손상 | dual-write 기간엔 항상 requests 테이블이 진실 |
| 추가 인프라 비용 ($30-50/월) | runway 단축 | MRR $500+ 시점에 도입 (5.3은 후순위 가능) |

---

# 부록: 작업 시작 전 체크리스트

각 항목 시작 시 확인:

- [ ] CLAUDE.md의 관련 gotcha 다시 읽음
- [ ] 마이그레이션 파일명이 시간순으로 마지막
- [ ] RLS 정책 작성 시 `is_org_member()` 사용
- [ ] 새 컬럼 NOT NULL + DEFAULT
- [ ] ClickHouse 컬럼 추가는 migration 먼저, INSERT 코드 나중
- [ ] Vercel Edge fire-and-forget은 `fireAndForget(c, ...)` 사용
- [ ] `lib/crypto.ts` 함수 호출 시 await 확인
- [ ] 새 라우터 추가 시 `app.ts` mount 순서 검토 (wildcard 뒤가 아닌지)
- [ ] 새 UI route 추가 시 PermissionGate (role-based)
- [ ] Audit log: 새 mutation 시 `auditLog()` 헬퍼 호출
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 통과
- [ ] PR description에 영향 받는 gotcha 명시 (재발 방지)

---

# 부록: 회고 및 학습 사이클

매 phase 종료 시:
1. **데이터:** 실제 작업량 vs 추정. ±50% 이상 차이 나면 회고
2. **품질:** Sentry 에러율, 사용자 컴플레인 추적
3. **임팩트:** 메트릭 변화 (latency, retention, MRR)
4. **CLAUDE.md 업데이트:** 새 gotcha 발견 시 즉시 추가

---

**다음 액션:** Phase 4A.1 (Prompt Redis Cache) 부터 시작. 이 문서를 Claude에 보여주고 "4A.1 시작" 하면 단독 실행 가능.
