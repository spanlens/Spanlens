# CLAUDE.md — AgentOps (가칭 · 정식명: Spanlens)
<!--
Claude Code 작업 지침서
리서치 기반: Helicone CLAUDE.md + Langfuse AGENTS.md + Anthropic Best Practices
3회 검증 완료 (2026.04)
-->
## 프로젝트
LLM 개발자를 위한 AI 관측 플랫폼 (오픈소스 SaaS · MIT · GitHub public).
baseURL을 1줄 교체해 요청 로깅, 비용 추적, 에이전트 트레이싱 제공.
타깃: Helicone(인수됨)·Langfuse(복잡함)의 대안. Docker 이미지로 셀프호스팅 지원.
라이선스 전략: 전체 레포 MIT (Langfuse/PostHog 모델). 해자는 SaaS 운영·brand·support이며 코드 공개 자체는 신뢰 시그널. 장래 복제 위협 커지면 Sentry 방식(BSL 전환) 옵션 열려 있음.
스택: Next.js 14 + Hono + Supabase PostgreSQL + TypeScript + pnpm monorepo
## 구조
apps/web/ — Next.js 14 대시보드 (App Router)
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
DB 쓰기(로깅) → supabaseAdmin (service_role, RLS bypass)
DB 읽기(조회) → supabaseClient (anon key, RLS 적용)
미들웨어 혼용 금지. dual-auth가 필요한 read API는 `authJwtOrApiKey` 한 곳만 사용.

### 통합 키(unified key) 모델 — 2026-05-05부터
- `api_keys.provider_key_id` **컬럼 없음** (마이그레이션 20260505040000_unified_keys로 제거).
- `sl_live_*` 키는 **프로젝트 단위**로 발급되고 provider-agnostic. provider는 request URL path
  (`/proxy/openai/...` vs `/proxy/anthropic/...` vs `/proxy/gemini/...`)에서 추론.
- `provider_keys.project_id`는 **NOT NULL** — 모든 provider AI key는 명시적으로 한 프로젝트에 속함.
  org-level fallback row 사라짐.
- 같은 `(project_id, provider)`에 active=true 키 1개만 허용 (UNIQUE INDEX).
- 새 provider key 발급/조회: `apps/server/src/api/providerKeys.ts` (`/api/v1/provider-keys`).
- 새 Spanlens key 발급/조회: `apps/server/src/api/apiKeys.ts` (`/api/v1/api-keys`) — provider 정보 더 이상 안 받음.

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
4. DB 저장 전 request_body에서 Authorization 헤더 제거 필수
5. 스트리밍: body.tee()로 복사, 원본 스트림 즉시 클라이언트 반환
## DB 작업 규칙
**Supabase (Postgres) — 트랜잭션 / Auth / 관계형 데이터:**
- 새 테이블 추가 시 반드시: ALTER TABLE t ENABLE ROW LEVEL SECURITY;
- 기존 마이그레이션 파일 수정 금지 → 새 파일 추가 (YYYYMMDDHHMMSS_desc.sql)
- supabase/types.ts 직접 수정 금지 → supabase gen types 사용 (Phase 1 step 7에선 손 편집했음 — 다음 변경부터 다시 자동)
- 마이그레이션 실행 후 반드시 supabase gen types 재실행

**ClickHouse — `requests` 테이블 전용 (LLM 호출 로그):**
- 마이그레이션: `clickhouse/migrations/NNN_desc.sql`, 적용: `pnpm ch:migrate` (멱등성 필수 — CREATE IF NOT EXISTS / ALTER ADD COLUMN IF NOT EXISTS만, DROP 절대 금지)
- 로컬: `docker compose up clickhouse` 후 `pnpm ch:migrate`. 환경변수: `CLICKHOUSE_URL/USER/PASSWORD/DB`
- 프로덕션: ClickHouse Cloud Development tier 시작 ($50/월). Plan은 [docs/plans/clickhouse-migration.md](docs/plans/clickhouse-migration.md) 참고
- RLS 없음 → `apps/server/src/lib/requests-query.ts`의 `requestsScope` 헬퍼로 `organization_id` + retention 필터 자동 주입. 직접 `getClickhouse().query()` 호출은 lib 파일 한정, org 필터 직접 명시
## 핵심 모듈 — 중복 구현 금지
lib/crypto.ts — AES-256-GCM 암/복호화 (Provider Key 전용)
lib/cost.ts — 비용 계산 calculateCost(provider, model, usage). 동기 함수 — DB 가격은 lib/model-prices-cache.ts가 백그라운드로 stale-while-revalidate 갱신 (5분 TTL)
lib/model-prices-cache.ts — getCachedPrices() 동기 lookup + refreshPricesNow() 강제 갱신. FALLBACK_PRICES 콜드스타트 안전망. 핫 패스에서 await 금지
lib/logger.ts — 비동기 로깅 logRequestAsync(data) + parseLogBodyMode(header). CH INSERT 실패 시 Supabase `requests_fallback` 큐에 자동 보관 (P2.6)
lib/fallback-replay.ts — `replayFallbackQueue()` / `fallbackQueueSize()`. CH 복구 후 `requests_fallback` → ClickHouse 이관. cron `/replay-fallback` 5분 간격
lib/db.ts — supabaseAdmin / supabaseClient 인스턴스
lib/clickhouse.ts — ClickHouse 싱글톤 + toClickhouseTimestamp() 헬퍼
lib/requests-query.ts — requestsScope / selectRequests / countRequests / getOrgPlan / fetchProviderKeyNames (모든 requests 읽기는 여기 경유)
lib/stats-queries.ts — getStatsOverview / getStatsModels / getStatsTimeseries / getLatencyPercentiles / getSecuritySummary / getUserAnalytics (구 Postgres RPC 대체)
lib/anomaly.ts — detectAnomalies / fetchContributingFactors (구 detect_anomaly_stats / get_anomaly_factors RPC 대체, 인라인 ClickHouse SQL)
lib/pii-mask.ts — maskApiKeys / maskApiKeysInBody (sk-, sk-ant-, sk-proj-, AIza, sl_live_ 패턴 마스킹 — `sl_live_pub_*` 까지 자동 커버)
lib/resolve-prompt-version.ts — X-Spanlens-Prompt-Version 헤더 파싱 (name@version / name@latest / UUID)
middleware/authApiKey.ts — sl_live_* 키 검증 + scope 추출 + organizationId/projectId set (full은 projects join, public은 organization_id 직접). 모든 proxy/ingest/OTLP의 첫 게이트.
middleware/requireFullScope.ts — scope=public이면 403 + `PUBLIC_KEY_WRITE_FORBIDDEN`. authApiKey 다음에 mount해서 write 라우터에만 적용 (proxy/* + ingest/* + OTLP /v1/traces).
middleware/authJwtOrApiKey.ts — `/api/v1/*` read 라우터용 dual-auth. Authorization 헤더가 `Bearer sl_live_*`면 authApiKey + orgId bridge, 그 외엔 authJwt. 기존 read 핸들러는 `c.get('orgId')`만 읽으면 둘 다 호환.
parsers/openai.ts — OpenAI 스트림 파서 (마지막 chunk에 usage)
parsers/anthropic.ts — Anthropic 파서 (message_delta에 usage, OpenAI와 다름!)
parsers/gemini.ts — Gemini 파서
proxy/stream-deadline.ts — `readWithDeadline()` / `makeStreamDeadline()` / `STREAM_DEADLINE_MS=290000`. 3개 proxy의 pump 루프에서 사용. gotcha #11 참고

## X-Spanlens-* 헤더 규약
프록시에서 유저→서버로 오는 내부 metadata는 모두 `x-spanlens-` 접두사. **upstream(OpenAI/Anthropic/Gemini)에 절대 forward 금지** — `proxy/utils.ts`의 `STRIP_PREFIXES`에서 일괄 제거. 현재 쓰이는 헤더:
- `x-trace-id`, `x-span-id` — 에이전트 트레이싱 (접두사 안 붙지만 같은 정책)
- `x-spanlens-project` — 프로젝트 scoping
- `x-spanlens-prompt-version` — Prompts A/B 링크 (SDK `withPromptVersion()` 헬퍼 또는 `observeOpenAI({ promptVersion })`로 자동 세팅)
- `x-spanlens-user`, `x-spanlens-session` — 고객 측 end-user / session 식별자 (SDK `withUser()` / `withSession()`)
- `x-spanlens-log-body` — `full | meta | none`. 고객이 body 저장 수준 제어. `meta`는 request_body/response_body만 빈 문자열, `none`은 거기에 더해 `user_id`/`session_id`까지 null로 저장. SDK `withLogBody()` 또는 `observeOpenAI({ logBody })`. 서버는 `logger.ts`의 `parseLogBodyMode`로 파싱 — 알 수 없는 값은 보수적으로 `full`로 폴백 (기존 동작 유지). 자동 PII 마스킹은 의도적으로 안 함 — 고객이 끄는 게 가장 안전.

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
   - app.ts에서 mount 순서 주의: `/api/v1` wildcard 라우터(evalsRouter/humanEvalsRouter) **뒤**에 mount하면 wildcard authJwt가 먼저 잡아 dual-auth 무력화 (recommendations 사고 패턴, 2026-06-04 발견)
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
- `https://spanlens-web.vercel.app` (Vercel default)
- `http://localhost:3000` (local dev)
- `https://spanlens-*-sunes26s-projects.vercel.app` (preview — 정규식 매치)

새 도메인(예: 별칭 `api.spanlens.io`, 파트너 제공 서브도메인) 추가 시 **CORS allowlist도 동시 수정** → 서버 재배포 필요.
## Known Gotchas — AgentOps 특유의 함정
1. 스트리밍 토큰 0: Anthropic usage는 message_delta에 있음 (OpenAI는 마지막 chunk). parsers/anthropic.ts 확인.
2. 비용 null: model_prices에 모델 없으면 calculateCost()가 null 반환. 새 모델 추가 시 seeds/model_prices.sql 업데이트. **OpenAI는 응답 body의 `model` 필드를 dated variant(`gpt-4o-mini-2024-07-18`)로 돌려주고 그게 `requests.model`에 저장됨** — 따라서 모델 키로 매칭하는 모든 서버 로직(`lib/cost.ts`, `lib/model-recommend-rules.ts`)은 **exact match + longest boundary-aware prefix** fallback을 써야 함. 새 기능 추가 시 이 패턴 재사용 필수.
3. **🔥 `requests` 테이블은 Supabase에 없음 — ClickHouse 전용 (2026-05-16 Phase 1 완료)**: `supabaseAdmin.from('requests')` 호출 시 컴파일 에러 (types.ts에 더 이상 없음). 모든 읽기는 `apps/server/src/lib/requests-query.ts`의 `selectRequests` / `countRequests` 헬퍼 경유 — 헬퍼가 `organization_id` 격리 + plan retention 필터(`free=14d / pro=90d / team=365d`)를 자동 주입함. 빌링/관리 쿼리(`quota.ts`, `paddle-usage.ts`)는 `requestsScope(orgId, { ignoreRetention: true })`로 retention 우회. 쓰기는 `logger.ts`의 `logRequestAsync` 경유. RLS는 없으므로 헬퍼 안 거치고 직접 `getClickhouse().query()` 쓰면 멀티테넌트 데이터 유출 위험 — 직접 호출은 lib 파일에서만, 항상 `organization_id` 필터 명시.
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
   - `SPANLENS_ADMIN_EMAILS` (선택, internal-only routes 사용 시) — Spanlens 내부 운영자 이메일 allowlist (콤마 구분). `/api/v1/admin/*` 경로 접근 권한. 누락 시 모든 admin route 403 (fail-closed). 예: `SPANLENS_ADMIN_EMAILS=haeseong050321@gmail.com`. P2.1에서 `/admin/model-prices`용으로 도입됨.
18. **🔥 ClickHouse DateTime64는 `Z` 접미사 거부 — `toClickhouseTimestamp()` 사용 필수**: `new Date().toISOString()`은 `2026-05-16T11:49:23.749Z`를 반환하는데 ClickHouse는 `2026-05-16 11:49:23.749` 형식만 받음 (`T` → space, `Z` 제거). 직접 INSERT 시 `CANNOT_PARSE_INPUT_ASSERTION_FAILED` 발생. `lib/clickhouse.ts`의 `toClickhouseTimestamp(date)` 헬퍼로 캡슐화됨. 새 ClickHouse 쓰기 코드 작성 시 직접 `.toISOString()` 쓰지 말고 헬퍼 경유. 읽기에서 ClickHouse가 반환한 DateTime64 문자열을 JS Date로 파싱할 때는 반대로 `T`/`Z` 다시 붙여야 함 (`stale-key-digest.ts`, `providerKeys.ts` 참고).
19. **🔥 ClickHouse JSONEachRow는 모든 숫자를 string으로 반환 — `Number()` 변환 필수**: `Decimal(18, 8)` (cost_usd), `UInt64` (count), JSON 결과의 numeric 컬럼은 전부 string으로 옴. `r.cost_usd + 1` 하면 `"0.001" + 1 = "0.0011"` 같은 문자열 concat 버그 발생 (silent). API boundary에서 항상 `Number(r.cost_usd ?? 0)`로 강제 변환. `selectRequests<T>` 호출자도 row를 그대로 응답에 흘리면 클라이언트가 string으로 받음 — 반드시 `.map(r => ({ ...r, cost_usd: Number(r.cost_usd) }))` 패턴 적용.
20. **ClickHouse `ilike` 없음 — `positionCaseInsensitive(col, 'x') > 0` 사용**: Supabase의 `.ilike('model', '%gpt%')` 직역하면 ClickHouse는 `ilike` 함수 자체가 없음. 대신 `positionCaseInsensitive(model, 'gpt') > 0` (substring 매치) 또는 `match(col, '(?i)pattern')` (regex). 또 `nullsFirst: false` → `ORDER BY col DESC NULLS LAST`. 마이그레이션 시 빠짐없이 치환.
21. **🔥 ClickHouse 컬럼 추가 마이그레이션은 deploy 전 실행 — `input_format_skip_unknown_fields=1` 안전망 켜져있음 (2026-05-19 P2.2 hotfix)**: 코드에서 새 컬럼에 INSERT 시작하는데 production CH에 컬럼 없으면 기본 동작은 `Unknown field 'X'` 에러로 **모든 INSERT 실패** — streaming/non-streaming 가리지 않고 전 로그가 사라짐. P2.2 `truncated` 컬럼 추가 시 이 함정 식별됨. `lib/clickhouse.ts`의 `input_format_skip_unknown_fields: 1` 설정이 새 컬럼을 silently skip해서 deploy → migration 사이 window를 보호함. **부작용 — 컬럼명 typo도 silent skip되므로 새 컬럼 작성 시 로컬에서 `pnpm ch:migrate` + 실제 INSERT 한 번 돌려보고 dashboard에서 값이 들어왔는지 확인 필수**. 권장 순서: ① migration PR 먼저 머지+production 적용 → ② INSERT 코드 PR 머지. 동시 PR이면 migration 적용을 deploy 직후 즉시 실행.
22. **🔥 `toLocaleDateString()` / `toLocaleString()` locale 미지정 시 React #418 hydration mismatch**: locale 인자 없으면 환경 기본값을 따르는데, Vercel iad1 Node는 `en-US` → `"5/18/2026"`이고 한국 사용자 Chrome은 `ko-KR` → `"2026. 5. 18."` → 같은 ISO 입력에 출력이 달라서 React가 SSR HTML과 client 첫 paint 사이 text mismatch 감지 → minified `#418` throw. **무료 plan에서는 활성 구독 데이터 없어서 안 보이다가 첫 production 결제 직후 발현**되는 형태로 launch readiness 검증을 통과해서 production 발견됨 (PR #70). 해결: `toLocaleDateString('en-US', { year, month: 'short', day })` 같이 명시적 locale + format 고정 → deterministic 출력. `lib/utils.ts`의 `formatDate()` 헬퍼 재사용. 새 SSR-rendered 날짜/숫자 포맷팅 시 locale 명시 필수 — TypeScript는 `toLocaleString()`의 인자 누락을 잡아주지 않음.
23. **ClickHouse INSERT 실패는 더 이상 silent loss 아님 — `requests_fallback` 큐로 자동 보존 (P2.6, 2026-05-19)**: `lib/logger.ts`가 CH `insert()` throw 시 Supabase `requests_fallback` 테이블에 INSERT(payload jsonb + retry_count + last_error). cron `/cron/replay-fallback`이 5분마다 batch 50개씩 CH로 이관. 7일 또는 100회 retry 후 만료. **새 ClickHouse 컬럼 추가 시 logger.ts와 동시 업데이트 필수** — payload 필드 누락은 fallback에서 CH 이관 시 silent skip (gotcha #21의 `input_format_skip_unknown_fields=1` 때문). 운영 시 `/health/deep` 응답의 `fallback.queue` 값이 비정상 (>1000) 모니터링 권장. `requests` 테이블에 UNIQUE 제약 없어서 race로 인한 중복 INSERT 가능성 있음 — 현재는 trade-off 수용 (단순 2-step flow), 노출되면 outbox 패턴으로 재설계.
24. **🔥 Vercel KV(Upstash Free 티어)에서 raw `redis.set()`은 silent reject — Lua script만 persist**: 2026-05-19 Step #4 SWR 캐시 시도 중 발견. `@upstash/redis`로 `redis.set(key, value, { ex: N })` 호출 시 (1) Upstash MONITOR에 SET 명령 도달, (2) SDK는 "OK" 응답을 받음, (3) 그러나 Data Browser에 키가 존재하지 않고 후속 `redis.get(key)`는 즉시 `null` 반환. **같은 인스턴스, 같은 토큰, 같은 코드 경로**에서 `@upstash/ratelimit` (내부적으로 Lua `EVAL` 사용)은 정상 작동 — 차이는 raw 명령 vs Lua script. 라벨 Free / AWS us-east-1 / Global mode에서 재현. 추정 원인: Upstash Free 티어가 Lua가 아닌 직접 write 명령에 대해 silent acceptance만 하고 persist는 안 함 (또는 Vercel KV 통합의 미documented 동작). **새 캐시 도입 시**: (a) Pay-as-you-go 티어 사용 ($0.20/100만 cmd), 또는 (b) helper를 `redis.eval(luaScript, ...)`로 작성해 Lua 경유. PR #106~#110 revert 됨. 향후 캐시 재도입 시 Lua 패턴 채택 또는 Redis provider 교체 검토.
25. **🔥 Postgres 마이그레이션은 코드 deploy 전에 production에 적용되어야 함 — `deploy-server.yml` 워크플로가 migrate → deploy 순서 강제**: 2026-06-04 PLG Loop ② 머지 후 `/api/v1/organizations/me` 가 prod에서 500/404 반환. 원인: 코드가 새 컬럼(`hide_powered_by_badge`)을 SELECT 하는데 production DB에 컬럼이 없었음. Vercel git integration 으로 서버 코드는 자동 배포되지만 `supabase db push --linked` 는 수동이었음 → 코드만 갔고 스키마는 안 따라감. ClickHouse gotcha #21 과 정확히 같은 패턴(스키마 먼저 → 코드 다음). 해결: `.github/workflows/deploy-server.yml` 을 단일 통합 워크플로로 재작성 — Job 1 `migrate` (`supabase db push --linked --include-all`, 멱등) 가 성공해야 Job 2 `deploy` (Vercel) 가 실행. 깨진 마이그레이션은 deploy 자체를 막아서 stale-but-running 상태 유지. 필요 시크릿: `SUPABASE_ACCESS_TOKEN` (account/tokens 페이지), `SUPABASE_DB_PASSWORD` (Project Settings → Database). Web (Vercel git integration) 은 이 순서 밖이라 web → server 간 race는 별도. 다행히 추가성(additive) 마이그레이션만 작성하는 컨벤션 덕분에 web 이 옛 server API 응답을 잠시 받아도 새 필드 undefined 로 graceful degrade. **새 컬럼/테이블 추가 PR 작성 시**: (a) 마이그레이션은 IF NOT EXISTS/ADD COLUMN IF NOT EXISTS 같이 멱등 작성 (b) 컬럼을 NOT NULL + DEFAULT 로 추가해 backfill 자동화 (c) `concurrency: prod-deploy` 그룹 덕분에 빠른 연속 push 도 race 없이 직렬화.

26. **🔥 Dependabot의 pnpm sub-directory entries는 lockfile 갱신 못 함 — root only**: `.github/dependabot.yml`에 `/apps/server`, `/apps/web`, `/packages/sdk` 같은 sub-dir entry를 두면 dependabot이 그 디렉토리의 `package.json`만 bump하고 **root의 `pnpm-lock.yaml`은 못 만짐**. CI 첫 단계 `pnpm install --frozen-lockfile`이 `ERR_PNPM_OUTDATED_LOCKFILE`로 죽어서 typecheck/test 실행 자체가 안 됨. 같은 변경의 root entry (`/`) PR은 lockfile도 같이 갱신되어 통과. 정답: dependabot.yml에 **root 한 entry**만 두고 group을 `update-types: ["minor", "patch"]`로 제한해서 majors 분리. 사고 이력: 2026-06-04 PR #185, #186이 같은 패턴으로 fail → PR #188로 sub-dir entries 제거.

27. **🔥 Dependabot PR description의 update table은 거짓일 수 있음 — 실제 diff 확인 필수**: dependabot의 PR body는 일부 패키지만 listing하면서 실제 변경에는 더 많이 들어가는 경우 있음. 2026-06-04 PR #187 ("all-deps with 27 updates")의 body에는 `typescript`/`@types/node`가 **없었는데** 실제 diff엔 5.x→6.0 + 22.x→25.x가 머지 후 main에 들어가 있었음 (옛 commit에서 들어와 있던 거지만 listing 누락). 그 결과 docker-publish 워크플로우가 `TS2591 Cannot find name 'process'`로 50+ 파일에서 죽음 (PR #190 `apps/server/tsconfig.json`에 `"types": ["node"]` 명시로 fix). **머지 전 PR diff (`gh pr diff <N>`) 직접 확인**하거나, 머지 직후 docker-publish/Vercel deploy 같은 별도 build path가 깨지는지 모니터.

28. **🔥 `apps/server/tsconfig.json`에 `"types": ["node"]` 명시 필수 — Dockerfile `--filter server` install + TS 6 + @types/node 25 조합에서 자동 lookup 실패**: 로컬 monorepo install은 root에서 모든 workspace의 `@types/*`를 hoist해서 default behavior로 `@types/node` 자동 include. Dockerfile은 `pnpm install --frozen-lockfile --filter server`라 narrower hoist tree → TS 6 / @types/node 25 환경에서 `process`, `node:crypto`, `NodeJS` 못 찾음. 해결: tsconfig `compilerOptions.types: ["node"]`로 명시. Vercel server deploy는 별도 build path라 영향 없고 docker-publish만 깨지는 패턴이라 발견 늦음.

29. **`mcp-publisher init`의 부수효과 — CWD에 `LICENSE` + `README.md` 생성/덮어쓰기**: `npx mcp-publisher init`은 `server.json` 만들 때 같은 디렉토리에 자기 binary가 따라오는 LICENSE와 함께 modelcontextprotocol/registry repo의 README를 fetch해서 떨어뜨림. 기존 패키지의 README가 통째로 덮어쓰여서 git diff에 큰 변경 발생 — 발견 못 하고 commit하면 패키지 README가 registry README로 바뀐다. **mcp-publisher binary + LICENSE + tar.gz는 `.gitignore`에 추가** (`packages/mcp-server/.gitignore` 참고). `init` 후 항상 `git status`로 의도치 않은 파일 검증.

30. **MCP Registry는 GitHub org publish 시 **public membership** 필요**: `mcp-publisher publish`가 `io.github.<org>/...` namespace에 publish하려 할 때 GitHub API로 org membership을 확인. 멤버십이 private면 403 `You have permission to publish: io.github.<your-username>/*. Attempting to publish: io.github.<org>/...`. 해결: GitHub `Organizations` 설정에서 본인 멤버십을 Public으로 전환 (https://github.com/orgs/<org>/people → 본인 옆 visibility) → mcp-publisher **logout + re-login**으로 토큰 재발급. 사고 이력: 2026-06-04 첫 publish 시도에서 발생.

31. **MCP Registry description 100자 제한**: server.json의 `description`이 100자를 초과하면 publish 시 `422 expected length <= 100`. npm package.json은 길어도 OK이지만 registry는 stricter. 발견 시점에는 description 137자였음. 짧고 핵심만 — 사용자가 registry 검색 결과에서 바로 use case 인지하도록 작성.

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
- 발행:
  - npm: `git tag mcp-server-v<X.Y.Z> && git push --tags` → `.github/workflows/publish-mcp-server.yml`이 자동 publish.
  - MCP Registry: `cd packages/mcp-server && mcp-publisher login github && mcp-publisher publish` (수동, OAuth 필요). `mcpName: io.github.spanlens/mcp-server`로 등재됨.
- `server.json` (registry metadata) + `package.json`의 `mcpName` 필드를 동시에 유지. 미스매치면 registry verifier가 reject.
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
## 커밋 규칙
Conventional Commits: type(scope): description
type: feat | fix | refactor | perf | test | docs | chore
scope: web | server | sdk | db | proxy
예: feat(proxy): add anthropic streaming support
