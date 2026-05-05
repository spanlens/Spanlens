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
/proxy/* 경로 → authApiKey 미들웨어 (API Key SHA-256 해시 검증)
/api/* 경로 → authJwt 미들웨어 (Supabase JWT)
/api/v1/me/key-info → authApiKey (CLI introspection — JWT 없이 sl_live_* 만 검증)
DB 쓰기(로깅) → supabaseAdmin (service_role, RLS bypass)
DB 읽기(조회) → supabaseClient (anon key, RLS 적용)
두 미들웨어 절대 혼용 금지.

### 통합 키(unified key) 모델 — 2026-05-05부터
- `api_keys.provider_key_id` **컬럼 없음** (마이그레이션 20260505040000_unified_keys로 제거).
- `sl_live_*` 키는 **프로젝트 단위**로 발급되고 provider-agnostic. provider는 request URL path
  (`/proxy/openai/...` vs `/proxy/anthropic/...` vs `/proxy/gemini/...`)에서 추론.
- `provider_keys.project_id`는 **NOT NULL** — 모든 provider AI key는 명시적으로 한 프로젝트에 속함.
  org-level fallback row 사라짐.
- 같은 `(project_id, provider)`에 active=true 키 1개만 허용 (UNIQUE INDEX).
- 새 provider key 발급/조회: `apps/server/src/api/providerKeys.ts` (`/api/v1/provider-keys`).
- 새 Spanlens key 발급/조회: `apps/server/src/api/apiKeys.ts` (`/api/v1/api-keys`) — provider 정보 더 이상 안 받음.
## 보안 규칙 — IMPORTANT (위반 시 보안 사고)
1. Provider Key(실제 OpenAI/Anthropic key) 절대 로그 출력 금지
2. Provider Key 복호화: apps/server/src/lib/crypto.ts의 aes256Decrypt()만 사용
3. 복호화 key는 fetch() Authorization 헤더에만 즉시 사용, 변수 저장 최소화
4. DB 저장 전 request_body에서 Authorization 헤더 제거 필수
5. 스트리밍: body.tee()로 복사, 원본 스트림 즉시 클라이언트 반환
## DB 작업 규칙
- 새 테이블 추가 시 반드시: ALTER TABLE t ENABLE ROW LEVEL SECURITY;
- 기존 마이그레이션 파일 수정 금지 → 새 파일 추가 (YYYYMMDDHHMMSS_desc.sql)
- supabase/types.ts 직접 수정 금지 → supabase gen types 사용
- 마이그레이션 실행 후 반드시 supabase gen types 재실행
## 핵심 모듈 — 중복 구현 금지
lib/crypto.ts — AES-256-GCM 암/복호화 (Provider Key 전용)
lib/cost.ts — 비용 계산 calculateCost(provider, model, usage)
lib/logger.ts — 비동기 로깅 logRequestAsync(data)
lib/db.ts — supabaseAdmin / supabaseClient 인스턴스
lib/resolve-prompt-version.ts — X-Spanlens-Prompt-Version 헤더 파싱 (name@version / name@latest / UUID)
parsers/openai.ts — OpenAI 스트림 파서 (마지막 chunk에 usage)
parsers/anthropic.ts — Anthropic 파서 (message_delta에 usage, OpenAI와 다름!)
parsers/gemini.ts — Gemini 파서

## X-Spanlens-* 헤더 규약
프록시에서 유저→서버로 오는 내부 metadata는 모두 `x-spanlens-` 접두사. **upstream(OpenAI/Anthropic/Gemini)에 절대 forward 금지** — `proxy/utils.ts`의 `STRIP_PREFIXES`에서 일괄 제거. 현재 쓰이는 헤더:
- `x-trace-id`, `x-span-id` — 에이전트 트레이싱 (접두사 안 붙지만 같은 정책)
- `x-spanlens-project` — 프로젝트 scoping
- `x-spanlens-prompt-version` — Prompts A/B 링크 (SDK `withPromptVersion()` 헬퍼 또는 `observeOpenAI({ promptVersion })`로 자동 세팅)

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
3. 인증 미들웨어 → /api/* 는 authJwt, /proxy/* 는 authApiKey 반드시 확인
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
3. RLS 차단: anon 클라이언트로 INSERT → 403. 로깅은 반드시 supabaseAdmin 사용.
4. spans FK 없음: spans.parent_span_id는 FK 제약 없음 (의도적). 에이전트 병렬 span 지원. 직접 FK 추가 금지.
5. 복호화 빈 문자열: ENCRYPTION_KEY 불일치 시 에러 대신 빈 문자열 반환 가능. 복호화 결과 항상 length 체크.
6. Paddle webhook `transaction.completed`: billing period 필드 없음. `fetchPaddleSubscription(sub_id)`로 Paddle API에서 보강해야 `current_period_start/end` 채워짐. `subscription.*` 이벤트는 `custom_data` 없을 수 있어 `paddle_customer_id` fallback 필수. paddleWebhook.ts 참고.
7. Paddle Billing "호스티드 체크아웃" ≠ Stripe: `tx.checkout.url`은 항상 우리 도메인 + `_ptxn=txn_xxx`. 반드시 `@paddle/paddle-js` 오버레이로 열어야 함. `checkout.url`을 요청 바디에 넣지 말 것 — overlay 모드 전용 파라미터라 호스티드 체크아웃 경로 깨뜨림.
7a. **Paddle overage/usage 청구**: `POST /subscriptions/{id}/adjust` 엔드포인트 **존재하지 않음.** Spanlens는 `/subscriptions/{id}/charge` 사용 (`lib/paddle-charge.ts`). `action: 'credit'`은 **고객 환불 방향** — overage 청구엔 `effective_from: 'next_billing_period'` + 일반 items만 씀 (action 필드 없음). 이 경로 변경 시 반드시 `subscription_overage_charges` 테이블 멱등성 3-state flow (pending → charged/error) 유지 — 중간 크래시에서도 이중 청구 안 나게 설계됨.
8. **🔥 Vercel Edge fire-and-forget 금지 — 반드시 `fireAndForget()` 사용**: `logRequestAsync(...).catch(console.error)` 패턴은 **Vercel Edge runtime에서 pending promise를 통째로 drop**함 → 프록시 200 응답은 내려가는데 DB `requests` INSERT 조용히 사라짐. 로컬 Node dev / 직접 curl은 우연히 성공해서 테스트에 안 잡히고 production에서만 데이터 유실 — 가장 위험한 종류의 버그. 해결: `apps/server/src/lib/wait-until.ts`의 `fireAndForget(c, promise)` 사용 (`@vercel/functions` `waitUntil` 래퍼, Edge+Node 모두 drain 보장). `c.executionCtx`는 Hono getter가 없는 환경에서 **접근만 해도 throw**하므로 직접 쓰지 말 것. proxy/openai.ts, anthropic.ts, gemini.ts 참고.
   - **`apps/server/api/index.ts`는 현재 Node runtime (`runtime = 'nodejs'`, maxDuration 40s)** — 2026-04-27 3F 완료. Node 전환 과정에서 두 가지 어댑터가 모두 실패했으니 재사용 금지: ① `hono/vercel` `handle()` — Edge 전용; Node에서는 `IncomingMessage`를 Hono에 그대로 넘겨 `headers.get()` TypeError 발생 ② `@hono/node-server` `getRequestListener` — `Readable.toWeb(incoming)`을 lazy `pull()` 안에서 호출해 Vercel Node.js에서 stream 'end'가 신뢰성 있게 발생 안 함 → `c.req.json()` 영원히 hang → 40s timeout. **정답: `apps/server/api/index.ts`의 커스텀 핸들러 패턴** (`for await (const chunk of req)`로 body 먼저 버퍼링 후 `new Request()` 직접 생성). 이 파일 교체 시 반드시 이 패턴 유지.
9. **고객 mock 모드 무한 폴백**: 일부 고객 앱이 API 키 없을 때 "mock 응답 200 반환" 패턴 씀 (예: mind-scanner route.ts). 환경변수 누락 시 **에러 안 내고 조용히 가짜 응답 → 유저는 AI 작동하는 줄 착각**. 온보딩 시 Vercel env 추가 후 `/requests` 대시보드에 실제 row 들어오는지 반드시 검증.
10. **🔥 SDK ingest POST 순서 race — `_creationPromise` chain 필수** (2026-04-23 sdk@0.2.3에서 fix됨): `createTrace` / `createSpan`이 fire-and-forget POST를 동시 발사하면, 서버의 `POST /ingest/traces/:id/spans`가 trace 소유권 확인(`ingest.ts:184`)할 때 trace INSERT 아직 commit 안 돼서 **404 silent fail** → span 영영 안 생김 → 23초 후 도착한 `PATCH /ingest/spans/:id`도 row 없어 silent no-op → 대시보드 `Spans: 0, Tokens: 0`. 짧은 trace(<3s)는 우연히 통과해서 테스트에 안 잡힘. 해결: TraceHandle/SpanHandle에 `_creationPromise` 보관, 자식 span POST는 부모의 promise 후 chain, `end()` PATCH도 자기 promise 후 chain. 사용자 코드는 LLM wait 동안 chaining 끝나서 영향 없음. **새 ingest endpoint(`/ingest/events`, `/ingest/feedback` 등) 추가 시 동일 패턴 재사용 필수** — 새 handle 클래스도 `_creationPromise` 노출 + `end()` 류 메서드는 await 후 PATCH.
11. **Spanlens 프록시 timeout — 현재 Node runtime, maxDuration 40s**: `apps/server/api/index.ts`는 2026-04-27부터 Node runtime (maxDuration 40s). 이전 Edge 25s 한계는 해소됨. 40s 넘는 요청(JSON mode + 매우 큰 `max_tokens`)은 여전히 **internal streaming** 패턴 권장 — 서버가 `stream:true`로 OpenAI 호출(첫 byte ~200ms), chunk 누적, 클라이언트엔 단일 JSON 반환. 참고 구현: mind-scanner `app/api/analyze/route.ts`. maxDuration은 `apps/server/vercel.json`의 `functions["api/index.ts"].maxDuration`에서 조정 (Pro plan 최대 300s). Node 어댑터 교체 시 **gotcha #8 필독** — `hono/vercel handle()` · `getRequestListener` 모두 실패 확인됨, 커스텀 핸들러 패턴만 정답.
12. **🔥 `lib/crypto.ts`의 모든 함수는 async — `await` 빠뜨리면 Promise 객체가 그대로 DB로 들어감**: `randomHex`만 sync고 `sha256Hex` / `aes256Encrypt` / `aes256Decrypt`는 전부 Web Crypto API 기반의 `Promise<string>` 반환. `const keyHash = sha256Hex(rawKey)` 처럼 `await` 빼면 keyHash는 Promise 객체가 되고, JSON 직렬화 시 `"[object Promise]"` 문자열로 INSERT됨 → 이후 인증 매칭 영영 실패 (silent break). bootstrap에서 신규 가입자 첫 API key가 통째로 깨지는 형태로 발견 (commit dcab522). 새 코드에서 이 함수들 호출 시 **타입 시스템이 잡아주지 못하는 영역**이라 (string concat이나 JSON.stringify 안에서 await 안 붙은 Promise를 자동 toString 처리) 손으로 검토 필요.
13. **`lib/crypto.ts` 헬퍼 사용 권장 — 이식성·일관성**: `apps/server/api/index.ts`는 현재 Node runtime이라 `node:crypto` 사용 가능. 그러나 **`lib/crypto.ts`의 헬퍼(`randomHex`, `sha256Hex`, `aes256Encrypt`, `aes256Decrypt`)를 쓸 것** — Web Crypto API 기반이라 Edge 재전환 시에도 무수정 호환. 과거 invitations.ts에서 `node:crypto` 직접 import 했다가 Edge 빌드 reject된 이력 있음 (commit 0b5470b). 신규 보안/암호화 코드는 `lib/crypto.ts` 헬퍼 재사용 필수.
14. **`org_members` RLS 정책은 self-reference 금지 — `42P17` infinite recursion**: 정책의 USING절이 같은 테이블을 SELECT하면 PostgreSQL이 query 자체를 reject. 안 좋은 예: `USING (organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()))`. 좋은 예: `USING (user_id = auth.uid())` 또는 SECURITY DEFINER 함수로 우회. 서버는 supabaseAdmin (service_role)로 RLS bypass라 모르고 넘어가다가 클라이언트 직접 select 시점에 깨짐. fix는 commit 8cfc1c7의 `20260425130000_fix_org_members_rls_recursion.sql`. 새 RLS 정책 작성 시 기준 테이블을 USING절에서 SELECT하지 말 것.
15. **🔥 Onboarding/dashboard 사이 navigation은 `window.location.href` 필수 — `router.push`는 RSC tree 캐시 유지**: Next.js의 `router.push('/dashboard')`는 client navigation이라 layout이 **이전 요청의 헤더로 평가**됨. onboarding step 2에서 `POST /me/profile/complete`로 `onboarded_at` 저장 직후 `router.push('/dashboard')` 하면, dashboard layout이 옛 `x-spanlens-onboarded` 헤더 (없는 상태)로 평가 → `redirect('/onboarding')` → 무한 루프. 해결: **`window.location.href = '/dashboard'`**로 hard reload (middleware 강제 재평가). 같은 패턴 적용 곳: 워크스페이스 스위치 (sidebar.tsx), 초대 accept (invite/page.tsx + pending-invitations-banner.tsx), onboarding 완료 (onboarding/page.tsx).
16. **Postgres 17 (config.toml) — production이 17로 업그레이드됨**: `supabase/config.toml`의 `major_version`은 **17**로 맞춰져있어야 함. 로컬 stack을 처음 띄우거나 변경 후엔 `supabase stop && supabase start`로 새 컨테이너 부팅 (major version은 기존 컨테이너 재사용 안 함). `supabase link` 시 "Local database version differs" 경고 뜨면 이 값 확인.
17. **새 환경변수 3개 (server) — production에 누락 시 invite 기능 절반 죽음**:
   - `WEB_URL` (필수, prod) — `https://www.spanlens.io`. 초대 이메일 accept 링크의 base URL. 누락 시 `http://localhost:3000` fallback → 사용자가 받은 링크 못 누름.
   - `RESEND_API_KEY` (선택) — Resend 토큰. 없으면 `lib/resend.ts`가 silent하게 발송 스킵하고 콘솔에 dev URL 출력. API 응답에는 `devAcceptUrl`이 들어감 (admin이 수동 전달 가능).
   - `RESEND_FROM` (선택) — 발신자 표시. Default `Spanlens <notifications@spanlens.io>`. 도메인 미인증 상태면 spam함 직행이라, Resend Domains에서 인증 후 `RESEND_FROM=Spanlens <notifications@mail.spanlens.io>` 같이 명시 권장. spanlens.io 자체는 이미 Verified (2026-04-25). DMARC는 `_dmarc` TXT 레코드 별도 추가 필요 (가비아 DNS).

## CI/CD Gotchas — GitHub Actions + npm + Docker
1. **setup-node@v4 + registry-url → NPM_CONFIG_USERCONFIG shadow**: setup-node가 `NPM_CONFIG_USERCONFIG` env var를 자체 `.npmrc`로 설정. 패키지 디렉토리에 쓴 `.npmrc`가 무시됨. 해결: workflow에서 `unset NPM_CONFIG_USERCONFIG && npm publish --userconfig "$PWD/.npmrc"` + setup-node에서 `registry-url` 제거.
2. **npm Granular token의 "새 scope" 제약**: 이전 기록("새 패키지 첫 publish 불가")은 부정확. 정확히는 **scope 자체가 존재하지 않으면** Granular token의 첫 publish가 실패함. 한 번 scope가 만들어지면 그 scope 내의 **다른 새 패키지**는 Granular token으로 CI publish 가능. 증거: `@spanlens/sdk` 첫 publish는 로컬 `npm login` 세션 필요했지만, 이후 `@spanlens/cli` 신규 패키지는 Granular token CI workflow로 정상 publish됨. Classic token UI는 npm이 숨겼지만 `npm token create --packages-all --packages-and-scopes-permission=read-write --bypass-2fa`로 CLI에서 생성 가능.
3. **토큰 유출 없이 secret 전달 검증**: workflow에 `echo "NPM_TOKEN length: ${#NPM_TOKEN}"` 넣으면 값 노출 없이 secret이 injection 됐는지 확인 가능. 길이가 예상과 다르면 사용자가 다른 토큰을 넣었거나 빈 값.
4. **Chrome MCP의 `form_input`은 React controlled input에서 실패 가능**: "Set value to X" 성공 메시지 떠도 React state엔 반영 안 될 수 있음. GitHub Secrets 같은 보안 폼은 **저장 직후 목록 페이지에서 이름 실제로 보이는지 재검증 필수**. 저장 안 된 걸 모르고 진행 → CI 시도 → ENEEDAUTH 디버깅 지옥.
5. **Docker 빌드 `.dockerignore`의 `apps/web` 제외**: 루트에서 multi-stage 빌드 시 pnpm workspace 때문에 `apps/web/package.json`은 필요함. `apps/web` 제외하되 `!apps/web/package.json`으로 예외 허용. 안 그러면 `failed to compute cache key: "/apps/web/package.json": not found`.
6. **Windows cmd의 `rm -rf` 미지원**: `package.json`의 `"clean": "rm -rf dist"`는 Linux CI에선 OK지만 로컬 Windows 수동 publish 시 실패. `npm publish --ignore-scripts`로 `prepublishOnly` 훅 우회하거나, cross-platform `rimraf` 사용.
7. **`vercel deploy` CLI 접근 불가 시**: Claude의 bash 환경에서 `/dev/tty` 없어서 git push 프롬프트 블록. credential manager가 캐시한 뒤엔 정상. 대안: 빈 커밋으로 webhook 트리거 `git commit --allow-empty && git push`.
## 금지 사항
- git reset --hard 금지
- generated/ dist/ .next/ supabase/types.ts 직접 수정 금지
- 기존 supabase/migrations/*.sql 파일 수정 금지
- apps/web에서 Supabase 직접 접근 금지 (반드시 /api/ 경유)
- console.log에 key/secret/token 포함 금지
- pnpm 외 패키지 매니저 사용 금지
- lib/cost.ts, lib/crypto.ts 함수 다른 곳에 재구현 금지
## 커밋 규칙
Conventional Commits: type(scope): description
type: feat | fix | refactor | perf | test | docs | chore
scope: web | server | sdk | db | proxy
예: feat(proxy): add anthropic streaming support
