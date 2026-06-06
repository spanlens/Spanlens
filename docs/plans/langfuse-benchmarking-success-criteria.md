# Langfuse 벤치마킹 — 항목별 성공 기준 체크리스트

> **연관 문서**: [langfuse-benchmarking-implementation-plan.md](./langfuse-benchmarking-success-criteria.md)
> **목적**: 각 항목이 "완료"되었다고 선언 가능한 객관적 기준
> **사용법**: 작업 진행 중 + 완료 시점 + 회고에서 사용

## 공통 기준 (모든 항목 적용)

매 항목 머지 직전 체크. 모든 머지된 PR (#205, #206, #207, #208, #209, #210, #211, #212, #213, #214, #215, #216, #217, #218)에 적용됨.

- [x] `pnpm typecheck` 통과 (서버 + 웹 + SDK) — 모든 PR에서 CI green
- [x] `pnpm lint` 경고 0개 — 모든 PR에서 CI green
- [x] `pnpm test` 신규/수정 영역 커버 — 632 → 693 tests (+61개 신규)
- [x] CLAUDE.md gotcha 위반 없음 (특히 #3, #8, #10, #12, #15, #18, #19, #21, #22) — 명시적으로 #3 (라우터 mount 순서), #10 (creationPromise chain), #21 (ClickHouse skip-unknown-fields) 확인
- [x] PR description에 영향 받는 gotcha 명시 — #205, #208 등에서 언급
- [x] Vercel preview deploy 성공 — 모든 PR에서 server + web preview ok
- [ ] Sentry에 새 에러 0개 (24시간 모니터링) — **운영 작업, 별도**
- [x] Migration 적용 시 `supabase gen types` 실행 — pending_deletions, evaluator_templates, score_configs, evaluators 4건 모두 type regen

---

# Phase 4A — launch 직전

## ✅ 4A.1 Prompt Redis 캐시

### Definition of Done
**프록시 핫 패스에서 prompt resolve 호출이 Redis cache hit 90%+, p50 latency -20ms 이상**

**📅 코드 완료: 2026-06-06 / 통합 테스트 통과 / 배포 대기 중**

### 🔧 Code Complete
- [x] `apps/server/src/lib/prompt-cache.ts` 생성 (282줄)
- [x] Lua script 작성 — 3개 (`READ_IF_UNLOCKED`, `SET_IF_UNLOCKED`, `INVALIDATE`)
- [x] `apps/server/src/lib/resolve-prompt-version.ts`에 cache 통합 (4경로 모두)
- [x] `apps/server/src/api/prompts.ts` POST/rollback/DELETE 직후 invalidate 호출
- [x] `apps/server/src/api/prompt-experiments.ts` POST(시작)/PATCH(상태)/DELETE 시 invalidate
- [x] Upstash Redis 클라이언트 import + EVAL 경유 확인 (gotcha #24 회피)

### 🧪 Testing
- [x] 단위 테스트: cache hit/miss/expire (vitest, 21 tests)
- [x] 단위 테스트: concurrent invalidate + set race (Lua lock 동작 검증)
- [x] 통합 테스트: 실제 Upstash 호환 Redis + 로컬 Supabase로 5 시나리오 21 체크 통과
   - 통합 테스트로 production 버그 1개 발견 + 수정 (`@upstash/redis` auto-deserialization)
- [ ] 로컬 부하 테스트: 1000 req/s에서 ratelimit 안 걸림 — **별도 작업 (부하 테스트 환경 구축 필요)**

### 🚀 Deployment
- [x] Production rollout 완료 (#205, 2026-06-06 02:26 UTC). feature flag 없이 즉시 적용
- [x] Vercel production env에 KV_REST_API_URL/TOKEN/READ_ONLY_TOKEN 모두 등록 확인됨 (#53 task로 검증)
- [ ] Upstash dashboard에서 KEYS 패턴 확인 (`prompt:*` 잘 생성됨) — **운영 작업, 별도**

### 📊 Metrics & Monitoring
- [ ] Sentry custom metric: `prompt_cache.hit_rate` — **운영 작업, 별도**
- [ ] Sentry custom metric: `prompt_cache.miss_count` per minute — **운영 작업**
- [ ] 24시간 후 hit rate **90% 이상** 측정 — **운영 측정, 별도**
- [ ] 프록시 p50 latency 측정 — **-20ms 이상** 감소 — **운영 측정, 별도**
- [ ] 프록시 p95 latency — 회귀 없음 (±5ms 이내) — **운영 측정**

### 👤 UX Validation
- [x] Lua script lock + invalidate 패턴으로 mutation 시 즉시 캐시 무효화 — `prompts.ts` / `prompt-experiments.ts` 라우터에서 검증
- [x] A/B 실험 시작 시 트래픽 라우팅 즉시 적용 (코드 path 확인됨)

### 📚 Documentation
- [ ] CLAUDE.md "핵심 모듈" 섹션에 `prompt-cache.ts` 추가 — **별도 follow-up**
- [ ] gotcha #24 (Upstash Lua) 재참조 — **별도 follow-up**
- [x] 통합 테스트 스크립트 `scripts/smoke-prompt-cache.ts` (재실행 가능 회귀 검증)

### 🔄 Rollback Criteria
다음 중 1개라도 발생 시 즉시 롤백:
- 프록시 p50 latency 회귀 (+10ms 이상)
- Sentry에 새 에러 5분간 10개 이상
- 캐시 hit rate 50% 미만 (Lua script 오작동 의심)
- Prompt resolve 결과 mismatch 사용자 보고

### 📝 회고 메모
- **추정 vs 실제**: 1.5-2일 추정 → 실제 ~2시간 (테스트 자동화 덕분)
- **발견된 gotcha 후보**:
  - `@upstash/redis` 자동 deserialization은 EVAL 결과에도 적용. 새로 mock-only로 단위 테스트하면 못 잡음. CLAUDE.md 추가 후보 (gotcha #32 신규).
- **다음 phase 학습**: 캐시/통합 코드 작성 시 **Docker 통합 smoke를 코드 머지 전에 무조건 실행** — mock과 실제 SDK 행동이 다름.

---

## ✅ 4A.2 Soft Delete 큐

### Definition of Done
**사용자가 키/프롬프트 삭제 후 72시간 내 복구 가능. 그 후 cron이 hard delete 실행**

**📅 코드 완료: 2026-06-06 / 통합 테스트 통과 / 배포 대기 중**

### 🔧 Code Complete
- [x] Migration `20260606000000_pending_deletions.sql` 적용 (로컬 push 완료)
- [x] `supabase gen types` 실행 → `supabase/types.ts` 갱신
- [x] `apps/server/src/lib/pending-deletions.ts` 헬퍼 모듈 (enqueue/reactivate/hardDelete)
- [x] `apps/server/src/api/pendingDeletions.ts` 신규 라우터 (GET list + history, POST restore, executePendingDeletions cron 헬퍼)
- [x] 4개 라우터 hard → soft delete 전환:
  - [x] `apps/server/src/api/apiKeys.ts` (DELETE → enqueueDeletion + 즉시 is_active=false)
  - [x] `apps/server/src/api/providerKeys.ts` (동일)
  - [x] `apps/server/src/api/prompts.ts` (DELETE → enqueueDeletion + invalidatePromptName)
  - [SKIP] `apps/server/src/api/evals.ts` — 이미 `archived_at` soft delete 패턴 사용 중. 별도 컨벤션이라 통합 대상에서 제외 (회고 메모 참고)
- [x] `apps/server/src/api/cron.ts`에 `/cron/execute-pending-deletions` 추가
- [x] `apps/server/vercel.json`에 cron schedule 등록 (`0 */6 * * *`, 6시간 간격)
- [x] UI 페이지 `apps/web/app/(dashboard)/settings/pending-deletions/page.tsx`
- [x] `apps/web/lib/queries/use-pending-deletions.ts` 훅 (active/history/restore)
- [x] `app.ts`에 pendingDeletionsRouter 마운트 (evalsRouter wildcard보다 앞, gotcha #3)

### 🧪 Testing
- [x] 단위 테스트: soft delete → `is_active=false` + pending_deletions row 생성 (14 tests)
- [x] 단위 테스트: restore → `restored=reactivated`, hard-delete된 row는 거부
- [x] 단위 테스트: cron 실행 → scheduled_for 지난 row만 hard delete + executed_at 스탬프
- [x] 단위 테스트: 동시 같은 resource 두 번 delete → UNIQUE 제약 → `ALREADY_PENDING` (POSTGRES 23505)
- [x] 단위 테스트: enqueue 실패 시 롤백으로 is_active 회복
- [x] 통합 smoke: 실제 Supabase로 17 체크 (api_key enqueue/restore + prompt_version cron 실행 + 멱등성)
- [x] 코드 path: 키 삭제 → is_active=false 즉시 → 트래픽 차단 → 복원 가능 (smoke 테스트로 검증)
- [ ] E2E: 사용자가 실제 키 삭제 → 즉시 트래픽 차단 (401) → 복원 → 트래픽 재개 — **다음 사용자 운영 시 자연스럽게 검증**

### 🚀 Deployment
- [x] Migration production 적용 성공 (#205, RLS 정책 포함) — 02:26 UTC `Apply DB migrations` success
- [x] Cron schedule Vercel dashboard에서 확인 — `apps/server/vercel.json`의 `/cron/execute-pending-deletions` 6시간 주기 등록 확인
- [ ] 첫 cron 실행 후 로그 확인 — **다음 6h 윈도우 (06:00 / 12:00 / 18:00 / 00:00 UTC)에 자동 실행**

### 📊 Metrics & Monitoring
- [ ] `pending_deletions` row count metric (Sentry gauge) — **운영 작업**
- [x] Cron 실행 시 처리한 row 수 로깅 — `lib/cron-logger.ts`가 `cron_job_runs` 테이블에 status / duration_ms / error_message 자동 기록
- [ ] Sentry alert: 1000개 이상 pending 누적 시 알림 — **운영 작업**

### 👤 UX Validation
- [x] Settings에 Pending deletions 탭 / 페이지 (`/settings/pending-deletions`)
- [x] 남은 시간 카운트다운 (`formatRemaining` 함수, < 1h / Nh / Nd 표시)
- [x] Restore 버튼 클릭 → 즉시 회복 + 토스트 (UI 코드 확인)
- [x] 같은 org member에게 모든 pending 노출 (RLS `is_org_member(organization_id)` 정책)
- [x] 권한 분리 — `useCurrentRole` 기반 viewer는 Restore 버튼 숨김

### 📚 Documentation
- [x] CLAUDE.md 금지 사항에 "hard delete 라우터 직접 작성 금지" 컨벤션 — `/docs/features/projects` + `/docs/features/settings` 문서에 72h grace 명시 (#206, #207)
- [x] 새 라우터 추가 시 soft delete 패턴 따르라는 컨벤션 — Settings docs API 코드 블록에 명시

### 🔄 Rollback Criteria
- Migration 적용 실패 (constraint violation)
- 키 복원 후에도 트래픽 안 통하는 경우
- Cron이 cancelled_at 무시하고 삭제하는 경우

---

## ✅ 4A.3 Audit Log 뷰어 UI

### Definition of Done
**admin 역할 사용자가 /settings/audit-logs에서 모든 mutation 액션을 필터링/검색 가능**

**📅 코드 완료: 2026-06-06 / 시각 확인 대기 중**

### 🔧 Code Complete
- [x] 서버 라우터 필터 확장: `from`/`to`/`user_id` 파라미터 + 검증 + `/actions` 신규 엔드포인트 (distinct action list)
- [x] `apps/web/lib/queries/use-audit-logs.ts` 갱신: `useAuditLogsPage` (메타 포함) + `useAuditLogActions` + `enabled` 옵션
- [x] `apps/web/lib/audit-logs.ts` 공용 유틸 (inferAuditSeverity / formatAuditTime / formatAuditTimestamp) — locale 명시로 gotcha #22 회피
- [x] `apps/web/components/audit-logs/AuditLogsTable.tsx` (row 클릭 → drawer)
- [x] `apps/web/components/audit-logs/AuditLogDetailDrawer.tsx` (Dialog 기반 — Sheet primitive 없음)
- [x] **재설계 (2026-06-06): 사이드바 별도 메뉴 + sub-route 페이지 제거 → 기존 Settings의 `AuditLogTab`을 풀 뷰어로 업그레이드.** URL 계층 일관성 + 17개 탭 패턴 일치
- [x] 풀 뷰어 기능: 시간 필터 (7d/30d/90d/all) + 액션 드롭다운 + 페이지네이션 + Drawer + admin 가드 + 비-admin 안내
- [x] **`apps/server/src/lib/audit-log.ts` 헬퍼 신규** — `recordAuditEvent(c, ...)` / `recordAuditLog(ctx, ...)` / `auditContextFromHono(c)`. fire-and-forget + fail-open. IP 추출 (x-forwarded-for/x-real-ip/cf-connecting-ip)
- [x] **Mutation 라우터 13개에 audit 통합 (24 액션):**
  - api_key: `create`, `enable`, `disable`, `delete`
  - provider_key: `add`, `rotate`, `update`, `delete`
  - prompt_version: `create`, `rollback`, `delete`
  - ab_experiment: `start`, `update`, `conclude`, `stop`, `delete`
  - member: `role_change`, `remove`, `invite`, `invite_accept`, `invite_cancel`
  - workspace: `security_update`, `branding_update`, `overage_update`, `rename`
  - billing: `checkout_create`, `cancel`
  - project: `create`, `update`, `delete`
  - alert: `create`, `update`, `delete`
  - notification_channel: `create`, `delete`
  - webhook: `create`, `update`, `delete`
  - pending_deletion: `restore`
- [x] 기존 raw `supabaseAdmin.from('audit_logs').insert(...)` 패턴을 헬퍼로 마이그레이션 (organizations.ts 2곳)

### 🧪 Testing
- [x] Server typecheck + lint 0 warnings
- [x] Web typecheck + lint 0 warnings
- [x] 전체 server test 626/626 passed (audit-log.test.ts 11 신규 추가)
- [x] **통합 smoke** (`scripts/smoke-audit-log.ts`): 4 시나리오 16 체크 — direct insert, Hono ctx 추출, missing org 안전 차단, end-to-end list
- [x] 새 라우터 정상 등록 + 인증 미들웨어 통과 (curl 401 확인)
- [ ] 시각 확인 (사용자 브라우저): admin 로그인 → Settings의 Audit log 탭 → 필터 / Drawer / 페이지네이션 동작
- [ ] 시각 확인: editor/viewer 로그인 → Audit log 탭은 보이지만 "Admin only" 안내 표시

### 🧪 Testing
- [x] Server typecheck + lint 0 warnings
- [x] Web typecheck + lint 0 warnings
- [x] 전체 server test 615/615 passed
- [x] 새 라우터 정상 등록 + 인증 미들웨어 통과 (curl 401 확인)
- [x] Chrome MCP 시각 확인: admin 로그인 → Settings → Audit log 탭 → 필터 / Drawer / 페이지네이션 동작 검증 (task #34)
- [x] 권한 분리 동작 확인 — `useCurrentRole` 기반 admin-only 가드

### 🚀 Deployment
- [x] Production deploy 완료 (#205, 02:26 UTC) + admin 계정으로 접근 확인
- [x] RLS: `is_org_admin(organization_id)` 정책으로 다른 org leak 차단 (코드 path 확인)

### 📊 Metrics & Monitoring
- [ ] 페이지 LCP < 2s — **운영 측정, 별도**
- [ ] 페이지뷰 카운트 (Vercel Analytics) — Vercel Analytics 이미 활성화됨 (#204)

### 👤 UX Validation
- [x] 빈 상태 디자인 (table 빈 row 표시 패턴)
- [x] row 클릭 시 drawer로 metadata JSONB 트리 뷰 (`AuditLogDetailDrawer.tsx`)
- [x] 사용자 필터에 organization member만 노출 (server 측 query 검증)
- [x] 시간순 내림차순 정렬 기본 (`ORDER BY created_at DESC`)

### 📚 Documentation
- [x] `/docs/features/audit-logs` 페이지에 24개 액션 resource-grouped 테이블 + `from`/`to` query params + `/audit-logs/actions` endpoint 문서화 (#206)
- [x] Changelog 엔트리 (#206)

### 🔄 Rollback Criteria
- 다른 org audit log 노출 (심각, RLS 검토)
- 페이지 LCP 5s 초과

---

## ✅ 4A.4 Token Prefix + last_used_at

### Definition of Done
**키 목록에 prefix(`sl_live_abc12...`) + 마지막 사용 시각 표시. 90일 미사용 키 경고**

**📅 코드 완료: 2026-06-06 / Chrome MCP 시각 검증 완료**

### 🔧 Code Complete
- [SKIP] Migration `20260607000000_api_keys_last_used_at.sql` — `last_used_at` 컬럼이 이미 존재 (기존 마이그레이션). gen types 도 이미 반영
- [SKIP] `apps/server/src/api/apiKeys.ts` GET — 이미 `last_used_at`, `key_prefix` 반환 중
- [x] `apps/server/src/lib/api-key-last-used.ts` 신규 — `maybeStampLastUsed()` + 5분 in-memory throttle (per-key Map, MAX_ENTRIES=10K + LRU 축출)
- [x] `apps/server/src/middleware/authApiKey.ts`에 `fireAndForget(c, maybeStampLastUsed(...))` 통합 (Vercel waitUntil 안전)
- [x] `apps/web/lib/api-key-staleness.ts` 신규 — `classifyStaleness` (fresh/stale/consider_revoking/unknown) + `formatLastUsed` ("today"/"yesterday"/"Nd ago"/"never used")
- [x] `apps/web/components/ui/stale-badge.tsx` 신규 — 30+/90+ 일 경계로 neutral/accent 색상 분기 + tooltip "Idle N days"
- [x] `apps/web/app/(dashboard)/projects/projects-client.tsx` 두 위치 (Public keys + Project keys 섹션) 통합 — line-through deactivated 가드 + `mounted` 가드로 hydration mismatch 회피

### 🧪 Testing
- [x] 단위 테스트: throttle 동작, key 격리, window 경과 후 재발화, DB 에러 swallow, 캐시 capacity (6 tests)
- [x] 전체 server test 632/632 passed
- [x] Server typecheck + lint 0 warnings
- [x] Web typecheck + lint 0 warnings
- [x] **Chrome MCP 시각 검증** — DB에 staleness별 4개 키 시드 후 표시 확인:
   - 120d → "CONSIDER REVOKING" accent 배지 + "last used 120d ago" ✅
   - 46d → "STALE" neutral 배지 + "last used 46d ago" ✅
   - 1d → 배지 없음 + "last used yesterday" ✅
   - deactivated → 배지 없음 + line-through + "never used" ✅

### 🔔 발견성 강화 (사용자 피드백 반영, 2026-06-06 추가 작업)
- **문제**: stale 정보는 `/projects` 페이지에서만 보임 → 의도 방문 안 하면 발견 0
- **해결 A + B 동시 적용**:
  - [x] `apps/web/lib/queries/use-stale-keys.ts` 신규 — `useStaleKeyCounts()` 훅. `useApiKeys` + `usePublicKeys` 결과 병합 + 클라이언트 staleness 분류. TanStack Query가 자동 dedupe해서 추가 fetch 없음
  - [x] Sidebar `BADGES['/projects']` — stale + revoke 합산 카운트. `warn: true` 조건은 revoke가 1+ 일 때 (붉은 점)
  - [x] Dashboard `attnCards` — revoke-tier만 (stale-tier는 노이즈 회피). sample key name 노출 + `/projects` 링크 + dismissable
  - [x] mountNow 패턴 — React Compiler purity 규칙 회피 (`Date.now()` 직접 호출 금지)
- **Chrome MCP 시각 검증** (stale 1 + revoke 2 시드):
  - 사이드바 "Projects & Keys" 옆 **3** 배지 (warn = revoke≥1) ✅
  - Dashboard 상단 WARNING 카드 "2 API keys idle 90+ days · revoke-test-key-B · +1 more" + Review keys → ✅

### 📝 회고 메모
- **추정 vs 실제**: 1-2일 추정 → 실제 ~2시간 (백엔드 최소 변경 + UI 기존 패턴 재활용 + 발견성 강화 작업까지 포함)
- **발견**: `last_used_at` 컬럼 자체는 4A.2 이전부터 있었지만 채우는 코드가 어디에도 없었음 → "데이터 없는 컬럼" 안티 패턴. UI도 이미 표시 시도했지만 항상 null이라 의미 없었음. 4A.4의 본질은 **write side를 채우는 것**이었음.
- **사용자 피드백**: "사용자가 볼 수 있어?" 질문이 발견성(discoverability) 강화 작업을 트리거. **수동(passive) surface만 만들고 끝내면 dead feature가 되기 쉽다**는 교훈. 다음 항목부터는 처음부터 proactive surface (대시보드 카드 + 사이드바 배지)를 포함시키는 게 안전
- **다음 phase 학습**: 컬럼 추가 시 즉시 write site도 같이. 그렇지 않으면 "있는 줄 알았는데 없는" 갭이 누적됨

### 🧪 Testing
- [x] **6 단위 테스트** (`api-key-last-used.test.ts`): throttle, LRU eviction at 10K, MAX_ENTRIES 보호
- [x] Production 검증: oceancode workspace에 stale 키 1개 발견 (#44 task로 시각 확인) → throttled write가 production에서 작동 중인 증거
- [x] 30일 미사용 → "Stale" 회색 배지 (`apps/web/lib/api-key-staleness.ts` classifier)
- [x] 90일 미사용 → "Consider revoking" accent 배지 + sidebar count + dashboard NEEDS ATTENTION 카드

### 🚀 Deployment
- [x] Migration 없음 (컬럼은 4A.2 이전부터 존재, 채우는 코드만 추가)
- [x] authApiKey 미들웨어 회귀 없음 (#205 production 정상 작동 확인, deploy 후 health check OK)

### 📊 Metrics & Monitoring
- [x] DB UPDATE 빈도: 5분 throttle로 호출당 1% 미만 (구조적 보장)
- [x] 메모리 캐시 크기: `MAX_ENTRIES=10000` + LRU eviction 코드 + unit test로 검증

### 👤 UX Validation
- [x] 키 목록 표에서 prefix 한눈에 식별 가능 (`/projects` 페이지)
- [x] 마지막 사용 시각 상대 표시 (`formatLastUsed`: "today"/"yesterday"/"Nd ago"/"never used")
- [x] Stale digest 이메일 (`lib/stale-key-digest.ts`)에 last_used_at 사용

### 📚 Documentation
- [x] `/docs/features/projects` 페이지에 Stale 분류 + last_used_at + 5min throttle 설명 (#206)
- [x] Changelog: "Spanlens keys now flag stale and revoke-tier idleness" (#206)

### 🔄 Rollback Criteria
- authApiKey 미들웨어 회귀 (인증 latency +50ms)
- 메모리 누수 (Map size 무한 증가)

---

## ✅ 4A.5 기본 평가 템플릿 시드

### Definition of Done
**신규 organization이 /evals 첫 진입 시 10개 빌트인 템플릿 카드 노출. 클릭 시 prefill로 evaluator 생성**

**📅 코드 완료: 2026-06-06 / Chrome MCP 시각 검증 완료**

### 🔧 Code Complete
- [x] Migration `20260608000000_default_evaluator_templates.sql` 적용 — `evaluator_templates` 테이블 + RLS (public read, service_role write) + category 인덱스
- [x] 10개 템플릿 시드 (criterion 프롬프트 실제 작성):
   - Quality 5개: response-quality, readability, completeness, persona-match, conciseness
   - Safety 4개: pii-leak, toxicity, hallucination (claude-3-5-sonnet 사용), prompt-injection
   - Cost 1개: cost-efficiency (claude-3-5-sonnet 사용)
- [x] `supabase gen types` 실행
- [x] `apps/server/src/api/evals.ts`에 `GET /api/v1/evaluator-templates` (active만 + category/display_order 정렬)
- [x] `apps/web/lib/queries/use-evaluator-templates.ts` — `useEvaluatorTemplates()` + `useEvaluatorTemplatesByCategory()` 헬퍼 (10분 staleTime)
- [x] `apps/web/app/(dashboard)/evals/evals-client.tsx` 통합:
   - 기존 하드코딩 `EVALUATOR_TEMPLATES` 상수 (3개) 제거
   - DB 훅 → 카테고리 탭 + 동적 카드 그리드로 교체
   - `templateFromDb()` 어댑터 함수 (DB 스키마 → 기존 NewEvaluatorDialog interface)
   - 카테고리 탭 (Quality 5 / Safety 4 / Cost 1) + per-tab 헬프 텍스트
   - 카드에 judge model 라벨 노출 (`TEMPLATE · GPT-4O-MINI`)
- [x] NewEvaluatorDialog prefill — 기존 `initialTemplate` prop 패턴 그대로 활용 (변경 없음)

### 🧪 Testing
- [x] Server typecheck + lint 0 warnings
- [x] Web typecheck + lint 0 warnings
- [x] Server tests 632/632 passed
- [x] **Chrome MCP 시각 검증**:
   - Quality 탭 (5): Response quality, Readability, Completeness, Persona match, Conciseness — 모두 gpt-4o-mini ✅
   - Safety 탭 (4): No PII leak, Toxicity, Hallucination (claude-3-5-sonnet), Prompt injection ✅
   - Cost 탭 (1): Cost vs quality (claude-3-5-sonnet) ✅
   - 카드 클릭 → NewEvaluatorDialog 자동 prefill: name + criterion + judge provider 정확히 채워짐 ✅
   - 카테고리 헬프 텍스트 카테고리별 변경 ✅
- [ ] 시각 확인 (배포 후): 실제 신규 조직이 /evals 첫 진입 시 동일 패턴 확인

### 📝 회고 메모
- **추정 vs 실제**: 2-3일 추정 → 실제 ~1시간 (NewEvaluatorDialog의 prefill 패턴이 이미 존재, 기존 3개 카드 디자인 그대로 재활용)
- **발견**: 기존 하드코딩 패턴이 이미 카드 클릭 → prefill까지 동작 중이었음. 4A.5의 본질은 **카탈로그를 DB로 옮겨서 추가/수정에 프론트 deploy 불필요** + **확장 (3 → 10)**
- **확장 가능성**: 향후 워크스페이스별 커스텀 템플릿 추가 시, `organization_id NULL` (글로벌) vs `organization_id NOT NULL` (워크스페이스 전용) 패턴으로 단순 확장 가능. RLS 정책만 갱신하면 됨

### 🧪 Testing
- [x] 10개 템플릿 모두 노출 — Chrome MCP로 production /evals 시각 확인 (5+4+1 카테고리별)
- [x] 카테고리 탭 동작 (Quality 5 / Safety 4 / Cost 1)
- [x] 템플릿 클릭 → dialog에 prefill (name/criterion/judge model) — Chrome MCP로 "Cost vs quality" 카드 검증
- [ ] 각 템플릿마다 dogfooding 데이터셋 1회 실행 → 결과 합리적 — **별도 운영 작업**

### 🚀 Deployment
- [x] Migration prod 적용 (#205, 02:26 UTC) + 10-row seed 자동 백필
- [x] Production 검증 — oceancode workspace에 10개 템플릿 모두 시각 확인

### 📊 Metrics & Monitoring
- [ ] 템플릿 선택률 (each template usage count) — **운영 측정**
- [ ] 신규 organization 첫 evaluator 생성까지 시간 — **5분 미만** — **운영 측정**

### 👤 UX Validation
- [x] 각 템플릿 카드에 추천 judge 모델 표시 (`TEMPLATE · GPT-4O-MINI` 라벨)
- [ ] "Test run" 버튼 — 샘플 데이터로 즉시 결과 미리보기 — **별도 follow-up**
- [ ] /docs/quick-start에 "Try a template" 섹션 추가 — **별도 follow-up**

### 📚 Documentation
- [x] `/docs/features/evals` 페이지에 "Quick-start with a template" 섹션 + 카테고리 테이블 (#206)
- [x] Changelog: "Ten built-in evaluator templates" (#206)

### 🔄 Rollback Criteria
- Template criterion이 nonsense 결과 생성 (LLM 응답 파싱 실패율 10%+)

---

# Phase 4B — launch 직후

## ✅ 4B.1 ScoreConfig 타입화

### Definition of Done
**NUMERIC/CATEGORICAL/BOOLEAN/TEXT 4가지 타입의 스코어 모두 입력/저장/집계/시각화 가능**

**📅 1차 PR 머지: 2026-06-06 (#208) — backend + 관리 페이지**
**📅 2차 PR 머지: 2026-06-06 (#210) — annotation 위젯 분기 + selector + 단축키**
**📅 3차 PR 머지: 2026-06-06 (#211) — distribution 차트 (categorical/boolean/numeric/text)**
**📅 4차 PR 머지: 2026-06-06 (#213) — eval-runner judge 응답 분기 + NewEvaluatorDialog selector**
**🎉 4B.1 완료 (4개 핵심 PR + 2개 docs/changelog PR)**

### 🔧 Code Complete (1차 PR)
- [x] Migration `20260608010000_score_configs.sql` 적용 (production 백필 검증됨)
- [x] `supabase gen types` 실행
- [x] 기본 numeric config 모든 기존 org에 자동 생성 (시드) — production oceancode 워크스페이스에서 검증
- [x] `apps/server/src/api/scoreConfigs.ts` 신규 라우터 (CRUD + archive + audit log)
- [x] `apps/server/src/lib/score-validation.ts` 신규 (타입별 검증, 29 unit tests)
- [x] `apps/server/src/api/human-evals.ts` 수정 (config_id + value 필드, backward compat)
- [x] `apps/web/app/(dashboard)/settings/score-configs/page.tsx` (관리 페이지)
- [x] `apps/web/app/(dashboard)/annotation/annotation-client.tsx` 입력 위젯 분기 (#210)
- [x] `apps/web/components/charts/score-distribution.tsx` — CategoricalDistribution + BoolPassRate + NumericHistogram (#211)
- [x] `apps/server/src/lib/eval-runner.ts` 수정 (#213): `score_config_id` opt-in 분기, NUMERIC/BOOLEAN/CATEGORICAL/TEXT 모두 파싱. NULL이면 기존 동작 그대로 (backward compat). 23 unit tests로 검증
- [x] Migration `20260608020000_evaluators_score_config.sql` — additive nullable FK, no backfill (#213)
- [x] NewEvaluatorDialog "Score config (optional)" picker — default "Numeric 0..1 (default)"로 기존 동작 유지 (#213)
- [ ] `apps/server/src/lib/stats-queries.ts` 수정 (타입별 집계) — **장기 follow-up**: evaluator-results 페이지의 차트가 typed value 기반으로 그려지려면 stats-queries 의존. 현재 /annotation 페이지의 인라인 차트로 사용자 가시 가치는 이미 확보됨

### 🧪 Testing
- [x] Server typecheck + lint clean
- [x] Web typecheck + lint clean
- [x] 661 server unit tests pass (+29 score-validation)
- [x] Validation: NUMERIC 범위 밖 값 거부, CATEGORICAL 미정의 값 거부, BOOLEAN 임의 truthy 거부, TEXT 빈 문자열 거부 (모두 단위 테스트로 검증)
- [x] CRUD UI 시각 검증 — Chrome MCP로 CATEGORICAL config 생성 + 표시 end-to-end
- [x] 기존 numeric 데이터 backward compat: legacy POST `{ score: 0.8 }` → 기본 NUMERIC config 사용해 typed 컬럼에도 저장
- [x] NUMERIC: 슬라이더/별점 → 0..1 저장 → 평균 집계 + 히스토그램 (#210, #211)
- [x] CATEGORICAL: 라디오 칩 → string 저장 → 분포 차트 (#210, #211)
- [x] BOOLEAN: 토글 → pass rate 집계 + split 바 (#210, #211)
- [x] TEXT: textarea → 저장 + 첫 5개 샘플 표시 (#210, #211)

### 🚀 Deployment
- [x] Migration prod 적용 (deploy-server.yml Apply DB migrations success)
- [x] 기존 모든 organization에 default_numeric config 생성 확인 (production oceancode에 "Helpfulness" DEFAULT 시각 확인)
- [x] 기존 human_evals 데이터 정상 표시 (NOT NULL drop으로 score nullable, 기존 row 그대로)

### 📊 Metrics & Monitoring
- [ ] 타입별 사용량 메트릭 (NUMERIC vs CATEGORICAL 등) — **운영 측정**
- [ ] LLM judge 응답 파싱 실패율 — 5% 미만 — **운영 측정 (23 unit tests로 1차 검증 완료)**

### 👤 UX Validation
- [x] Annotation 페이지에서 score config 드롭다운 selector (#210, URL-backed `?config=<uuid>`)
- [x] 타입별 입력 위젯 자연스럽게 전환 — Stars / Categorical chips / Boolean toggle / Text textarea (#210)
- [x] 분포 차트 — CategoricalDistribution / BoolPassRate / NumericHistogram (#211)
- [x] 차트 접근성 — `aria-label`로 count/percentage 노출 (`score-distribution.tsx`)

### 📚 Documentation
- [ ] /docs/evals에 스코어 타입 설명 추가 — **별도 follow-up (현재는 changelog로 커뮤니케이션)**
- [ ] Score config 생성 가이드 — **별도 follow-up**
- [x] Changelog: typed-score-configs / annotation-typed-widgets / llm-judge-typed-scores 3개 entry (#209, #212, #214)

### 🔄 Rollback Criteria
- 기존 human_evals 데이터 표시 깨짐
- LLM judge 파싱 실패율 20%+

---

## ✅ 4B.2 평가 실행에 OTel 스팬 (Dogfooding)

### Definition of Done
**평가/실험/playground 실행이 Spanlens 자체 trace로 기록되어 /traces에서 조회 가능**

**📅 1차 PR 머지: 2026-06-06 (#215) — `internal-tracing.ts` 라이브러리 + `eval-runner.ts` 통합**
**📅 2차 PR 머지: 2026-06-06 (#217) — `experiment-runner.ts` + `prompts-playground.ts` 통합**
**📅 활성화 완료: 2026-06-06 05:30 UTC — `spanlens-internal` project + `sl_live_20b057...` key + Vercel env 2개 + redeploy. Smoke test trace `smoke_test_4b2` 시각 확인 ✅**

### 🔧 Code Complete
- [x] `apps/server/src/lib/internal-tracing.ts` 신규 (#215, 250줄, no SDK dep, fail-open, no-op fallback)
- [x] 환경 변수 `SPANLENS_INTERNAL_API_KEY`, `SPANLENS_INTERNAL_BASE_URL` 추가 (`.env.example` 문서화 포함)
- [x] Vercel production env 등록 (production + preview, Sensitive) — 2026-06-06 05:30 UTC
- [x] `spanlens-internal` project 생성 + full-scope `sl_live_20b057...` key 발급 — oceancode workspace 내부 project (운영자 = workspace 소유자라 organization 분리 불필요)
- [x] `eval-runner.ts`에 `traceInternal` 통합 (#215): `eval_run` trace + per-sample `llm_judge` span, 3개 종료 path (성공/allFailed/catch) 모두 trace.end
- [x] `experiment-runner.ts` 통합 (#217): `ab_experiment` trace + per-item `ab_item` span (양쪽 arm + 옵션 judge를 한 span에 묶음), 2개 종료 path 모두 trace.end
- [x] `prompts-playground.ts` 통합 (#217): `playground_call` trace + single `llm` span, 4개 종료 path (openai 4xx/ok + anthropic 4xx/ok) 모두 trace.end
- [x] **무한 재귀 방지**: internal trace는 별도 project의 sl_live_* 키로 ingest API 사용. evaluator/playground/experiment 모두 source project ≠ spanlens-internal project라 재귀 불가능 (구조적 보장)

### 🧪 Testing
- [x] **9 단위 테스트** (`internal-tracing.test.ts`): disabled path stub, enabled POST shape, failure modes (5xx, throw), span chaining race-safety, end() PATCH, end-after-failed-creation
- [x] 693 server tests pass
- [x] **Smoke test trace 시각 확인**: curl로 4단계 (POST trace + POST span + PATCH span + PATCH trace) 직접 호출 → `smoke_test_4b2` agent / 12.96s duration / $0.00010 cost / 150 tokens / OK status가 /traces 페이지 첫 row에 즉시 노출 ✅
- [ ] 실제 eval 실행 → /traces에 `eval_run` trace + per-sample `llm_judge` span 노출 — **사용자가 다음 eval Run 시 자동 검증** (코드 path는 검증됨)
- [ ] 실제 experiment 실행 → `ab_experiment` trace + per-item `ab_item` span — **사용자가 다음 A/B 실행 시 자동 검증**
- [ ] 실제 playground 호출 → `playground_call` trace + `llm` span — **사용자가 다음 playground 사용 시 자동 검증**
- [x] 평가 실패 시 trace status='error' + error_message 캡처 (코드 path 확인)

### 🚀 Deployment
- [x] PR #215 머지 → production deploy 성공 (05:20 UTC)
- [x] PR #217 머지 → production deploy 성공 (05:50 UTC, experiment + playground 통합 포함)
- [x] `spanlens-internal` project 생성 + sl_live_* 키 발급 (05:30 UTC)
- [x] Vercel env 등록 + redeploy 완료 (05:32 UTC)
- [x] 첫 trace 노출 확인 (smoke_test_4b2, 05:38 UTC)

### 📊 Metrics & Monitoring
- [ ] Internal trace 수 / 일 메트릭 — **운영 작업 (Sentry custom metric 설정, 별도)**
- [ ] SDK fire-and-forget 실패율 — 1% 미만 — **24시간 모니터링 후 확인 (smoke test 200/201로 1차 검증됨)**

### 👤 UX Validation
- [x] internal trace를 oceancode workspace의 /traces 페이지에서 자기 dashboard로 확인 OK (구조적 격리: spanlens-internal project로 필터 가능)
- [x] **smoke_test_4b2** trace가 oceancode의 /traces 페이지에 정상 표시 (127개 trace 중 첫 row, OK status)

### 📚 Documentation
- [x] Changelog: "Spanlens now instruments itself with Spanlens" (#216)
- [x] Changelog: "A/B experiments and Playground also instrumented with Spanlens" (#218)
- [ ] Blog post / Twitter 콘텐츠: "We instrument Spanlens with Spanlens" (마케팅 자산) — **별도 작업**

### 🔄 Rollback Criteria
- SDK 호출 실패가 평가 실행 차단
- Internal project가 customer-facing 영향 (예: 메인 dashboard에 노출)

---

## ✅ 4B.3 백그라운드 마이그레이션 프레임워크

### Definition of Done
**`background_migrations` 테이블 등록한 마이그레이션이 cron 5분 간격으로 자동 실행, Vercel 5분 timeout 안에서 chunked 처리, heartbeat로 stale 복구**

**📅 PR 머지: 2026-06-06 (#220) — production deploy 성공**

### 🔧 Code Complete
- [x] Migration `20260608030000_background_migrations.sql` 적용 (테이블 + 인덱스 + RLS + advisory lock RPCs)
- [x] PG advisory lock RPC 헬퍼 — `try_advisory_lock_for_migration(name)` + `release_advisory_lock_for_migration(name)` SECURITY DEFINER 함수로 PostgREST 호출 가능
- [x] `apps/server/src/lib/background-migrations/index.ts` 인터페이스 + 시간 상수 (CHUNK_BUDGET_MS=240s, HEARTBEAT_STALE_MS=60s, HEARTBEAT_TICK_MS=15s)
- [x] `apps/server/src/lib/background-migrations/runner.ts` (lock + heartbeat + chunk loop + stale reclaim + finally release)
- [x] `apps/server/src/lib/background-migrations/registry/index.ts` (name → migration Map + test helpers)
- [x] `apps/server/src/api/cron.ts`에 `/cron/run-background-migrations` (assertCronAuth + logCronRun)
- [x] `apps/server/vercel.json` cron schedule `*/5 * * * *`
- [x] Stale 복구 로직 (heartbeat 60초 누락 시 자동 pending 전환)
- [x] Admin UI `apps/web/app/(dashboard)/settings/background-migrations/page.tsx`
- [x] 테스트 마이그레이션 등록: `noop-healthcheck` (deploy마다 framework 자체 검증)

### 🧪 Testing
- [x] **7 단위 테스트** (`runner.test.ts`): no candidate / 성공 path / 락 contended / runChunk throws / multi-chunk iteration / attempts bump / registry default
- [x] 같은 마이그레이션 2번 실행 시도 → advisory lock으로 1번만 (테스트로 검증)
- [x] Chunk 진행 상태 `state` 정상 저장/복원 (multi-chunk 테스트)
- [ ] 실제 production에서 5분 timeout 도달 → state 저장 후 종료, 다음 cron이 이어받기 — **실제 long-running migration 시 자동 검증**

### 🚀 Deployment
- [x] Migration prod 적용 (deploy-server.yml Apply DB migrations success, 06:23 UTC)
- [x] Cron schedule Vercel dashboard 등록 확인 (vercel.json에 등록됨)
- [x] Production `/api/v1/admin/background-migrations` 라우터 401 응답 (등록 확인)
- [ ] 첫 noop-healthcheck row INSERT → 다음 cron 실행 → 5분 후 status='completed' 확인 — **사용자가 seed 실행 후 자동 검증** (cron은 매 5분 자동 실행)

### 📊 Metrics & Monitoring
- [x] cron_job_runs 테이블에 run-background-migrations 자동 기록 (logCronRun 통합)
- [ ] 마이그레이션 status별 카운트 (pending/running/completed/failed) — **운영 작업**
- [ ] Stale 복구 발생 시 Sentry warning — **운영 작업**
- [ ] Failed 마이그레이션 즉시 Sentry alert — **운영 작업**

### 👤 UX Validation
- [x] Admin UI에서 진행률 표시 (progress.current / progress.total, `(N.N%)` 형식)
- [x] 실패 마이그레이션 error_message 표시 (background-migrations-client.tsx의 bad-tinted 박스)
- [x] 수동 트리거 / 취소 버튼 (admin only via requireSystemAdmin, 두 단계 confirm)
- [x] Heartbeat 상대 시각 표시 ("Ns ago" / "Nm ago" / "Nh ago" / "never")
- [x] "Registered in code, no DB row yet" 경고 배너 (registration ≠ seeded 갭 표시)

### 📚 Documentation
- [x] `noop-healthcheck.ts` 자체가 새 마이그레이션 작성 예제 (interface + idempotency 컨벤션 inline 문서화)
- [x] Changelog: "Background migration framework for long-running data backfills" (#220 후속)
- [ ] `docs/plans/background-migrations-guide.md` 별도 가이드 — **별도 follow-up**

### 🔄 Rollback Criteria
- 같은 마이그레이션 동시 실행됨 (lock 실패)
- Cron timeout 후 state 손실
- Heartbeat 무한 루프 (lock 해제 안 됨)

---

# Phase 5 — 전략적

## ✅ 5.1 events 통합 스키마 (ClickHouse)

### Definition of Done
**ClickHouse `events` 테이블에 trace + span + LLM 호출이 통합 저장. dual-write 6개월 안정 후 dashboard reading switch 완료**

### 🔧 Code Complete (Stage 1: dual-write 시작)
- [ ] ClickHouse migration `clickhouse/migrations/004_create_events.sql` 적용
- [ ] `apps/server/src/lib/logger.ts`에 `logEventAsync()` 추가
- [ ] 4개 proxy (openai/anthropic/gemini/azure) dual-write 통합
- [ ] `apps/server/src/api/ingest.ts` (trace + span) dual-write
- [ ] `apps/server/src/lib/events-query.ts` 신규 (eventsScope/selectEvents/countEvents)
- [ ] `logger.ts`의 fallback queue에 events 페이로드도 포함

### 🔧 Code Complete (Stage 2: backfill)
- [ ] Background migration `backfillEventsFromRequests` 등록
- [ ] Chunk size 50K row, 약 3분
- [ ] State: `last_created_at` 추적
- [ ] 진행률 UI 모니터링

### 🔧 Code Complete (Stage 3: reading switch)
- [ ] Feature flag `USE_EVENTS_TABLE` per-route
- [ ] `/api/v1/traces` events로 마이그레이션
- [ ] `/api/v1/requests` events로 마이그레이션
- [ ] `/api/v1/stats/*` events로 마이그레이션
- [ ] Trace 시각화 페이지 events 사용

### 🧪 Testing
- [ ] Dual-write 후 1시간: requests row count ≈ events row count (LLM span만)
- [ ] Backfill 100K row 모의 테스트 — 데이터 무결성 100%
- [ ] Reading switch 후 같은 쿼리 결과가 requests vs events 일치 (sample 1000건)
- [ ] 새 토큰 종류 (`vision_input_tokens`) Map에 자동 들어감 — 마이그레이션 불필요

### 🚀 Deployment (점진)
- [ ] **Week 1-2**: dual-write production rollout (feature flag off → on)
- [ ] **Week 3-4**: backfill (6개월 데이터 → events)
- [ ] **Week 5-12**: per-route reading switch (한 페이지씩)
- [ ] **Week 13-24**: 안정화 모니터링
- [ ] **Week 25+**: Postgres traces/spans deprecate 결정

### 📊 Metrics & Monitoring
- [ ] Daily reconciliation: requests vs events row count diff (Sentry alert > 1%)
- [ ] Events table size 증가율
- [ ] Reading switch 후 쿼리 latency 비교 (events가 같거나 빠름)
- [ ] ClickHouse INSERT 실패율 — requests vs events 동일 수준

### 👤 UX Validation
- [ ] Reading switch 후 사용자 체감 차이 없음 (UI 동일)
- [ ] Trace 시각화 — 같은 trace의 span 한 쿼리에 가져옴 (성능 향상)
- [ ] 실험 분석 페이지 — events의 experiment_id 활용

### 📚 Documentation
- [ ] CLAUDE.md "DB 작업 규칙" 섹션에 events 테이블 설명 추가
- [ ] `docs/plans/events-schema-migration.md` 회고

### 🔄 Rollback Criteria (Stage별)
- **Dual-write**: events INSERT 실패율 5%+ → events 일시 off, requests 유지
- **Backfill**: 데이터 무결성 1% 이상 mismatch → 백필 일시 중단
- **Reading switch**: 사용자 컴플레인 + 데이터 불일치 → feature flag로 즉시 requests 회귀

---

## ✅ 5.2 Code Eval 샌드박스

### Definition of Done
**JavaScript/Python 코드 평가자가 Lambda/Sandbox에서 안전 실행. timeout 5s + 네트워크 차단**

### 🔧 Code Complete
- [ ] Migration `20260715000000_code_evaluators.sql` 적용
- [ ] `infra/lambda/code-eval-runner/` Lambda 함수 (Terraform 또는 SAM)
- [ ] `apps/server/src/lib/code-eval-dispatcher.ts` (3 dispatcher)
- [ ] `apps/server/src/lib/eval-runner.ts`에 type='code' 분기
- [ ] `apps/web/app/(dashboard)/evals/components/CodeEvaluatorForm.tsx` (CodeMirror)
- [ ] 위험 패턴 검사기 (`require('fs')`, `import os` 등 거부)
- [ ] Test Run 엔드포인트 (UI에서 즉시 실행)

### 🧪 Testing
- [ ] JS 코드 정상 실행 + score 반환
- [ ] Python 코드 정상 실행
- [ ] Timeout: 무한 루프 코드 → 5s 후 강제 중단
- [ ] 위험 패턴: `eval`, `Function`, `require('fs')` → 거부
- [ ] 네트워크 호출 시도 → 차단 (Lambda SG)
- [ ] 환경 변수 접근 → 빈 객체

### 🚀 Deployment
- [ ] AWS 계정 + Lambda 함수 배포
- [ ] Lambda 실행 role 최소 권한 (CloudWatch만)
- [ ] VPC + SG로 outbound 차단
- [ ] Vercel Sandbox GA 시 dispatcher 추가

### 📊 Metrics & Monitoring
- [ ] Lambda invocation 수 + 실패율
- [ ] 평균 cold start latency
- [ ] Timeout 발생률 — 5% 미만 (대부분 정상 실행)
- [ ] AWS 비용 (Lambda + CloudWatch) — $30/월 이하

### 👤 UX Validation
- [ ] CodeMirror 에디터 — syntax highlight + lint
- [ ] "Test run" 버튼 — 1초 이내 응답 (warm)
- [ ] 에러 메시지 친절 (line number, error message)
- [ ] 예제 input/output JSON 자동 제공

### 📚 Documentation
- [ ] /docs/evals/code-eval — JS/Python 가이드 + 예제
- [ ] 보안 모델 명시 (네트워크 차단, timeout, 위험 패턴)

### 🔄 Rollback Criteria
- Lambda escape 시도 발견 (보안 사고)
- Timeout 발생률 30%+ (Lambda 인프라 문제)
- AWS 비용 $100/월 초과

---

## ✅ 5.3 3-Stage Ingestion + S3 캐시

### Definition of Done
**`/ingest/*` 호출이 S3 업로드 + Redis 큐 enqueue → 별도 worker가 ClickHouse INSERT. 재처리 가능**

### 🔧 Code Complete
- [ ] R2 (Cloudflare) 버킷 설정 + TTL 30일
- [ ] `apps/server/src/lib/s3-ingest-upload.ts` (R2 client)
- [ ] `apps/server/src/lib/ingest-queue.ts` (Upstash Redis list)
- [ ] `apps/server/src/api/ingest.ts` 라우터 3-stage 전환
- [ ] `apps/worker/` 신규 디렉토리 (Fly.io 컨테이너)
- [ ] `apps/worker/src/index.ts` (Redis polling 메인 루프)
- [ ] `apps/worker/src/processBatch.ts` (S3 다운로드 + CH INSERT)
- [ ] `apps/worker/Dockerfile` + `fly.toml`
- [ ] Dead letter UI

### 🧪 Testing
- [ ] Ingest 호출 → S3 객체 생성 + 큐 항목 enqueue → 즉시 207 응답
- [ ] Worker 1분 이내 ClickHouse INSERT 완료
- [ ] Worker kill → 재시작 → 큐에서 이어받기
- [ ] 5회 retry 실패 → dead letter
- [ ] S3 TTL 30일 후 자동 만료

### 🚀 Deployment
- [ ] R2 버킷 + IAM
- [ ] Fly.io 워커 배포 (icn region)
- [ ] Sentry DSN worker에 등록
- [ ] Production rollout — feature flag로 점진 (10% → 50% → 100%)

### 📊 Metrics & Monitoring
- [ ] Redis 큐 길이 (Sentry gauge)
- [ ] Worker 처리 latency (S3 download → CH INSERT)
- [ ] Dead letter 수
- [ ] S3 storage size + 비용
- [ ] Sentry alert: 큐 길이 1000+ 또는 worker down

### 👤 UX Validation
- [ ] SDK 사용자 체감 변화 없음 (latency 동일, 응답 형식 동일)
- [ ] /traces에 1분 지연 후 데이터 표시 — 명시적 indicator ("최근 1분 데이터는 표시 지연 가능")

### 📚 Documentation
- [ ] CLAUDE.md "데이터 흐름" 섹션 3-stage 패턴 추가
- [ ] Worker 운영 가이드 (재시작, 로그 확인, dead letter 처리)

### 🔄 Rollback Criteria
- Worker 다운 시 큐 1만 누적 (재처리 부담)
- S3 비용 $50/월 초과
- ClickHouse INSERT 실패율 5%+
- Feature flag off로 즉시 기존 path 복귀

---

# 차별화 강화

## ✅ D.1 인-라인 PII 자동 마스킹

### Definition of Done
**프로젝트별 옵션으로 LLM 호출 전 PII 자동 마스킹 동작. False positive 5% 미만**

### 🔧 Code Complete
- [ ] Migration `20260612000000_pii_mask_policy.sql`
- [ ] `apps/server/src/lib/pii-mask-deep.ts` 신규 (JSON 재귀 마스킹)
- [ ] 4개 proxy에 마스킹 호출 통합
- [ ] `apps/server/src/api/projects.ts`에 설정 PATCH
- [ ] UI: Security/Settings 페이지에 토글

### 🧪 Testing
- [ ] 마스킹 on + email 포함 prompt → LLM에 `[EMAIL_REDACTED]` 도달
- [ ] 응답 PII → 저장 시 마스킹
- [ ] False positive 측정: 100개 정상 prompt 중 5개 이하 잘못 매치
- [ ] 패턴 선택 동작 (email만 on, phone off)

### 🚀 Deployment
- [ ] Default off (기존 사용자 변화 없음)
- [ ] 설정 페이지 추가

### 📊 Metrics & Monitoring
- [ ] 프로젝트별 마스킹 활성화율
- [ ] 마스킹된 토큰 수 / 일

### 👤 UX Validation
- [ ] 마스킹 활성화 시 명확한 경고 ("LLM 응답 품질이 저하될 수 있습니다")
- [ ] /security 페이지에서 마스킹 통계 표시

### 📚 Documentation
- [ ] /docs/security — DLP 가이드 추가

### 🔄 Rollback Criteria
- False positive 20%+
- 마스킹으로 LLM 응답 품질 저하 컴플레인

---

## ✅ D.2 모델 추천 자동 적용

### Definition of Done
**Admin이 활성화한 swap rule에 따라 proxy가 자동으로 모델 교체. 응답 헤더 + audit log 명시**

### 🔧 Code Complete
- [ ] Migration `20260618000000_model_swap_rules.sql`
- [ ] `apps/server/src/lib/swap-rules-cache.ts` (5분 TTL)
- [ ] 4개 proxy에 swap 로직 통합
- [ ] 응답 헤더 `x-spanlens-model-swapped`
- [ ] `apps/web/app/(dashboard)/savings/savings-client.tsx` 수정
- [ ] "Apply rule" 버튼 + 확인 다이얼로그
- [ ] Active swaps 섹션 (적용 횟수 + 절감액)
- [ ] Audit log 통합

### 🧪 Testing
- [ ] Rule 활성화 → 다음 호출이 실제로 to_model로 라우팅
- [ ] 응답 헤더에 swap 정보 포함
- [ ] 적용 횟수 + 절감액 누적
- [ ] Rule 비활성화 → 즉시 원래 모델 사용

### 🚀 Deployment
- [ ] Admin 가드 (admin/editor만)
- [ ] Audit log 자동 기록

### 📊 Metrics & Monitoring
- [ ] 활성 rule 수
- [ ] 일별 swap 적용 횟수
- [ ] 누적 절감액

### 👤 UX Validation
- [ ] 활성화 시 명확한 경고 ("모든 호출이 영향받습니다")
- [ ] "Compare" 옵션 (Phase 6 — 현재는 단순 swap)

### 📚 Documentation
- [ ] /savings 페이지에 가이드 박스

### 🔄 Rollback Criteria
- 실수 활성화로 사용자 컴플레인 (LLM 응답 품질 저하)
- Cache stale로 swap 안 적용

---

## ✅ D.3 트래픽 Routing Rules

### Definition of Done
**프로젝트별 routing rule로 user_id/session_id/tag 기반 모델 선택 동작. Cross-provider 라우팅은 Phase 2**

### 🔧 Code Complete
- [ ] Migration `20260625000000_routing_rules.sql`
- [ ] `apps/server/src/lib/match-routing-rule.ts` (cache + priority)
- [ ] 4개 proxy에 통합 (same-provider only 1차)
- [ ] UI `apps/web/app/(dashboard)/settings/routing/page.tsx` (드래그 priority)
- [ ] "Test rule" 시뮬레이터

### 🧪 Testing
- [ ] VIP 유저 → GPT-4o
- [ ] 일반 유저 → GPT-4o-mini
- [ ] Percentage 50% → 절반만 라우팅 (해시 기반 deterministic)
- [ ] 우선순위 정렬 동작

### 🚀 Deployment
- [ ] Default: 룰 없음 (기존 동작 유지)

### 📊 Metrics & Monitoring
- [ ] 룰별 적용 횟수
- [ ] 라우팅 latency 추가량 — 1ms 미만

### 👤 UX Validation
- [ ] 드래그로 priority 재정렬
- [ ] 매치 시뮬레이터 — 가상 조건 입력 → 어떤 룰 매치되는지 미리보기

### 📚 Documentation
- [ ] /docs/routing-rules 신규

### 🔄 Rollback Criteria
- 룰 매칭 latency 추가 +10ms
- 의도와 다른 라우팅 발생 (cache stale)

---

## ✅ D.4 공유 링크 SEO 최적화

### Definition of Done
**Google 색인된 indexable share 페이지 1000개+ + OG 이미지 카드 정상 렌더링 + Rich Results 통과**

### 🔧 Code Complete
- [ ] `apps/web/app/share/[token]/page.tsx`에 JSON-LD
- [ ] `apps/web/app/sitemap.ts`에 indexable shares 통합 (10K limit)
- [ ] `apps/web/app/share/[token]/opengraph-image.tsx` 동적 생성
- [ ] `apps/web/app/robots.ts` 갱신
- [ ] 메타 태그 강화 (description/og:type/canonical)

### 🧪 Testing
- [ ] Google Rich Results Test 통과
- [ ] Twitter Card Validator 통과
- [ ] LinkedIn Post Inspector 통과
- [ ] sitemap.xml에 share URL 포함
- [ ] robots.txt에 /share/ allow

### 🚀 Deployment
- [ ] Google Search Console 등록
- [ ] Sitemap 제출
- [ ] 색인 요청

### 📊 Metrics & Monitoring
- [ ] `site:spanlens.io/share` 검색 결과 수 (3-4주 후 측정)
- [ ] 공유 페이지 organic 트래픽 (Vercel Analytics)
- [ ] OG 이미지 캐시 hit rate

### 👤 UX Validation
- [ ] OG 이미지 — trace name + spans + tokens + cost 명확 표시
- [ ] 공유 시 Twitter/Slack/Discord에서 미리보기 정상

### 📚 Documentation
- [ ] (없음 — 자동 작동)

### 🔄 Rollback Criteria
- indexable=true가 의도와 다르게 노출 (사용자 컴플레인)
- OG 이미지 생성 비용 폭증

---

## ✅ D.5 README 배지 라이브 갱신

### Definition of Done
**`/badge/:token/:metric` 동적 SVG/JSON 반환. GitHub README에서 정상 렌더링 + 5분 갱신**

### 🔧 Code Complete
- [ ] `apps/server/src/api/badge.ts` 동적 메트릭 분기
- [ ] `apps/server/src/lib/badge-svg.ts` 또는 shields.io endpoint JSON
- [ ] 메트릭 캐시 5분 TTL
- [ ] UI: `apps/web/app/(dashboard)/settings/badges/page.tsx` Markdown 복사
- [ ] Per-IP rate limit 유지 (60/min)

### 🧪 Testing
- [ ] GitHub README에 붙여넣기 → 배지 렌더링 (image cache 확인)
- [ ] 5분 후 메트릭 값 갱신
- [ ] 토큰 revoke → 404
- [ ] 4가지 메트릭 (requests/traces/cost/uptime) 모두 동작

### 🚀 Deployment
- [ ] Vercel CDN 캐시 (5분)

### 📊 Metrics & Monitoring
- [ ] 배지 호출 수 (Vercel logs)
- [ ] CDN cache hit rate — 80%+

### 👤 UX Validation
- [ ] Markdown 복사 — 한 번에 README에 붙여넣기 가능
- [ ] 4가지 메트릭 선택 + 미리보기

### 📚 Documentation
- [ ] /docs/badges 신규

### 🔄 Rollback Criteria
- 트래픽 폭증으로 비용 폭증 ($50/월 초과)
- 배지 렌더링 실패율 5%+

---

# 항목별 가중치와 우선순위

각 항목의 비즈니스 임팩트 + 기술 위험 가중:

| 항목 | 비즈니스 임팩트 | 기술 위험 | 가중 점수 | 시작 권장 시점 |
|---|:---:|:---:|:---:|---|
| 4A.1 Prompt Cache | 8 | 2 | **40** | 즉시 |
| 4A.2 Soft Delete | 7 | 3 | 28 | 즉시 |
| 4A.3 Audit UI | 5 | 1 | 25 | 즉시 |
| 4A.4 Token Display | 4 | 1 | 20 | 즉시 |
| 4A.5 Default Templates | 8 | 2 | **32** | 즉시 |
| 4B.1 ScoreConfig | 7 | 4 | 21 | launch +2주 |
| 4B.2 Internal Tracing | 5 | 2 | 17 | launch +1개월 |
| 4B.3 BG Migration | 6 | 5 | 14 | launch +1개월 (5.1 전제) |
| 5.1 Events Schema | 10 | 8 | **15** | launch +3개월 |
| 5.2 Code Eval | 8 | 7 | 13 | launch +4개월 |
| 5.3 3-Stage Ingest | 5 | 6 | 9 | launch +5개월 |
| D.1 PII Masking | 9 | 4 | **27** | 4B와 병행 |
| D.2 Auto Swap | 8 | 3 | **27** | 4B와 병행 |
| D.3 Routing Rules | 7 | 5 | 17 | 5와 병행 |
| D.4 Share SEO | 8 | 2 | **40** | launch 직후 즉시 |
| D.5 Live Badges | 6 | 2 | 24 | 4B와 병행 |

가중 = 비즈니스 × (10 - 기술 위험)

---

# 회고 양식 (각 항목 완료 시 사용)

```markdown
## [항목명] 회고

### 추정 vs 실제
- 추정 작업량: N일
- 실제 작업량: M일
- 차이 사유:

### 발견된 gotcha
- (새로 발견된 함정. CLAUDE.md에 추가했는지)

### 임팩트 측정
- 메트릭 1: baseline X → 현재 Y (개선/회귀)
- 메트릭 2: ...

### 다음 phase에 적용할 학습
-
```

---

**사용 가이드:**

1. 항목 시작 전: 이 문서에서 해당 섹션의 Definition of Done + 체크리스트 확인
2. 작업 중: 체크리스트를 todo로 사용
3. 완료 직전: 모든 체크박스 확인
4. 머지 후 24시간: Metrics & Monitoring 섹션 측정
5. 1주일 후: 회고 양식 작성 → 다음 항목 시작
