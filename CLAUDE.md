# CLAUDE.md — AgentOps (가칭 · 정식명: Spanlens)
<!--
Claude Code 작업 지침서
리서치 기반: Helicone CLAUDE.md + Langfuse AGENTS.md + Anthropic Best Practices
3회 검증 완료 (2026.04)
-->
## 프로젝트
LLM 개발자를 위한 AI 관측 플랫폼 (클라우드 SaaS, 소스코드 비공개).
baseURL을 1줄 교체해 요청 로깅, 비용 추적, 에이전트 트레이싱 제공.
타깃: Helicone(인수됨)·Langfuse(복잡함)의 대안. Docker 이미지로 셀프호스팅 지원.
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
DB 쓰기(로깅) → supabaseAdmin (service_role, RLS bypass)
DB 읽기(조회) → supabaseClient (anon key, RLS 적용)
두 미들웨어 절대 혼용 금지.
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
parsers/openai.ts — OpenAI 스트림 파서 (마지막 chunk에 usage)
parsers/anthropic.ts — Anthropic 파서 (message_delta에 usage, OpenAI와 다름!)
parsers/gemini.ts — Gemini 파서
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
8. **🔥 Vercel Edge fire-and-forget 금지 — 반드시 `fireAndForget()` 사용**: `logRequestAsync(...).catch(console.error)` 패턴은 **Vercel Edge runtime에서 pending promise를 통째로 drop**함 → 프록시 200 응답은 내려가는데 DB `requests` INSERT 조용히 사라짐. 로컬 Node dev / 직접 curl은 우연히 성공해서 테스트에 안 잡히고 production에서만 데이터 유실 — 가장 위험한 종류의 버그. 해결: `apps/server/src/lib/wait-until.ts`의 `fireAndForget(c, promise)` 사용 (`@vercel/functions` `waitUntil` 래퍼, Edge+Node 모두 drain 보장). `c.executionCtx`는 Hono getter가 없는 환경에서 **접근만 해도 throw**하므로 직접 쓰지 말 것. proxy/openai.ts, anthropic.ts, gemini.ts 참고.
   - **`apps/server/api/index.ts`는 Node runtime 유지 (`maxDuration = 60`)**: 원래 Edge였는데 긴 OpenAI 요청(>25s)에서 504 FUNCTION_INVOCATION_TIMEOUT 났음. Node는 Hobby 60s / Pro 300s 제공. Hono `app.fetch`는 Web 표준이라 runtime 전환해도 코드 변경 불필요. Edge 도로 바꾸지 말 것.
9. **고객 mock 모드 무한 폴백**: 일부 고객 앱이 API 키 없을 때 "mock 응답 200 반환" 패턴 씀 (예: mind-scanner route.ts). 환경변수 누락 시 **에러 안 내고 조용히 가짜 응답 → 유저는 AI 작동하는 줄 착각**. 온보딩 시 Vercel env 추가 후 `/requests` 대시보드에 실제 row 들어오는지 반드시 검증.

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
