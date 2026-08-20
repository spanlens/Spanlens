# CLAUDE.md — AgentOps (가칭 · 정식명: Spanlens)
<!--
Claude Code 작업 지침서
3회 검증 완료 (2026.04)
-->
## 프로젝트
LLM 개발자를 위한 AI 관측 플랫폼 (오픈소스 SaaS · MIT · GitHub public).
baseURL을 1줄 교체해 요청 로깅, 비용 추적, 에이전트 트레이싱 제공.
타깃: 기존 LLM observability 도구들(인수·복잡함)의 가벼운 대안. Docker 이미지로 셀프호스팅 지원.
라이선스 전략: 전체 레포 MIT (OSS dev-tool 표준 모델). 해자는 SaaS 운영·brand·support이며 코드 공개 자체는 신뢰 시그널. 장래 복제 위협 커지면 Sentry 방식(BSL 전환) 옵션 열려 있음.
스택: Next.js 16 + Hono + Supabase PostgreSQL + TypeScript + pnpm monorepo
## 구조
apps/web/ — Next.js 16 대시보드 (App Router)
apps/server/ — Hono 서버 (LLM 프록시 + REST API 통합)
packages/sdk/ — JS/TS SDK (npm 배포용)
supabase/ — DB 마이그레이션(migrations/) + 시드(seeds/)
의존성 방향 (위반 금지):
apps/web → apps/server (fetch only, 직접 import 금지)
apps/server → supabase client
packages/sdk → 외부 패키지만 (apps/ 절대 import 금지)
핵심 데이터 흐름:
Client → POST /proxy/openai/v1/* → [API Key 검증] → [Provider Key 복호화] → OpenAI
응답 passthrough + tee() → 비동기 로깅 → requests 테이블
## 개발 명령어
### 로컬 시작
supabase start # 로컬 Supabase 실행 (Docker 필요)
supabase db push # 마이그레이션 적용
cp apps/server/.env.example apps/server/.env
pnpm install && pnpm dev # web:3000, server:3001
### 검증 — IMPORTANT: 코드 변경 후 반드시 실행
pnpm typecheck # TypeScript 타입 검사
pnpm lint # ESLint
pnpm test # 단위 테스트 (Vitest)
pnpm build # 최종 빌드 확인
### DB
supabase gen types --lang typescript --local > supabase/types.ts # 타입 재생성
supabase db reset # 로컬 DB 초기화 (주의: 전체 삭제)
## 변경 범위별 최소 검증
| 변경 범위 | 최소 검증 명령어 |
|---------------------|---------------------------------------------------|
| apps/web | pnpm --filter web typecheck && lint |
| apps/server | pnpm --filter server typecheck && lint && test |
| supabase/migrations | supabase db push && supabase gen types |
| packages/sdk | pnpm --filter sdk build && typecheck |
| 크로스 패키지 변경 | pnpm typecheck && pnpm lint (전체) |
## 인증 계층 — YOU MUST FOLLOW
/proxy/* 경로 → authApiKey + **requireFullScope** (sl_live_* full 키만 통과, sl_live_pub_*는 403 `PUBLIC_KEY_WRITE_FORBIDDEN`)
/ingest/* 경로 → authApiKey + requireFullScope (동일)
/v1/traces (OTLP) → authApiKey + requireFullScope (동일)
/api/v1/{stats, requests, users, traces, anomalies, recommendations} → **authJwtOrApiKey** (Supabase JWT 또는 sl_live_* — full/public 둘 다 통과)
/api/v1/me/key-info → authApiKey (CLI introspection — JWT 없이 sl_live_* 만 검증, scope 응답에 포함)
/api/* 그 외 → authJwt (Supabase JWT)
- `/api/v1/*` **write** 라우터 (scoreConfigs, experiments, datasets, security, prompts-playground `/run`, billing checkout/cancel 등) → authJwt(OrApiKey) 다음에 **`requireRole(...roles)`** 추가. `c.get('role')` 기반 org-role 게이트 (`security.ts`는 `admin`만, 나머지는 `admin`+`editor`). viewer JWT는 read만, write는 403 `FORBIDDEN`. GET엔 불필요.
- **evals.ts는 dual-auth라 plain `requireRole` 금지**: API-key path는 `role`이 null이라 `requireRole('admin','editor')`가 CI(`sl_live_*` eval 실행)를 깨뜨림. evals.ts의 `requireEdit` 미들웨어처럼 **role이 non-null일 때만** 체크 + write 라우트엔 `requireFullScope`로 public 키를 read-only 처리 (evals.ts:30 참고).
DB 쓰기(로깅) → supabaseAdmin (service_role, RLS bypass)
DB 읽기(조회) → supabaseClient (anon key, RLS 적용)
미들웨어 혼용 금지. dual-auth가 필요한 read API는 `authJwtOrApiKey` 한 곳만 사용.

### 통합 키(unified key) 모델 — 2026-05-05 + 2026-05-05 nested
- `api_keys.provider_key_id` **컬럼 없음** (마이그레이션 20260505040000_unified_keys로 제거).
- `sl_live_*` 키는 **프로젝트 단위**로 발급되고 provider-agnostic. provider는 request URL path
  (`/proxy/openai/...` vs `/proxy/anthropic/...` vs `/proxy/gemini/...`)에서 추론.
- **`provider_keys.api_key_id` NOT NULL** (마이그레이션 `20260505080000_provider_keys_under_api_keys.sql`로 `project_id` 컬럼 DROP + `api_key_id` 컬럼 추가). Provider key는 이제 한 Spanlens API key에 nested된 형태로 소유됨 — `apps/server/src/proxy/openai.ts`의 `getDecryptedProviderKey(apiKeyId, 'openai')`가 이 컬럼으로 lookup. **CLAUDE.md 이전 버전이 "provider_keys.project_id NOT NULL"이라고 잘못 적혀있었음** (PR #269의 E2E spec 13-fix 시리즈 8번째 fix에서 발견).
- 같은 `(api_key_id, provider)`에 active=true 키 1개만 허용 (UNIQUE INDEX).
- 새 provider key 발급/조회: `apps/server/src/api/providerKeys.ts` (`/api/v1/provider-keys`).
- 새 Spanlens key 발급/조회: `apps/server/src/api/apiKeys.ts` (`/api/v1/api-keys`) — provider 정보 더 이상 안 받음.
- 새 코드 또는 마이그레이션 작성 시 CLAUDE.md 이 섹션만 보지 말고 `supabase/migrations/` 최신 file (특히 20260505080000) 까지 확인 (gotcha ㉜ 참고).

### Public scope 모델 — 2026-06-04부터 (마이그레이션 20260604040000)
- `api_keys.scope` text NOT NULL DEFAULT `'full'` CHECK in (`'full'`, `'public'`).
- **scope=full**: `sl_live_<hex>` 프리픽스, **project-scoped** (`project_id` NOT NULL, `organization_id` NULL). 기존 동작 동일 — proxy/ingest + read 다 허용.
- **scope=public**: `sl_live_pub_<hex>` 프리픽스, **workspace-scoped** (`project_id` NULL, `organization_id` NOT NULL). read만 허용, proxy/ingest는 403. MCP 서버·BI 도구·공개 read 임베드처럼 키가 평문 노출되는 위치에 안전.
- `api_keys_scope_owner_consistency` CHECK constraint가 (scope, project_id, organization_id) 3개 컬럼 정합성을 DB 레벨에서 강제. app-layer 버그로 깨진 row 생성 불가능.
- `/projects` 페이지 상단 "Public Keys" 카드에서 발급. 발급 시 organization 단위.
- PII 마스킹: 기존 `sl_live_` 패턴이 `sl_live_pub_*`까지 자동 매칭 (`lib/pii-mask.ts`) — 별도 처리 불필요.
## 보안 규칙 — IMPORTANT (위반 시 보안 사고)
1. Provider Key(실제 OpenAI/Anthropic key) 절대 로그 출력 금지
2. Provider Key 복호화: apps/server/src/lib/crypto.ts의 aes256Decrypt()만 사용
3. 복호화 key는 fetch() Authorization 헤더에만 즉시 사용, 변수 저장 최소화
4. DB 저장 전 request_body에서 Authorization 헤더 제거 필수. provider-auth 헤더(`x-api-key`, `x-goog-api-key`)도 upstream 전 strip 필수 — 이전엔 sl_live_ 키가 OpenAI/Google로 유출됐음 (STRIP_HEADERS).
5. 스트리밍: body.tee()로 복사, 원본 스트림 즉시 클라이언트 반환
## DB 작업 규칙
**Supabase (Postgres) — 트랜잭션 / Auth / 관계형 데이터:**
- 새 테이블 추가 시 반드시: ALTER TABLE t ENABLE ROW LEVEL SECURITY;
- 기존 마이그레이션 파일 수정 금지 → 새 파일 추가 (YYYYMMDDHHMMSS_desc.sql)
- supabase/types.ts 직접 수정 금지 → supabase gen types 사용 (Phase 1 step 7에선 손 편집했음 — 다음 변경부터 다시 자동)
- 마이그레이션 실행 후 반드시 supabase gen types 재실행
- **Broken migration 복구 절차** (production에 적용 안 된 채 매 deploy fail 중인 경우):
  1. `git rm` 또는 edit 모두 `no-migration-edits` 훅에 차단됨 (의도된 정책)
  2. supabase MCP `execute_sql`로 production `supabase_migrations.schema_migrations`에 fake-apply row INSERT (다음 push에서 supabase가 "이미 적용됨"으로 간주하고 건너뜀)
  3. 신규 timestamp의 마이그레이션 파일 추가 (`YYYYMMDDHHMMSS_desc_v2.sql`)에서 정확한 SQL로 같은 의도 수행 (idempotent: `ON CONFLICT DO NOTHING`)
  4. 신규 마이그레이션 헤더 주석에 "supersedes YYYYMMDDHHMMSS due to <reason>" 명시. 원래 broken 파일은 git history에 유지 (왜 fake-apply했는지 추적 가능)
  5. **CI에서도 broken migration 제거**: `.github/workflows/ci.yml`의 "Validate migrations apply cleanly" step에 `rm -f supabase/migrations/<broken>.sql` 한 줄 추가. CI runner는 fake-apply 상태가 없는 throwaway DB라서 broken 파일이 그대로면 매번 같은 에러로 재현됨. git 조작이 아닌 filesystem 조작이라 `no-migration-edits` 훅 통과
  - 사고 이력: 2026-06-09 `20260609150000_register_orphan_span_link.sql`이 `description NOT NULL` 누락으로 4 PR 연속 deploy fail. `20260609170000_register_orphan_span_link_v3.sql`로 대체

**`requests` 테이블 (LLM 호출 로그) — Postgres, 단 접근 경로가 다름:**
- 2026-08-20에 ClickHouse에서 되돌아옴. 이유는 데이터 규모가 아니라 요금 구조였다 — ClickHouse Cloud는 가동 wall-clock으로 과금하고 마지막 쿼리 뒤 15분이 지나야 suspend하므로, 3천 행에 하루 15요청을 처리하는 서비스가 월 $186을 냈다. 배경은 [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md)
- 마이그레이션은 다른 테이블과 동일하게 `supabase/migrations/` + `supabase db push`. **별도 러너 없음** (`pnpm ch:migrate`는 사라졌고, 프로덕션 수동 적용 절차도 함께 사라짐)
- 스키마: 월 RANGE 파티션 + `PRIMARY KEY (created_at, id)`. 파티션 테이블의 PK는 파티션 키를 반드시 포함해야 하므로 `id` 단독 PK는 불가 — `id` 단건 조회는 파티션당 인덱스 스캔 + `Append`가 된다
- retention 두 층: 365일 초과는 파티션 DROP으로 하드 삭제, 플랜별(free 14 / pro 90 / team 365)은 `requestsScope`가 쿼리 시 클리핑. 두 층을 다 두는 이유는 플랜 업그레이드 시 과거 데이터가 되살아나야 하기 때문
- 파티션 생성은 `ensure_requests_partitions(months_ahead, months_back)`가 앞으로 3개월 + 뒤로 1개월을 미리 만든다. **DEFAULT 파티션에 행이 들어가면 그 범위의 정규 파티션 생성이 실패**하고, 그 확인 스캔이 `ACCESS EXCLUSIVE`로 프록시 쓰기를 막는다 — 미리 만드는 이유가 이것. **`months_back`을 빠뜨리지 말 것**: 과거 시각으로 쓰는 경로가 셋 있다(fallback 재생 최대 7일, 옛 스토어 백필, 시드 스크립트). 백필은 자기 범위 전체를 덮는 `months_back`을 넘겨야 한다
- 읽기는 `apps/server/src/lib/postgres.ts`의 풀 연결(Supavisor transaction 모드, 포트 6543)을 쓴다. PostgREST로는 백분위·`FILTER`·커서 스트리밍을 표현할 수 없어서. 그 연결은 RLS를 우회하므로 **격리는 `lib/requests-query.ts`의 `requestsScope`가 전담** — `lib/**` 밖에서의 `lib/postgres.ts` import는 ESLint가 차단
- 새 쿼리를 쓰면 `supabase/tests/requests-sql-smoke.sql`에 그 형태를 추가할 것. 모의 테스트는 SQL을 실행하지 않으므로(gotcha #37) 그 파일이 유일한 방언 검증 지점이고, CI가 `supabase db reset` 직후 실행한다

## 핵심 모듈 — 중복 구현 금지
lib/crypto.ts — AES-256-GCM 암/복호화 (Provider Key 전용)
lib/cost.ts — 비용 계산 calculateCost(provider, model, usage). 동기 함수 — DB 가격은 lib/model-prices-cache.ts가 백그라운드로 stale-while-revalidate 갱신 (5분 TTL). **provider 인자는 실제로 조회에 쓰임** — 모델명은 프로바이더 간 유일하지 않음(`qwen/qwen3-32b`가 groq $0.29 / openrouter $0.08). `azure`는 rows가 없어 `PRICE_TABLE_PROVIDER`가 `openai`로 리라이트. 조회 순서: exact `provider:model` → exact FALLBACK → provider-scoped 최장 prefix → FALLBACK 최장 prefix (exact가 언제나 prefix보다 우선)
lib/model-prices-cache.ts — getCachedPrices() 동기 lookup + refreshPricesNow() 강제 갱신. **캐시 키는 `"<provider>:<model>"`** (priceKey 헬퍼). FALLBACK_PRICES는 model-only 유지 — direct provider 모델만 담아 중복 이름이 없어야 함(openrouter id 넣지 말 것, 테스트가 가드). 핫 패스에서 await 금지
lib/logger.ts — 비동기 로깅 logRequestAsync(data) + parseLogBodyMode(header). `REQUEST_COLUMNS`가 INSERT 컬럼 목록의 단일 출처 — 새 컬럼은 여기와 마이그레이션을 같이 고칠 것. INSERT 실패 시 `requests_fallback` 큐(jsonb payload)에 보관되어 `/cron/replay-fallback`이 재생한다
lib/org-activity.ts — org별 마지막 요청 시각 워터마크(Postgres `org_activity`). `recordOrgActivity()`(logger.ts가 INSERT 성공 후 호출, org당 60초 throttle) / `getOrgActivitySince()` + `orgActiveSince()` / `anyActivitySince()`. **`requests`를 스캔하는 크론은 반드시 이걸 먼저 확인**해서 신규 트래픽이 없으면 스캔을 건너뛸 것 (gotcha #38). 전부 fail-open — 워터마크를 못 읽으면 "활성으로 간주"라서 알림·롤업이 조용히 죽는 일 없음
lib/cron-cadence.ts — `ranSuccessfullyWithin()` / `lastSuccessfulRunAt()` / `cadenceSkipResponse()`. 스케줄러 3중 발사(gotcha #32)를 handler 안에서 debounce. `cron_job_runs` 조회 기반, fail-open
lib/fallback-replay.ts — `replayFallbackQueue()` / `fallbackQueueSize()`. `requests_fallback` → `requests` 재적재, `ON CONFLICT (created_at, id) DO NOTHING`이라 재실행 안전. cron `/replay-fallback` 5분 간격
lib/db.ts — supabaseAdmin / supabaseClient 인스턴스
lib/postgres.ts — `requests` 전용 풀 연결. `pgQuery` / `pgQueryOne` / `pgExecute` / `pgStream`(커서) / `pingPostgres`. 플레이스홀더는 `{name}`이고 `toPositional`이 실행 직전 `$n`으로 바꾼다 — 값이 SQL 문자열에 들어가는 경로가 없다. 세션 타임존은 UTC 고정(`to_char`/`date_trunc`가 조용히 로컬 시각으로 새는 것 방지)
lib/requests-query.ts — requestsScope / selectRequests / countRequests / streamRequests / getOrgPlan / fetchProviderKeyNames / fetchProviderKeyLastUsed (모든 requests 읽기는 여기 경유)
lib/stats-queries.ts — getStatsOverview / getStatsModels / getStatsTimeseries / getLatencyPercentiles / getSecuritySummary / getUserAnalytics (구 Postgres RPC 대체)
lib/anomaly.ts — detectAnomalies / fetchContributingFactors (구 detect_anomaly_stats / get_anomaly_factors RPC 대체, 인라인 SQL)
lib/pii-mask.ts — maskApiKeys / maskApiKeysInBody (sk-, sk-ant-, sk-proj-, AIza, sl_live_ 패턴 마스킹 — `sl_live_pub_*` 까지 자동 커버)
lib/resolve-prompt-version.ts — X-Spanlens-Prompt-Version 헤더 파싱 (name@version / name@latest / UUID)
lib/params.ts — `isUuid` / `validateOptionalUuid` / `validateOptionalDate` + `parsePageLimit` 등. 쿼리 파라미터·path `:id` 검증 표준 헬퍼. malformed UUID는 404, bad date는 400. 새 read/DELETE 핸들러에서 손 파싱 말고 재사용.
middleware/authApiKey.ts — sl_live_* 키 검증 + scope 추출 + organizationId/projectId set (full은 projects join, public은 organization_id 직접). 모든 proxy/ingest/OTLP의 첫 게이트.
middleware/requireFullScope.ts — scope=public이면 403 + `PUBLIC_KEY_WRITE_FORBIDDEN`. authApiKey 다음에 mount해서 write 라우터에만 적용 (proxy/* + ingest/* + OTLP /v1/traces).
middleware/authJwtOrApiKey.ts — `/api/v1/*` read 라우터용 dual-auth. Authorization 헤더가 `Bearer sl_live_*`면 authApiKey + orgId bridge, 그 외엔 authJwt. 기존 read 핸들러는 `c.get('orgId')`만 읽으면 둘 다 호환.
middleware/requireRole.ts — `requireRole(...allowed: OrgRole[])`. authJwt 뒤에서 `c.get('role')` 검사, 불일치 시 403 `FORBIDDEN`. write 라우터 전용. dual-auth 라우터(evals)엔 그대로 쓰지 말 것 — null role(API-key path) reject해 CI 깨짐.
parsers/openai.ts — OpenAI 스트림 파서 (마지막 chunk에 usage)
parsers/anthropic.ts — Anthropic 파서 (message_delta에 usage, OpenAI와 다름!)
parsers/gemini.ts — Gemini 파서
proxy/stream-deadline.ts — `readWithDeadline()` / `makeStreamDeadline()` / `STREAM_DEADLINE_MS=290000`. 3개 proxy의 pump 루프에서 사용. gotcha #11 참고
lib/proxy-cache.ts — opt-in 응답 캐싱(`x-spanlens-cache`). `resolveProxyCache` / `storeCachedProxyResponse` / `purgeExpiredProxyCache`. key=sha256(api_key_id+provider+path+raw body), row도 api_key_id scope라 키 간 유출 불가. hit은 upstream 스킵 + `cost_usd=0` + `cache_hit=1` 로깅. fail-open. CH `cache_hit` 컬럼=migration 010, 새 테이블 `proxy_response_cache`(RLS on).
lib/cache-savings.ts — `/savings` 프롬프트-캐싱 절감 카드. 월누적 `cache_read_tokens × (input−cacheRead 단가)`, `requestsScope` 경유. `GET /api/v1/recommendations/cache-savings`(dual-auth). 집계 alias 컬럼명 겹침 금지(gotcha #37).
lib/weekly-digest.ts / lib/data-silence.ts — 주간 다이제스트(cron `/cron/weekly-digest` 월 09:00, `weekly_digest_runs` PK로 이중발송 방지) + 데이터 끊김 알림(cron `/cron/detect-data-silence` 6h). 수신자: `weekly_digest_emails` pref / `getAdminEmails`.
apps/web/lib/utils.ts — `formatDate()` / `formatDateTime()` / `formatTime()`. SSR-rendered Date format은 모두 이 헬퍼 경유 (locale 명시 + hydration-safe). gotcha #22 참고
apps/web/lib/hydration-safe-now.ts — `useHydrationSafeNow()`. `useState(() => Date.now())` 대체 — useSyncExternalStore + 모듈-level cache. demo/* 페이지나 "X mins ago" 같은 client mount-time 기준 시간 필요한 곳 전용 (live dashboard는 주기적 갱신 필요해 다른 패턴). gotcha #22 참고
apps/web/app/demo/_client-guard.tsx — `DemoClientGuard`. demo subsystem 전용 SSR skip wrapper — children을 mount 후에만 render. SEO 안 중요한 noindex 영역의 hydration mismatch 최후의 수단. gotcha #22 (F) 참고

## X-Spanlens-* 헤더 규약
프록시에서 유저→서버로 오는 내부 metadata는 모두 `x-spanlens-` 접두사. **upstream(OpenAI/Anthropic/Gemini)에 절대 forward 금지** — `proxy/utils.ts`의 `STRIP_PREFIXES`에서 일괄 제거. 현재 쓰이는 헤더:
- `x-trace-id`, `x-span-id` — 에이전트 트레이싱 (접두사 안 붙지만 같은 정책)
- `x-spanlens-project` — 프로젝트 scoping
- `x-spanlens-prompt-version` — Prompts A/B 링크 (SDK `withPromptVersion()` 헬퍼 또는 `observeOpenAI({ promptVersion })`로 자동 세팅)
- `x-spanlens-user`, `x-spanlens-session` — 고객 측 end-user / session 식별자 (SDK `withUser()` / `withSession()`)
- `x-spanlens-log-body` — `full | meta | none`. 고객이 body 저장 수준 제어. `meta`는 request_body/response_body만 빈 문자열, `none`은 거기에 더해 `user_id`/`session_id`까지 null로 저장. SDK `withLogBody()` 또는 `observeOpenAI({ logBody })`. 서버는 `logger.ts`의 `parseLogBodyMode`로 파싱 — 알 수 없는 값은 보수적으로 `full`로 폴백 (기존 동작 유지). 자동 PII 마스킹은 의도적으로 안 함 — 고객이 끄는 게 가장 안전.
- `x-spanlens-cache` — `true`(기본 3600s TTL) 또는 정수 초(최대 86400). 동일 request body의 exact-match hit이면 upstream 안 부르고 저장된 응답 반환(`cost_usd=0`, `cache_hit=1`). 비스트리밍·200·256KB 이하만. SDK `withCache()` 또는 `observeOpenAI({ cache })`. 응답 헤더 `x-spanlens-cache: hit|miss|bypass`.

새 X-Spanlens-* 헤더 추가 시: (1) 서버에서 header→DB 매핑 (2) SDK에서 헬퍼 제공 (3) `/docs/proxy`에 문서화 (4) `/docs/sdk`에 SDK 사용법 문서화 — 네 곳 다 빠뜨리지 말 것.
## 코드 스타일
- Hono 에러 반환: return c.json({ error: 'message' }, 401)
- 비동기 로깅 fire-and-forget: logRequestAsync(data).catch(console.error)
- Tailwind만 사용 (inline style 금지)
- 서버 컴포넌트: 데이터 fetch / 클라이언트 컴포넌트: 인터랙션(useState, onClick)
- 새 패키지 추가: pnpm add만 사용 (npm/yarn 혼용 금지)
## 새 기능 추가 시 흐름
1. DB 변경 필요? → supabase/migrations/ 새 파일 → db push → gen types
2. API 엔드포인트 → apps/server/src/api/ 해당 라우터에 추가
3. 인증 미들웨어 선택:
   - read API (`/api/v1/*`)이고 외부 도구(MCP/BI/embed)에서도 호출 → `authJwtOrApiKey`
   - read API인데 user identity 필요 (audit, members 등) → `authJwt`만
   - write API (`/proxy/*`, `/ingest/*`, OTLP) → `authApiKey` + `requireFullScope`
   - write API가 org-role 제약 필요 (viewer 차단) → authJwt 뒤에 `requireRole('admin','editor')`. dual-auth write면 evals.ts의 `requireEdit` + `requireFullScope` 조합 재사용.
   - app.ts mount 순서 invariant (2026-07-13 reorder): `/api/v1` wildcard 라우터(evalsRouter/humanEvalsRouter)는 **/api/v1 섹션 맨 마지막**에 mount됨. 새 specific 라우터는 "Wildcard /api/v1 routers — MUST STAY LAST" 주석 블록 **위**에 추가 — wildcard 뒤에 mount하면 wildcard authJwt가 먼저 잡아 dual-auth/public 라우트 무력화 (recommendations 2026-06-04 + feedback PR #304, 두 번 실사고). `src/__tests__/api-v1-mount-order.test.ts` source-guard가 순서 위반을 CI에서 잡음.
4. UI → apps/web에서 fetch('/api/v1/...') 또는 TanStack Query
5. 검증 → pnpm typecheck && lint && test
## 환경변수 (필수)
.env.example 참고. 핵심:
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
ENCRYPTION_KEY=<32바이트 base64> ← 잘못 설정 시 Provider Key 복호화 조용히 실패
PORT=3001 (server), 3000 (web)

## 도메인 & CORS 정책 — IMPORTANT
프로덕션에서 web이 사용하는 **모든 origin은 `apps/server/src/app.ts`의 CORS allowlist에 반드시 등록**해야 브라우저 fetch가 통과함. 누락 시 "blocked by CORS policy" 에러.
현재 등록된 origins:
- `https://spanlens.io` (apex, canonical로 리다이렉트됨)
- `https://www.spanlens.io` (primary canonical)
- `https://api.spanlens.io` (server 프로젝트 alias — 프록시/REST 공식 주소, 2026-07-13 등록)
- `https://spanlens-web.vercel.app` (Vercel default)
- `http://localhost:3000` (local dev)
- `https://spanlens-*-sunes26s-projects.vercel.app` (preview — 정규식 매치)

새 도메인(예: 별칭 `api.spanlens.io`, 파트너 제공 서브도메인) 추가 시 **CORS allowlist도 동시 수정** → 서버 재배포 필요.
## Known Gotchas — AgentOps 특유의 함정
1. 스트리밍 토큰 0: Anthropic usage는 message_delta에 있음 (OpenAI는 마지막 chunk). parsers/anthropic.ts 확인. Gemini streaming usage는 `?alt=sse` 버퍼가 JSON 배열 아닌 `data:` 라인이라 SSE-aware 파싱 + `hasUsage` 가드(cost 0 아닌 null). Gemini `thoughtsTokenCount`(reasoning, output rate 청구)는 completion tokens에 합산 — parsers/gemini.ts + recompute/experiment-runner/judge-calls 4곳.
2. 비용 null: model_prices에 모델 없으면 calculateCost()가 null 반환. 새 모델 추가 시 seeds/model_prices.sql 업데이트. **OpenAI는 응답 body의 `model` 필드를 dated variant(`gpt-4o-mini-2024-07-18`)로 돌려주고 그게 `requests.model`에 저장됨** — 따라서 모델 키로 매칭하는 모든 서버 로직(`lib/cost.ts`, `lib/model-recommend-rules.ts`)은 **exact match + longest boundary-aware prefix** fallback을 써야 함. 새 기능 추가 시 이 패턴 재사용 필수. (2026-07: `lib/cost.ts` `lookupPrice`도 boundary-aware prefix 적용 — `model-recommend-rules.ts`와 동일. 두 곳 모두 준수.)
3. **🔥 `requests` 읽기는 전부 `lib/requests-query.ts` 경유 (2026-08-20 Postgres 복귀)**: `requests`는 다시 Supabase Postgres 테이블이지만 **PostgREST가 아니라 `lib/postgres.ts`의 풀 연결**로 읽는다 — 백분위·`FILTER`·`date_trunc` 그룹핑·커서 스트리밍을 PostgREST가 표현할 수 없기 때문. 그 연결은 RLS를 우회하므로(ClickHouse가 RLS 자체가 없던 것과 같은 상태) **테넌트 격리는 전적으로 WHERE 절의 속성**이다. 모든 읽기는 `selectRequests` / `countRequests` / `streamRequests` 경유 — 헬퍼가 `organization_id` 격리 + plan retention(`free=14d / pro=90d / team=365d`)을 자동 주입. 빌링/관리 쿼리(`quota.ts`, `paddle-usage.ts`)는 `requestsScope(orgId, { ignoreRetention: true })`. 쓰기는 `logger.ts`의 `logRequestAsync`. **`lib/postgres.ts` 직접 import는 `lib/**` 밖에서 ESLint `no-restricted-imports`로 차단** — 라우트 코드가 WHERE 하나 빠뜨리면 다른 고객 프롬프트가 나간다.
4. spans FK 없음: spans.parent_span_id는 FK 제약 없음 (의도적). 에이전트 병렬 span 지원. 직접 FK 추가 금지.
5. 복호화 빈 문자열: ENCRYPTION_KEY 불일치 시 에러 대신 빈 문자열 반환 가능. 복호화 결과 항상 length 체크.
6. Paddle webhook `transaction.completed`: billing period 필드 없음. `fetchPaddleSubscription(sub_id)`로 Paddle API에서 보강해야 `current_period_start/end` 채워짐. `subscription.*` 이벤트는 `custom_data` 없을 수 있어 `paddle_customer_id` fallback 필수. paddleWebhook.ts 참고.
   - **🔥 Sandbox ↔ Production 완전 분리** (2026-05-18 production 전환 시 발견): Paddle은 sandbox와 production이 별개 인스턴스로, customer / subscription / price ID 모두 **호환 안 됨**. `PADDLE_ENVIRONMENT=production`으로 env만 바꾸고 DB의 sandbox 잔여 `paddle_customer_id` (`ctm_*`) 안 지우면 production API가 즉시 **404 "Customer not found"** 반환 (`POST /transactions`에 stale customer ID 전송됨). 환경 전환 시 cleanup SQL 필수: `DELETE FROM subscriptions WHERE paddle_customer_id = 'ctm_sandbox_*'; UPDATE organizations SET paddle_customer_id = NULL, plan = 'free' WHERE ...`. 같은 패턴이 Vercel `Preview` scope에서도 발생 — Preview/Dev는 sandbox env 유지하되 같은 production Supabase 쓰기 때문에 sandbox row가 누적됨. 신규 회원가입 직후 첫 결제 시도 시 sandbox 잔여 row 검색·정리하는 운영 절차 필요. Default Payment Link도 sandbox/production 별도 설정 (Sandbox에서 등록한 URL은 production Dashboard에 자동 동기화 안 됨).
7. Paddle Billing "호스티드 체크아웃" ≠ Stripe: `tx.checkout.url`은 항상 우리 도메인 + `_ptxn=txn_xxx`. 반드시 `@paddle/paddle-js` 오버레이로 열어야 함. `checkout.url`을 요청 바디에 넣지 말 것 — overlay 모드 전용 파라미터라 호스티드 체크아웃 경로 깨뜨림.
   - **🔥 Overlay 도메인 매칭 — apex ≠ www** (2026-05-18 발견): Paddle은 overlay 초기화 시 Default Payment Link 도메인과 현재 페이지 도메인을 비교함. `spanlens.io` (apex) 등록했는데 사용자가 `www.spanlens.io`에서 결제 시도하면 silent reject 또는 `POST /transactions 400` 발생 가능. canonical 도메인 (`www.spanlens.io`)로 등록 + apex는 redirect 처리하는 게 안전. 또는 Paddle Dashboard의 **Approved Domains** 에 `www.spanlens.io`, `spanlens.io`, `spanlens-web.vercel.app` 셋 다 등록. 새 도메인 alias 추가 시 (`api.spanlens.io` 등) 이 목록도 동시 업데이트.
   - **Statement Descriptor uniqueness 충돌** (2026-05-18 발견): Paddle Dashboard의 statement descriptor (사용자 카드 명세서에 찍히는 이름)는 화면에 표시된 규칙 (2~10자, 대문자/숫자/공백/점, 점으로 시작/끝 X) 외에 **다른 가맹점이 이미 사용 중이면 "Something went wrong" generic 에러로 silent reject**. 흔한 단어 (예: "OCEANCODE" 같은 일반 영단어 조합)는 충돌 가능. 회피: 제품 브랜드명 ("SPANLENS") 사용 — 보통 더 unique + chargeback 방지에 유리. 거부되면 임시로 숫자 suffix (`OCEANCODE9`) 또는 Paddle support에 화이트리스트 요청. **법인명보다 제품 브랜드명을 statement에 노출하는 게 chargeback rate 낮춤** — 사용자가 명세서에서 알아보는 이름이어야 함.
7a. **Paddle overage/usage 청구**: `POST /subscriptions/{id}/adjust` 엔드포인트 **존재하지 않음.** Spanlens는 `/subscriptions/{id}/charge` 사용 (`lib/paddle-charge.ts`). `action: 'credit'`은 **고객 환불 방향** — overage 청구엔 `effective_from: 'next_billing_period'` + 일반 items만 씀 (action 필드 없음). 이 경로 변경 시 반드시 `subscription_overage_charges` 테이블 멱등성 3-state flow (pending → charged/error) 유지 — 중간 크래시에서도 이중 청구 안 나게 설계됨.
8. **🔥 Vercel Edge fire-and-forget 금지 — 반드시 `fireAndForget()` 사용**: `logRequestAsync(...).catch(console.error)` 패턴은 **Vercel Edge runtime에서 pending promise를 통째로 drop**함 → 프록시 200 응답은 내려가는데 DB `requests` INSERT 조용히 사라짐. 로컬 Node dev / 직접 curl은 우연히 성공해서 테스트에 안 잡히고 production에서만 데이터 유실 — 가장 위험한 종류의 버그. 해결: `apps/server/src/lib/wait-until.ts`의 `fireAndForget(c, promise)` 사용 (`@vercel/functions` `waitUntil` 래퍼, Edge+Node 모두 drain 보장). `c.executionCtx`는 Hono getter가 없는 환경에서 **접근만 해도 throw**하므로 직접 쓰지 말 것. proxy/openai.ts, anthropic.ts, gemini.ts 참고.
   - **`apps/server/api/index.ts`는 현재 Node runtime (`runtime = 'nodejs'`, maxDuration 40s)** — 2026-04-27 3F 완료. Node 전환 과정에서 두 가지 어댑터가 모두 실패했으니 재사용 금지: ① `hono/vercel` `handle()` — Edge 전용; Node에서는 `IncomingMessage`를 Hono에 그대로 넘겨 `headers.get()` TypeError 발생 ② `@hono/node-server` `getRequestListener` — `Readable.toWeb(incoming)`을 lazy `pull()` 안에서 호출해 Vercel Node.js에서 stream 'end'가 신뢰성 있게 발생 안 함 → `c.req.json()` 영원히 hang → 40s timeout. **정답: `apps/server/api/index.ts`의 커스텀 핸들러 패턴** (`for await (const chunk of req)`로 body 먼저 버퍼링 후 `new Request()` 직접 생성). 이 파일 교체 시 반드시 이 패턴 유지.
   - **web `next.config.mjs`의 Edge용 `webpack()` 블록은 2026-08-11 제거됨 — 되살리지 말 것**: 원래 Edge 빌드에서 ① `@supabase/realtime-js` → `apps/web/lib/realtime-stub.js` alias ② `ws: false` alias ③ DefinePlugin으로 `__dirname`/`__filename` 주입, 3가지를 했음. 도입 이유는 realtime-js@2.104.0이 `ws`에 의존하고 `ws`가 module init 시점에 `__dirname`을 참조 → Edge Runtime엔 `__dirname`이 없어 middleware가 매 요청 `MIDDLEWARE_INVOCATION_FAILED`. **제거 근거는 두 겹**: (a) Next 16은 번들러 플래그가 없으면 Turbopack이 기본(`next/dist/lib/bundler.js`의 `parseBundlerArgs` — 플래그 0개면 `TURBOPACK='auto'` + Turbopack 반환)이고 web의 build 스크립트는 bare `next build`라, `webpack()` 훅이 **애초에 호출되지 않는 dead code**였음 (b) realtime-js가 2.107.0으로 올라가며 `ws` 의존성 자체를 버림(현재 deps는 `@supabase/phoenix` + `tslib`뿐) → 근본 원인 소멸. 빌드 산출물이 증거: `.next/server/edge/chunks/`에 `realtime-stub` 0건(= alias가 한 번도 적용된 적 없음)이고 realtime-js 원본(2.107.0)이 그대로 번들됐는데도 `__dirname`/`__filename` 0건, production middleware 정상. **Turbopack 대체 설정(`turbopack.resolveAlias`)은 불필요** — 대체할 alias가 없음. 앞으로 Edge에서 진짜 alias/폴리필이 필요해지면 `webpack()`이 아니라 `turbopack.resolveAlias`에 쓸 것. 스텁 파일 `apps/web/lib/realtime-stub.js`도 같이 삭제됨(참조처가 그 alias 한 줄뿐이었음).
   - **🔥 파생 함정 — `webpack` 키가 있고 `turbopack` 키가 없으면 Turbopack이 build/dev를 `process.exit(1)`**: `next/dist/lib/turbopack-warning.js`의 `validateTurboNextConfig()`가 `process.env.TURBOPACK === 'auto'`(= 번들러 플래그 미지정) && `webpack` 있음 && `turbopack` 없음이면 에러 출력 후 즉시 종료하고, `next build`(`turbopack-build/impl.js`)와 `next dev`(`server/lib/start-server.js`) **양쪽**에서 호출됨. 제거 전 우리 설정이 정확히 이 조건이었는데도 안 죽었던 건 **`withSentryConfig`가 Turbopack 감지 시 `turbopack` 키를 주입**(`getTurbopackPatch`)해서 가려줬기 때문 — 즉 Sentry를 빼거나 `disableSentryConfig`를 켜는 순간 web build/dev가 통째로 죽는 상태였음. `webpack` 키가 없어진 지금은 이 조건 자체가 성립 불가. 앞으로 web `next.config.mjs`에 `webpack()`를 다시 추가하려면 `turbopack` 키도 **반드시 같이** 넣을 것.
9. **고객 mock 모드 무한 폴백**: 일부 고객 앱이 API 키 없을 때 "mock 응답 200 반환" 패턴 씀 (예: mind-scanner route.ts). 환경변수 누락 시 **에러 안 내고 조용히 가짜 응답 → 유저는 AI 작동하는 줄 착각**. 온보딩 시 Vercel env 추가 후 `/requests` 대시보드에 실제 row 들어오는지 반드시 검증.
10. **🔥 SDK ingest POST 순서 race — `_creationPromise` chain 필수** (2026-04-23 sdk@0.2.3에서 fix됨): `createTrace` / `createSpan`이 fire-and-forget POST를 동시 발사하면, 서버의 `POST /ingest/traces/:id/spans`가 trace 소유권 확인(`ingest.ts:184`)할 때 trace INSERT 아직 commit 안 돼서 **404 silent fail** → span 영영 안 생김 → 23초 후 도착한 `PATCH /ingest/spans/:id`도 row 없어 silent no-op → 대시보드 `Spans: 0, Tokens: 0`. 짧은 trace(<3s)는 우연히 통과해서 테스트에 안 잡힘. 해결: TraceHandle/SpanHandle에 `_creationPromise` 보관, 자식 span POST는 부모의 promise 후 chain, `end()` PATCH도 자기 promise 후 chain. 사용자 코드는 LLM wait 동안 chaining 끝나서 영향 없음. **새 ingest endpoint(`/ingest/events`, `/ingest/feedback` 등) 추가 시 동일 패턴 재사용 필수** — 새 handle 클래스도 `_creationPromise` 노출 + `end()` 류 메서드는 await 후 PATCH.
11. **Spanlens 프록시 timeout — Node runtime, Vercel Pro maxDuration 300s, stream deadline 290s**: `apps/server/api/index.ts`는 Node runtime, `apps/server/vercel.json`의 `functions["api/index.ts"].maxDuration = 300`. 스트리밍 프록시는 P2.2(2026-05-19)부터 `apps/server/src/proxy/stream-deadline.ts`로 **290s에 graceful close**: 마지막 청크까지 pump하다가 deadline에 reader.cancel() + `truncated:true` 로 ClickHouse 기록. 10초 여유는 `fireAndForget` 로그 chain + 보안 알림 이메일이 `waitUntil`에서 drain 끝날 시간 — 줄이면 행 유실 위험 (gotcha #8 참고). 환경변수 `STREAM_DEADLINE_MS`로 조정 가능 (Hobby plan은 60s 한계라 50_000 권장). 클라이언트는 `[DONE]` / `message_stop` 도착 전 연결 종료로 truncate 감지 가능, 대시보드는 `/requests`에 `truncated` 배지 표시. 비스트리밍 경로의 `UPSTREAM_TIMEOUT_MS = 35000`은 초기 fetch headers만 gating — 별개의 메커니즘. **JSON mode + 매우 큰 `max_tokens`인 경우** `stream:true` + chunk 누적 패턴 (mind-scanner `app/api/analyze/route.ts`) 권장. Node 어댑터 교체 시 **gotcha #8 필독**.
12. **🔥 `lib/crypto.ts`의 모든 함수는 async — `await` 빠뜨리면 Promise 객체가 그대로 DB로 들어감**: `randomHex`만 sync고 `sha256Hex` / `aes256Encrypt` / `aes256Decrypt`는 전부 Web Crypto API 기반의 `Promise<string>` 반환. `const keyHash = sha256Hex(rawKey)` 처럼 `await` 빼면 keyHash는 Promise 객체가 되고, JSON 직렬화 시 `"[object Promise]"` 문자열로 INSERT됨 → 이후 인증 매칭 영영 실패 (silent break). bootstrap에서 신규 가입자 첫 API key가 통째로 깨지는 형태로 발견 (commit dcab522). 새 코드에서 이 함수들 호출 시 **타입 시스템이 잡아주지 못하는 영역**이라 (string concat이나 JSON.stringify 안에서 await 안 붙은 Promise를 자동 toString 처리) 손으로 검토 필요.
13. **`lib/crypto.ts` 헬퍼 사용 권장 — 이식성·일관성**: `apps/server/api/index.ts`는 현재 Node runtime이라 `node:crypto` 사용 가능. 그러나 **`lib/crypto.ts`의 헬퍼(`randomHex`, `sha256Hex`, `aes256Encrypt`, `aes256Decrypt`)를 쓸 것** — Web Crypto API 기반이라 Edge 재전환 시에도 무수정 호환. 과거 invitations.ts에서 `node:crypto` 직접 import 했다가 Edge 빌드 reject된 이력 있음 (commit 0b5470b). 신규 보안/암호화 코드는 `lib/crypto.ts` 헬퍼 재사용 필수.
14. **`org_members` RLS 정책은 self-reference 금지 — `42P17` infinite recursion**: 정책의 USING절이 같은 테이블을 SELECT하면 PostgreSQL이 query 자체를 reject. 안 좋은 예: `USING (organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()))`. 좋은 예: `USING (user_id = auth.uid())` 또는 SECURITY DEFINER 함수로 우회. 서버는 supabaseAdmin (service_role)로 RLS bypass라 모르고 넘어가다가 클라이언트 직접 select 시점에 깨짐. fix는 commit 8cfc1c7의 `20260425130000_fix_org_members_rls_recursion.sql`. 새 RLS 정책 작성 시 기준 테이블을 USING절에서 SELECT하지 말 것.
15. **🔥 Onboarding/dashboard 사이 navigation은 `window.location.href` 필수 — `router.push`는 RSC tree 캐시 유지**: Next.js의 `router.push('/dashboard')`는 client navigation이라 layout이 **이전 요청의 헤더로 평가**됨. onboarding step 2에서 `POST /me/profile/complete`로 `onboarded_at` 저장 직후 `router.push('/dashboard')` 하면, dashboard layout이 옛 `x-spanlens-onboarded` 헤더 (없는 상태)로 평가 → `redirect('/onboarding')` → 무한 루프. 해결: **`window.location.href = '/dashboard'`**로 hard reload (middleware 강제 재평가). 같은 패턴 적용 곳: 워크스페이스 스위치 (sidebar.tsx), 초대 accept (invite/page.tsx + pending-invitations-banner.tsx), onboarding 완료 (onboarding/page.tsx).
16. **Postgres 17 (config.toml) — production이 17로 업그레이드됨**: `supabase/config.toml`의 `major_version`은 **17**로 맞춰져있어야 함. 로컬 stack을 처음 띄우거나 변경 후엔 `supabase stop && supabase start`로 새 컨테이너 부팅 (major version은 기존 컨테이너 재사용 안 함). `supabase link` 시 "Local database version differs" 경고 뜨면 이 값 확인.
17. **새 환경변수 3개 (server) — production에 누락 시 invite 기능 절반 죽음**:
   - `WEB_URL` (필수, prod) — `https://www.spanlens.io`. 초대 이메일 accept 링크의 base URL. 누락 시 `http://localhost:3000` fallback → 사용자가 받은 링크 못 누름.
   - `RESEND_API_KEY` (선택) — Resend 토큰. 없으면 `lib/resend.ts`가 silent하게 발송 스킵하고 콘솔에 dev URL 출력. API 응답에는 `devAcceptUrl`이 들어감 (admin이 수동 전달 가능).
   - `RESEND_FROM` (선택) — 발신자 표시. Default `Spanlens <notifications@spanlens.io>`. 도메인 미인증 상태면 spam함 직행이라, Resend Domains에서 인증 후 `RESEND_FROM=Spanlens <notifications@mail.spanlens.io>` 같이 명시 권장. spanlens.io 자체는 이미 Verified (2026-04-25). DMARC는 `_dmarc` TXT 레코드 별도 추가 필요 (가비아 DNS).
   - `SPANLENS_ADMIN_EMAILS` (선택, internal-only routes 사용 시) — Spanlens 내부 운영자 이메일 allowlist (콤마 구분). `/api/v1/admin/*` 경로 접근 권한. 누락 시 모든 admin route 403 (fail-closed). 예: `SPANLENS_ADMIN_EMAILS=admin@example.com`. P2.1에서 `/admin/model-prices`용으로 도입됨.
18. **~~ClickHouse DateTime64 `Z` 거부~~ — 소멸 (2026-08-20)**: Postgres는 ISO-8601을 그대로 받고, `lib/postgres.ts`가 `timestamptz`를 ISO 문자열로 파싱해 돌려준다. `toClickhouseTimestamp` / `fromClickhouseTimestamp`와 호출부의 `.replace(' ','T') + 'Z'` 재파싱은 전부 제거됨. **주의: 그 헬퍼를 되살리면 안 된다** — 이미 `Z`가 붙은 값에 다시 걸면 `...000ZZ`가 되어 파싱 불가 날짜가 만들어진다(이관 중 `api/sessions.ts` 4곳에서 실제로 발생할 뻔했음).
19. **🔥 Postgres 드라이버도 `numeric`/`int8`을 string으로 반환 — `Number()` 변환 필수 (ClickHouse에서 이어짐)**: 이관해도 **소멸하지 않는 함정**이다. `node-postgres`는 `numeric`(cost_usd)과 `int8`(`count(*)`)을 JS number로 파싱하지 않는다 — 2^53 초과 정밀도 손실을 막기 위한 의도된 동작. `r.cost_usd + 1` 하면 `"0.001" + 1 = "0.0011"` 문자열 concat 버그가 그대로 재현된다(silent). API boundary에서 항상 `Number(r.cost_usd ?? 0)`. `selectRequests<T>` 호출자가 row를 그대로 응답에 흘리면 클라이언트가 string으로 받는다. 실측 확인: `SELECT cost_usd` → `"0.00012345"`.
20. **`positionCaseInsensitive` → `ILIKE`로 옮기지 말 것 — 리터럴 vs 패턴 (2026-08-20)**: ClickHouse에 `ilike`가 없어 `positionCaseInsensitive`를 쓰던 자리를 Postgres `ILIKE`로 바꾸면 **동작이 달라진다**. CH 함수는 **리터럴 부분문자열** 검사이고 `ILIKE`는 패턴 매치라, 사용자 검색어에 `%`나 `_`가 들어오면 와일드카드로 해석된다(`gpt-4_turbo` 검색이 아무 문자나 매치). 올바른 대응은 `position(lower({q}) in lower(col)) > 0`, 접두사는 `starts_with(col, {p})`(`LIKE p || '%'` 아님). `nullsFirst: false` → `ORDER BY col DESC NULLS LAST`는 그대로 유효.
21. **🔥 Postgres엔 `input_format_skip_unknown_fields` 같은 안전망이 없다 — 컬럼 추가는 반드시 additive + migration 먼저 (2026-08-20 갱신)**: ClickHouse에는 미존재 컬럼을 조용히 버려주는 설정이 있어서 deploy → migration 사이 window를 덮어줬다. Postgres에선 **미존재 컬럼 INSERT가 하드 에러**이고, `deploy-server.yml`의 migrate→deploy 하드 게이트는 존재하지 않는다(gotcha #25 — best-effort 순서에 의존 중). 실질 안전망은 두 겹: ① 마이그레이션은 항상 additive + 멱등(`ADD COLUMN IF NOT EXISTS`, `NOT NULL DEFAULT`) ② `logger.ts`의 INSERT 실패가 `requests_fallback`(jsonb payload)에 큐잉되고 `/cron/replay-fallback`이 마이그레이션 도착 후 재생 — 스키마가 늦게 와도 행이 유실되지 않는다. 새 컬럼 작성 시 `REQUEST_COLUMNS`(logger.ts)와 마이그레이션을 **같은 PR에서** 맞추되, 마이그레이션이 먼저 프로덕션에 닿게 할 것.
22. **🔥 React #418 hydration mismatch — SSR/CSR이 다른 값을 만드는 모든 패턴**: SSR HTML과 client 첫 paint 결과가 달라서 React가 throw하는 #418. minified production stack은 React 내부 함수만 표시(`rX → rY → sd → ...`) — 호출하는 사용자 컴포넌트 식별 어려움. 알려진 trigger 패턴 + 해결법:

    **(A) locale 미지정 Date format**: `new Date(x).toLocaleString()`/`toLocaleDateString()`/`toLocaleTimeString()` — Vercel iad1 Node `en-US`(`"5/18/2026"`) vs 한국 사용자 Chrome `ko-KR`(`"2026. 5. 18."`). `lib/utils.ts`의 `formatDate()`/`formatDateTime()`/`formatTime()` 헬퍼 사용 또는 `'en-US'` + 옵션 명시. **Number.toLocaleString()은 안전** (en-US/ko-KR `1,234` 동일). PR #70(initial), PR #257(demo subsystem sed).

    **(B) `useState(() => Date.now())` 또는 `useState(() => new Date())`**: `'use client'` 컴포넌트의 useState lazy initializer가 SSR pass에서도 실행 → server time과 browser time이 따로 캡처. demo 페이지의 "fired X mins ago" 같은 상대 시간 mismatch. **해결**: `apps/web/lib/hydration-safe-now.ts`의 `useHydrationSafeNow()` 사용 (useSyncExternalStore + 모듈-level cache). React 19의 `react-hooks/set-state-in-effect` 룰 때문에 `useEffect + setNow` 단순 대체 불가. PR #255~#257.

    **(C) `useSyncExternalStore`의 getSnapshot이 unstable reference**: `getSnapshot: () => Date.now()`처럼 매 호출 새 값 반환 → React가 "store changed"로 인식 → forceStoreRerender 무한 loop → recharts 같은 child가 "Maximum update depth exceeded"로 폭발. **반드시 모듈-level cache로 첫 호출 1회 capture + 이후 동일 reference 반환**. `useHydrationSafeNow()`와 `docs/_components/table-of-contents.tsx`가 표준 패턴. PR #256 디버깅 중 발견.

    **(D) recharts `ResponsiveContainer` SSR**: ResizeObserver로 width 측정하는데 SSR에 ResizeObserver 없음 → server SVG width 0 vs client 실측 width → `<path d="...">` geometry 다름. **해결**: `dynamic(() => import('./chart').then(m => m.RequestChart), { ssr: false, loading: () => <div className="h-[220px]" /> })`. SEO 안 중요한 demo 영역 우선 적용. PR #256.

    **(E) Module-level `const N = Date.now()` 또는 `Math.random()`**: module load 시점에 evaluation → server bundle과 client bundle이 별도 process라 다른 값. 그 값을 사용한 모든 곳 mismatch. **해결**: timestamp는 hour-level round(`Math.floor(Date.now() / 3_600_000) * 3_600_000`), random은 deterministic noise(`Math.sin(i * 13.7) * 5 + 5`). PR #255 demo-data.ts fix.

    **(F) 식별 안 되는 잔존 mismatch — 최후의 수단**: minified stack이 component 위치 안 알려주고, chunk source 검색에도 후보가 안 잡힐 때. `apps/web/app/demo/_client-guard.tsx`의 `DemoClientGuard` 패턴 — useSyncExternalStore로 server snapshot `false` / client snapshot `true` 반환, mount 전엔 `null` render. SSR HTML이 empty라 diff할 게 없어 mismatch 자체 불가능. **단, SEO/first-paint 중요한 페이지엔 쓰면 안 됨** — demo/* 같은 noindex 영역 전용. PR #258.

    **공통 도구**: `apps/web/lib/hydration-safe-now.ts` (useHydrationSafeNow), `apps/web/lib/utils.ts` (formatDate/formatDateTime/formatTime), `apps/web/app/demo/_client-guard.tsx` (DemoClientGuard). 새 SSR-rendered 컴포넌트 작성 시 이 helpers부터 검토.
23. **INSERT 실패는 silent loss가 아님 — `requests_fallback` 큐가 받는다 (P2.6, 2026-08-20 갱신)**: `lib/logger.ts`가 INSERT throw 시 `requests_fallback`에 보관(payload jsonb + retry_count + last_error). cron `/cron/replay-fallback`이 5분마다 batch 50개씩 `requests`로 재적재하고, 7일 또는 100회 retry 후 만료. **payload가 jsonb라 스키마에 독립적** — 이게 gotcha #21의 보상 장치다. 컬럼 추가 마이그레이션이 코드보다 늦게 도착해 INSERT가 하드 실패해도 행은 큐에 보존되고, 마이그레이션이 도착한 뒤 재생된다. 재생은 멱등: `ON CONFLICT (created_at, id) DO NOTHING`이라 "INSERT 성공 + DELETE 실패" race에서도 중복이 안 생긴다 (ClickHouse 시절 `fetchExistingIds` 사전조회가 하던 일을 이제 PK가 대신한다). 운영 시 `/health/deep`의 `fallback.queue`가 비정상(>1000)이면 `alertOnFallbackBacklog()`가 `internal_alerts`(kind `fallback_queue_high`)에 남기고 `/admin/alerts`에 노출. quota lookup은 DB 장애 시 fail-OPEN — 관측 실패로 고객 요청을 막지 않는다.
24. **🔥 Vercel KV(Upstash Free 티어)에서 raw `redis.set()`은 silent reject — Lua script만 persist**: 2026-05-19 Step #4 SWR 캐시 시도 중 발견. `@upstash/redis`로 `redis.set(key, value, { ex: N })` 호출 시 (1) Upstash MONITOR에 SET 명령 도달, (2) SDK는 "OK" 응답을 받음, (3) 그러나 Data Browser에 키가 존재하지 않고 후속 `redis.get(key)`는 즉시 `null` 반환. **같은 인스턴스, 같은 토큰, 같은 코드 경로**에서 `@upstash/ratelimit` (내부적으로 Lua `EVAL` 사용)은 정상 작동 — 차이는 raw 명령 vs Lua script. 라벨 Free / AWS us-east-1 / Global mode에서 재현. 추정 원인: Upstash Free 티어가 Lua가 아닌 직접 write 명령에 대해 silent acceptance만 하고 persist는 안 함 (또는 Vercel KV 통합의 미documented 동작). **새 캐시 도입 시**: (a) Pay-as-you-go 티어 사용 ($0.20/100만 cmd), 또는 (b) helper를 `redis.eval(luaScript, ...)`로 작성해 Lua 경유. PR #106~#110 revert 됨. 향후 캐시 재도입 시 Lua 패턴 채택 또는 Redis provider 교체 검토.
25. **🔥 Postgres 마이그레이션은 코드 deploy 전에 production에 적용되어야 함 — `deploy-server.yml`은 migrate만 실행, 순서는 best-effort (하드 게이트 아님)**: 2026-06-04 PLG Loop ② 머지 후 `/api/v1/organizations/me` 가 prod에서 500/404 반환. 원인: 코드가 새 컬럼(`hide_powered_by_badge`)을 SELECT 하는데 production DB에 컬럼이 없었음. Vercel git integration 으로 서버 코드는 자동 배포되지만 `supabase db push --linked` 는 수동이었음 → 코드만 갔고 스키마는 안 따라감. ClickHouse gotcha #21 과 정확히 같은 패턴(스키마 먼저 → 코드 다음). 현재 상태: `.github/workflows/deploy-server.yml` 은 main push마다 `migrate` job (`supabase db push --linked --include-all`, 멱등)만 실행. **⚠️ migrate→deploy 하드 게이트는 존재하지 않음** — 원래 있던 `deploy` job(`needs: migrate`, `npx vercel --cwd apps/server --prod`)은 PR #277에서 workspace:* 의존성이 추가된 뒤 `--cwd apps/server`가 pnpm-workspace.yaml 없이 workspace 의존성을 못 풀어 무조건 실패하게 되면서 제거됨. 서버 배포는 Vercel git integration이 병렬로 수행하고, migrate는 보통 수초 내 끝나는 반면 Vercel 빌드는 2~3분 걸려 **실무상 migrate가 먼저 끝나는 best-effort 순서**에 의존 중(워크플로 상단 주석에 명시). 하드 보장이 다시 필요하면 `--cwd` 없이 전체 repo를 `npx vercel --prod`로 올려 workspace 의존성을 풀 수 있게 한 뒤 `deploy` job(`needs: migrate`)을 복원할 것. 그전까지 실질 안전망은 워크플로가 아니라 **아래 (a)(b) 추가성(additive) 마이그레이션 컨벤션** — 비-additive 마이그레이션을 쓰면 이 사고가 재발 가능. 필요 시크릿: `SUPABASE_ACCESS_TOKEN` (account/tokens 페이지), `SUPABASE_DB_PASSWORD` (Project Settings → Database). Web (Vercel git integration) 은 이 순서 밖이라 web → server 간 race는 별도. 다행히 추가성(additive) 마이그레이션만 작성하는 컨벤션 덕분에 web 이 옛 server API 응답을 잠시 받아도 새 필드 undefined 로 graceful degrade. **새 컬럼/테이블 추가 PR 작성 시**: (a) 마이그레이션은 IF NOT EXISTS/ADD COLUMN IF NOT EXISTS 같이 멱등 작성 (b) 컬럼을 NOT NULL + DEFAULT 로 추가해 backfill 자동화 (c) `concurrency: prod-deploy` 그룹 덕분에 빠른 연속 push 도 race 없이 직렬화.

26. **🔥 Dependabot의 pnpm sub-directory entries는 lockfile 갱신 못 함 — root only**: `.github/dependabot.yml`에 `/apps/server`, `/apps/web`, `/packages/sdk` 같은 sub-dir entry를 두면 dependabot이 그 디렉토리의 `package.json`만 bump하고 **root의 `pnpm-lock.yaml`은 못 만짐**. CI 첫 단계 `pnpm install --frozen-lockfile`이 `ERR_PNPM_OUTDATED_LOCKFILE`로 죽어서 typecheck/test 실행 자체가 안 됨. 같은 변경의 root entry (`/`) PR은 lockfile도 같이 갱신되어 통과. 정답: dependabot.yml에 **root 한 entry**만 두고 group을 `update-types: ["minor", "patch"]`로 제한해서 majors 분리. 사고 이력: 2026-06-04 PR #185, #186이 같은 패턴으로 fail → PR #188로 sub-dir entries 제거.

27. **🔥 Dependabot PR description의 update table은 거짓일 수 있음 — 실제 diff 확인 필수**: dependabot의 PR body는 일부 패키지만 listing하면서 실제 변경에는 더 많이 들어가는 경우 있음. 2026-06-04 PR #187 ("all-deps with 27 updates")의 body에는 `typescript`/`@types/node`가 **없었는데** 실제 diff엔 5.x→6.0 + 22.x→25.x가 머지 후 main에 들어가 있었음 (옛 commit에서 들어와 있던 거지만 listing 누락). 그 결과 docker-publish 워크플로우가 `TS2591 Cannot find name 'process'`로 50+ 파일에서 죽음 (PR #190 `apps/server/tsconfig.json`에 `"types": ["node"]` 명시로 fix). **머지 전 PR diff (`gh pr diff <N>`) 직접 확인**하거나, 머지 직후 docker-publish/Vercel deploy 같은 별도 build path가 깨지는지 모니터.

28. **🔥 `apps/server/tsconfig.json`에 `"types": ["node"]` 명시 필수 — Dockerfile `--filter server` install + TS 6 + @types/node 25 조합에서 자동 lookup 실패**: 로컬 monorepo install은 root에서 모든 workspace의 `@types/*`를 hoist해서 default behavior로 `@types/node` 자동 include. Dockerfile은 `pnpm install --frozen-lockfile --filter server`라 narrower hoist tree → TS 6 / @types/node 25 환경에서 `process`, `node:crypto`, `NodeJS` 못 찾음. 해결: tsconfig `compilerOptions.types: ["node"]`로 명시. Vercel server deploy는 별도 build path라 영향 없고 docker-publish만 깨지는 패턴이라 발견 늦음.

29. **`mcp-publisher init`의 부수효과 — CWD에 `LICENSE` + `README.md` 생성/덮어쓰기**: `npx mcp-publisher init`은 `server.json` 만들 때 같은 디렉토리에 자기 binary가 따라오는 LICENSE와 함께 modelcontextprotocol/registry repo의 README를 fetch해서 떨어뜨림. 기존 패키지의 README가 통째로 덮어쓰여서 git diff에 큰 변경 발생 — 발견 못 하고 commit하면 패키지 README가 registry README로 바뀐다. **mcp-publisher binary + LICENSE + tar.gz는 `.gitignore`에 추가** (`packages/mcp-server/.gitignore` 참고). `init` 후 항상 `git status`로 의도치 않은 파일 검증.

30. **MCP Registry는 GitHub org publish 시 **public membership** 필요**: `mcp-publisher publish`가 `io.github.<org>/...` namespace에 publish하려 할 때 GitHub API로 org membership을 확인. 멤버십이 private면 403 `You have permission to publish: io.github.<your-username>/*. Attempting to publish: io.github.<org>/...`. 해결: GitHub `Organizations` 설정에서 본인 멤버십을 Public으로 전환 (https://github.com/orgs/<org>/people → 본인 옆 visibility) → mcp-publisher **logout + re-login**으로 토큰 재발급. 사고 이력: 2026-06-04 첫 publish 시도에서 발생.

31. **MCP Registry description 100자 제한**: server.json의 `description`이 100자를 초과하면 publish 시 `422 expected length <= 100`. npm package.json은 길어도 OK이지만 registry는 stricter. 발견 시점에는 description 137자였음. 짧고 핵심만 — 사용자가 registry 검색 결과에서 바로 use case 인지하도록 작성.

32. **🔥 Vercel cron jobs는 vercel.json 변경을 즉시 sync하지 않음 — 새 cron이 며칠씩 안 firing할 수 있음** (2026-06-09 발견, 2026-06-16 업데이트): production 프로젝트가 Pro 플랜이라 40 crons까지 가능하지만, vercel.json `crons` 배열에 새 entry를 추가해도 Vercel 스케줄러가 등록하지 않는 경우 존재. Vercel 측 캐싱 또는 스케줄러 버그로 추정 (support ticket 필요). **증상**: cron_job_runs 테이블에 특정 cron이 한 번도 안 보임. `runtime_logs`에 GET /cron/x 진입 흔적 0. **확인 방법**: supabase MCP로 `SELECT job_name, count(*), max(ran_at) FROM cron_job_runs WHERE ran_at > now() - interval '24 hours' GROUP BY job_name` → vercel.json 정의보다 적게 나오면 sync 깨진 것. **회피 패턴 — 3중 스케줄러**: ① `.github/workflows/cron-server.yml`에 GH Actions cron으로도 등록. 단, GH Actions도 `*/5` 같은 짧은 cadence에선 throttle해서 단독으론 100% 안 됨 (2026-06-15 production `cron_job_runs` 24h 조회 시 `*/5` 스케줄 3.5%, self-monitor 8%, hourly job들 16~33% 발사). ② critical 엔드포인트(`replay-fallback`, `self-monitor`)는 **Better Stack Uptime monitor** 추가로 등록 (Settings → Monitors → Create monitor). URL + `Authorization: Bearer $CRON_SECRET` 헤더 + 3분 / 30분 간격. Better Stack은 외부 인프라라 Vercel/GH 갭에 영향 안 받음 → 사실상 100% 발사. ③ CRON_SECRET은 **Vercel env에서 Sensitive 플래그 해제**해두기 (회수 가능). rotation 필요 시 GH Actions secret + Better Stack header 세 군데 동기화. 사고 사례: `/cron/run-background-migrations` 며칠 firing 안 함 → background_migrations 큐 적체. `/cron/replay-fallback` Vercel + GH 둘 다 throttle → Better Stack monitor 추가로 해결 (PR #365).

33. **🔥 프록시 응답 `content-length` strip 필수 — undici가 gzip 해제하지만 압축 length 유지 → body 잘림**: `proxy/utils.ts`의 `STRIP_RESPONSE_HEADERS`에 `content-length` 포함(`content-encoding`과 함께). undici/fetch는 gzip·br을 투명 해제하지만 원본(압축) `content-length`는 그대로 둠 → 클라이언트로 forward 시 Node가 해제된 body를 압축 바이트 수로 truncate → 잘린 JSON. 런타임이 실제 길이 재계산하도록 반드시 strip.

34. **~~비-UUID `trace_id`가 row를 통째로 날림~~ — 소멸 (2026-08-20)**: ClickHouse는 `trace_id`/`span_id`를 `Nullable(UUID)`로 타이핑해 비-UUID 값이 오면 **행 전체를 reject**했다(fallback 엔트리도 없이 silent loss). Postgres 테이블은 두 컬럼 모두 `text`라 구조적으로 불가능하다. `proxy/shared/log-base.ts`의 UUID 검증은 **삭제하지 않고 경고 로깅으로 격하해 유지** — 형식이 깨진 값은 여전히 알고 싶지만, 이제 그것 때문에 로그를 잃지는 않는다.

35. **🔥 hono `StreamingApi.write()`는 절대 reject 안 함 — write try/catch로 클라 disconnect 감지 불가**: hono 내부(`utils/stream.js`)가 `try { await writer.write() } catch {}`로 모든 write 에러를 삼킴. 클라 disconnect 감지는 `honoStream.onAbort(listener)` + `honoStream.aborted` 플래그 사용 — `api/index.ts`가 Node socket 'close'에서 response body reader를 cancel하면 hono `responseReadable`의 cancel 핸들러가 `stream.abort()`를 발화함. `proxy/shared/stream-pump.ts` 패턴: onAbort에서 upstream reader cancel → pending read 즉시 resolve → truncated 로깅. 이 경로 테스트는 mock 금지 — 실제 `Hono` 앱 + `app.request()` + body reader cancel로 검증 (`stream-pump.test.ts`). 사고 이력: 2026-07-06 #388이 write try/catch로 구현 → dead code, 회귀 리뷰서 발견.

36. **middleware.ts 라우트 가드는 PROTECTED_PATHS (protected-list) 방식 — public-list로 되돌리지 말 것**: 사이트는 마케팅/docs/share 등 public 페이지가 대부분이고 매주 늘어남. public allow-list는 새 페이지 추가 시 등록 누락 → 익명 방문자 `/login` 307 (2026-07-06 실사고: #388이 isPublic 경계 버그를 고치자 리스트에 없던 /docs /changelog /share/* /compare 등 public 면 전체가 로그인월에 갇힘). 새 dashboard 라우트 추가 시 `PROTECTED_PATHS` 등록 (누락해도 `(dashboard)/layout.tsx`의 `!userId → redirect('/login')` 이중 방어가 잡음). middleware의 **모든** return 경로(redirect 포함)는 `withRotatedCookies()`로 회전된 세션 쿠키 carry 필수 — 누락 시 refresh-token 재사용 감지로 랜덤 로그아웃.

37. **~~ClickHouse 집계 alias shadow (`ILLEGAL_AGGREGATION`)~~ — 소멸, 그러나 교훈은 유효 (2026-08-20)**: Postgres는 `WHERE`에서 출력 alias를 해석하지 않으므로 `sum(x) AS x` 패턴이 쿼리를 죽이지 않는다. **남는 교훈은 이것**: 그 버그는 cache-savings 엔드포인트를 몇 주간 상시 500으로 만들었는데 **모의 테스트가 전부 통과했다** — DB 클라이언트를 모킹하면 SQL 문자열이 조립만 되고 어디에도 전송되지 않기 때문. 그래서 `supabase/tests/requests-sql-smoke.sql`이 실제 Postgres에 쿼리 형태를 파싱·플래닝시키고 CI가 `supabase db reset` 직후 실행한다. **새 쿼리가 그 파일에 없는 구문을 쓰면 그 파일에도 추가할 것** — 거기 있는 형태만 Postgres에 대해 증명된 것이다.
38. **🔥 크론이 대형 테이블을 반복 스캔하지 않게 워터마크로 게이팅 (2026-08-20 갱신)**: 원래 동기는 ClickHouse Cloud의 가동시간 과금이었다 — 크론 4개가 15분 idle 창을 계속 리셋해 하루 8건 처리하는 서비스가 24/7 요금($8.805/일)을 냈다. **ClickHouse를 떠난 뒤에도 게이팅은 유지한다.** 이유가 바뀌었을 뿐이다: 크론이 신규 트래픽 없이도 6시간마다 전 테넌트를 스캔하면, 그건 트래픽에 비례해 커지는 테이블을 하루 네 번 훑어 "아무것도 안 바뀜"을 확인하는 낭비고, 그 부하가 프록시 인증 경로와 **같은 인스턴스**를 공유한다. 구조: (a) `lib/org-activity.ts` — logger가 INSERT 성공 시 org별 마지막 요청 시각을 `org_activity`에 찍고, 스캔하는 크론이 그걸 먼저 확인 (b) `lib/cron-cadence.ts`의 `ranSuccessfullyWithin(job, CH_CRON_MIN_INTERVAL_MINUTES)`로 3중 스케줄러(gotcha #32) debounce. **⚠️ 반복해서 걸린 함정 — 게이트 윈도우가 크론 주기보다 길면 게이트가 무의미하다**: 활성 테넌트 하나만 있어도 매 주기 통과한다(월 단위 quota, 30일 budget 알림에서 두 번 발생). 게이트는 `max(윈도우 시작, 마지막 성공 실행)`으로 좁히고, **실패한 실행을 `ok`로 기록하지 말 것**(안 그러면 일시 장애 한 번이 알림을 영구 침묵시킴). 단 이 기법은 **신규 row 없이 값이 오를 수 없는 지표에만** — `sum(cost_usd)`는 OK, `error_rate`/`p95`는 오래된 row가 빠지며 오를 수 있어 윈도우 게이트 유지. 새 크론이 `requests`를 읽게 되면 `src/__tests__/cron-cadence-wiring.test.ts`의 감사 목록에 등록할 것.

39. **🔥 `SUPABASE_DB_POOLER_URL`은 IPv4 공유 풀러여야 한다 — 대시보드 기본값은 IPv6 dedicated (2026-08-20 실사고 2회)**: Vercel 서버리스는 **아웃바운드 IPv6가 없다**. Supabase Connect 창이 먼저 보여주는 dedicated 풀러 호스트 `db.<ref>.supabase.co`는 **AAAA 레코드만** 있어서(A 없음) 그대로 넣으면 DNS에서 죽는다. 정답은 `Connect → Direct → Transaction pooler → "Use IPv4 connection" 토글 ON`:
    `postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:6543/postgres`
    - **호스트의 번호 접두사는 리전에서 유추 불가** (`ap-northeast-2`가 `aws-0`이 아니라 `aws-1`이었다). 반드시 대시보드에서 복사.
    - **사용자명 접미사와 호스트는 한 세트**: 공유 풀러는 `postgres.<ref>`, dedicated는 bare `postgres`. 섞으면 즉시 거부.
    - **원인 판별은 `/health/deep`의 `postgresPool.latencyMs`로 한다.** Vercel runtime log 쿼리는 자주 타임아웃나서 못 믿는다. 수십 ms 실패 = 머신을 못 떠남(호스트 문제), 500ms대 실패 = 도착했는데 거부됨(자격증명/테넌트 문제). 실측: `~13ms ENOTFOUND`(호스트 오타 또는 IPv6 전용) / `~12ms ENOIDENTIFIER`(접미사 누락) / `~528ms tenant not found`(번호 접두사 오류) / `~558ms 28P01`(비밀번호) / `~145ms ok`(정상, iad1→서울).
    - Vercel env 변경은 **실행 중 배포에 반영 안 됨**. 재배포 후 확인할 것.

## CI/CD Gotchas — GitHub Actions + npm + Docker
1. **setup-node@v4 + registry-url → NPM_CONFIG_USERCONFIG shadow**: setup-node가 `NPM_CONFIG_USERCONFIG` env var를 자체 `.npmrc`로 설정. 패키지 디렉토리에 쓴 `.npmrc`가 무시됨. 해결: workflow에서 `unset NPM_CONFIG_USERCONFIG && npm publish --userconfig "$PWD/.npmrc"` + setup-node에서 `registry-url` 제거.
2. **npm Granular token의 "새 scope" 제약**: 이전 기록("새 패키지 첫 publish 불가")은 부정확. 정확히는 **scope 자체가 존재하지 않으면** Granular token의 첫 publish가 실패함. 한 번 scope가 만들어지면 그 scope 내의 **다른 새 패키지**는 Granular token으로 CI publish 가능. 증거: `@spanlens/sdk` 첫 publish는 로컬 `npm login` 세션 필요했지만, 이후 `@spanlens/cli` 신규 패키지는 Granular token CI workflow로 정상 publish됨. Classic token UI는 npm이 숨겼지만 `npm token create --packages-all --packages-and-scopes-permission=read-write --bypass-2fa`로 CLI에서 생성 가능.
3. **토큰 유출 없이 secret 전달 검증**: workflow에 `echo "NPM_TOKEN length: ${#NPM_TOKEN}"` 넣으면 값 노출 없이 secret이 injection 됐는지 확인 가능. 길이가 예상과 다르면 사용자가 다른 토큰을 넣었거나 빈 값.
4. **Chrome MCP의 `form_input`은 React controlled input에서 실패 가능**: "Set value to X" 성공 메시지 떠도 React state엔 반영 안 될 수 있음. GitHub Secrets 같은 보안 폼은 **저장 직후 목록 페이지에서 이름 실제로 보이는지 재검증 필수**. 저장 안 된 걸 모르고 진행 → CI 시도 → ENEEDAUTH 디버깅 지옥.
5. **Docker 빌드 `.dockerignore`의 `apps/web` 제외**: 루트에서 multi-stage 빌드 시 pnpm workspace 때문에 `apps/web/package.json`은 필요함. `apps/web` 제외하되 `!apps/web/package.json`으로 예외 허용. 안 그러면 `failed to compute cache key: "/apps/web/package.json": not found`.
6. **Windows cmd의 `rm -rf` 미지원**: `package.json`의 `"clean": "rm -rf dist"`는 Linux CI에선 OK지만 로컬 Windows 수동 publish 시 실패. `npm publish --ignore-scripts`로 `prepublishOnly` 훅 우회하거나, cross-platform `rimraf` 사용.
7. **`vercel deploy` CLI 접근 불가 시**: Claude의 bash 환경에서 `/dev/tty` 없어서 git push 프롬프트 블록. credential manager가 캐시한 뒤엔 정상. 대안: 빈 커밋으로 webhook 트리거 `git commit --allow-empty && git push`.
8. **🔥 npm Granular token 최대 90일 만료 — 매 cliff 운영 부담**: npm UI에서 Granular token 발급 시 Expiration 드롭다운 최대값이 **90일** (2026-05-20 확인). `365 days` 선택지 없음. 짧은 cycle로 분기마다 publish 멈춤 사고 위험 → (a) 발급 시 **다음 만료일을 캘린더 등록** (만료 1주 전 알림 필수), (b) 만료 임박 시 publish 작업 줄서있으면 미리 교체, (c) 만료 없는 토큰이 필요하면 **Classic Automation token** 사용 (`npm token create --packages-all --packages-and-scopes-permission=read-write --bypass-2fa` CLI로 발급 — npm이 UI에서 숨겼지만 CLI는 여전히 동작). 단 Automation token은 권한이 broader라 scope 격리는 Granular보다 약함. 발견 이력: 2026-04~05 두 토큰이 같은 날(05-20) 만료 → publish 워크플로우 실패 → 새 토큰 발급 → 90일 max라 8월에 또 만료 예정.
9. **🔥 `Bypass 2FA` 체크박스 누락 → CI publish가 `EOTP` 에러로 실패**: npm 계정이 2FA 모드 "Authorization and publishing"이면 publish 시 OTP 요구. GitHub Actions는 OTP 입력 불가 → `npm error code EOTP`. Granular token 발급 페이지 상단의 **`Bypass two-factor authentication (2FA)` 체크박스 ON 필수** (default OFF). 발급 후 Summary에 `Bypass two-factor authentication` 줄이 보여야 정상. 안 보이면 폐기하고 재발급. 대안 (덜 추천): 계정 전체 2FA 모드를 "Authorization only"로 낮추기 — security regression. 발견 이력: 2026-05-20 새 토큰 발급 시 체크 누락 → workflow `EOTP` 실패 → 재발급으로 해결.
## @spanlens/mcp-server — 외부 IDE 통합 (2026-06-04부터)
- 위치: `packages/mcp-server/`. 패키지명 `@spanlens/mcp-server`, bin `spanlens-mcp`. Public scope 키(`sl_live_pub_*`)만 받음 (full 키 부팅 시 거부).
- 7개 tools: `get_stats`, `query_requests`, `list_traces`, `get_trace`, `get_anomalies`, `get_savings`, `get_user_analytics`. 모두 `/api/v1/*`의 dual-auth read API를 호출.
- 발행 (npm + MCP Registry 모두 자동, 2026-07 확인): `git tag mcp-server-v<X.Y.Z> && git push --tags` 하나로 `.github/workflows/publish-mcp-server.yml`이 ① npm publish → ② `mcp-publisher login github-oidc` (GitHub Actions OIDC — 수동 OAuth 불필요) → ③ MCP Registry publish (npm 전파 대기 15s×5 retry)까지 수행. 로컬 `mcp-publisher` 수동 실행은 workflow가 죽었을 때 fallback으로만.
- `server.json`의 `version`/`packages[0].version`은 workflow가 publish 직전 package.json 값으로 auto-sync — 손으로 맞출 필요 없음. 단 `mcpName`(`io.github.spanlens/mcp-server`)은 auto-sync 대상 아님: `server.json` + `package.json` 양쪽에서 동시에 유지, 미스매치면 registry verifier가 reject.
- 버전 bump는 **3곳**: `package.json`, `server.json`(2곳 — auto-sync가 있으니 커밋 diff 일관성용), `src/version.ts`의 `SERVER_VERSION`.
- 새 tool 추가 시: (1) `packages/mcp-server/src/tools.ts`에 zod 스키마 + 핸들러 (2) README의 "Available tools" 표 갱신 (3) version bump + tag.

## 금지 사항
- git reset --hard 금지
- generated/ dist/ .next/ supabase/types.ts 직접 수정 금지
- 기존 supabase/migrations/*.sql 파일 수정 금지
- apps/web에서 Supabase 직접 접근 금지 (반드시 /api/ 경유)
- console.log에 key/secret/token 포함 금지
- pnpm 외 패키지 매니저 사용 금지
- lib/cost.ts, lib/crypto.ts 함수 다른 곳에 재구현 금지
- `.github/dependabot.yml`에 npm sub-directory entry 추가 금지 — pnpm-lock 갱신 못 함 (gotcha #26)
- `apps/server/tsconfig.json`의 `compilerOptions.types: ["node"]` 제거 금지 — Docker build 깨짐 (gotcha #28)
- `requireFullScope` 미들웨어를 read 라우터에 mount 금지 — public 키 사용자 차단
- requireRole를 evals 같은 dual-auth 라우터에 mount 금지 — null-role API-key path reject해 CI 깨짐.
- `lib/postgres.ts`를 `lib/**` 밖에서 직접 import 금지 — 라우트 코드는 `lib/requests-query.ts` 헬퍼 경유 (ESLint가 차단, gotcha #3)
- `positionCaseInsensitive` 자리를 `ILIKE`로 치환 금지 — 리터럴 검사 vs 패턴 매치라 `%`·`_`가 든 검색어에서 갈림 (gotcha #20)
- `fromClickhouseTimestamp` 류 타임스탬프 재작성 헬퍼 부활 금지 — 이미 ISO인 값에 `Z`를 덧붙여 파싱 불가 날짜를 만듦 (gotcha #18)
- `spans.request_id` FK 복원 금지 — 파티션 DROP이 `requests` 행을 지우는데 `spans`는 남아 retention 크론이 깨짐
- `requests` 파티션을 `DETACH PARTITION` 없이, 또는 `CONCURRENTLY` 없이 떼어내기 금지 — 부모에 `ACCESS EXCLUSIVE`가 걸려 프록시 쓰기가 락 뒤에 줄섬
## 커밋 규칙
Conventional Commits: type(scope): description
type: feat | fix | refactor | perf | test | docs | chore
scope: web | server | sdk | db | proxy
예: feat(proxy): add anthropic streaming support
