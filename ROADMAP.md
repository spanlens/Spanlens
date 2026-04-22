# Spanlens (AgentOps) ROADMAP

> LLM 관찰성 SaaS · 100일 MVP · 런치 목표 2026.08.03 (Phase 4)
> 수익 모델: Free / Starter $19 / Team $49 / Enterprise $99
> 100일 현실 목표: 가입 500명, 유료 200명, MRR $3,800
> 전략: Growth 기능(Phase 3)을 쌓은 **뒤** Product Hunt 런치. 런치 시점에 차별화 스토리 최대화.

---

## Phase 0 — 초기 셋업 (Week 0, ~2026.04.27)

프로젝트 기반 구축. 코드 한 줄 쓰기 전에 인프라부터.

### 성공 기준 체크리스트
- [x] pnpm monorepo 초기화 (`apps/web`, `apps/server`, `packages/sdk`, `supabase/`)
- [x] Next.js 14 (App Router) + Tailwind + shadcn/ui 부트스트랩
- [x] Hono 서버 부트스트랩 (포트 3001, `/health` 엔드포인트)
- [x] Supabase 로컬 실행 (`supabase start`) 성공 — Docker 필요, 수동 확인 필요
- [x] TypeScript strict mode, ESLint, Prettier 설정
- [x] Vitest 테스트 러너 설정 + 15개 테스트 통과 (cost, crypto, parsers)
- [x] `.env.example` 작성 (SUPABASE_*, ENCRYPTION_KEY, PORT)
- [x] GitHub 비공개 레포 + CI (typecheck + lint + test + build) — `.github/workflows/ci.yml` 그린
- [x] Vercel 프로젝트 연결 (web) — ENABLE_EXPERIMENTAL_COREPACK=1 + pnpm@10.33.0, 배포 READY
- [x] **로컬 개발용** `docker-compose.yml` (server + supabase) — 공식 셀프호스팅 이미지는 Phase 2C
- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과

---

## Phase 1 — MVP Foundation (Week 1~4, ~2026.05.25)

핵심 프록시 + 대시보드. "요청 로깅 + 비용 추적" 단일 가치 제공.

### 1A. DB 스키마 (Week 1)
- [x] 마이그레이션: `organizations`, `projects`, `api_keys`, `provider_keys`
- [x] 마이그레이션: `requests`, `model_prices`, `usage_daily`, `audit_logs`
- [x] 모든 테이블 `ENABLE ROW LEVEL SECURITY` + 정책 작성 (`is_org_member()` SECURITY DEFINER)
- [x] `seeds/model_prices.sql` (OpenAI, Anthropic, Gemini 주요 모델)
- [x] `supabase gen types` 성공, `supabase/types.ts` 생성 — Supabase MCP(`generate_typescript_types`)로 프로덕션 스키마에서 직접 생성 완료 (8 테이블)
- [x] Supabase Auth (이메일 + Google OAuth) 활성화 — 대시보드에서 설정 완료

### 1B. 프록시 서버 — 논스트리밍 (Week 2)
> 스트리밍은 Week 3으로 분리 — 난이도가 달라 같은 주에 묶으면 일정 터짐.
- [x] `lib/crypto.ts` AES-256-GCM 암/복호화 + 단위 테스트
- [x] `lib/cost.ts` `calculateCost()` + `model_prices` 조회 + null 처리
- [x] `lib/logger.ts` `logRequestAsync()` fire-and-forget
- [x] `authApiKey` 미들웨어 (SHA-256 해시 검증)
- [x] `/proxy/openai/v1/*` OpenAI passthrough (**stream=false만**) + 비용 계산
- [x] `/proxy/anthropic/v1/*` Anthropic passthrough (**stream=false만**)
- [x] `/proxy/gemini/v1/*` Gemini passthrough (**stream=false만**)
- [x] `request_body` 저장 전 `Authorization` 헤더 제거 — 프록시에서 헤더 strip + body에 포함 안 됨
- [x] 10KB 초과 body → truncate + preview 메타 저장 (`lib/logger.ts`). Supabase Storage 업로드 전체 보존은 Phase 2 확장 항목으로 예정
- [x] **REST API `/api/v1/*`** — orgs, projects, api-keys, provider-keys, requests, stats 라우터
- [x] 프록시 e2e 테스트: 실제 OpenAI 키로 요청→로그 확인 (논스트리밍) — `scripts/test-e2e.ts`, 프로덕션에서 200 OK + 토큰·모델 정상 로깅 확인. Anthropic/Gemini는 provider key 등록 후 동일 스크립트로 검증 가능

### 1C. 대시보드 + 스트리밍 (Week 3)
- [x] **스트리밍 `body.tee()` SSE passthrough + 병렬 파싱** (Week 2에서 이관)
- [x] Anthropic `message_delta` usage 집계 회귀 테스트 — streaming.test.ts 6개 테스트 통과
- [x] 스트리밍 e2e 테스트: OpenAI 프로덕션 검증 완료 (1.5초 응답, usage 정상) — Vercel Edge/Node.js streaming 버그(5분 timeout) 해결 과정에서 `tee()` → `TransformStream` → 최종적으로 `_server/` 번들 → `api/index.ts` 네이티브 함수로 구조 전환. Anthropic/Gemini는 동일 스크립트(`SKIP_*` 제거) + provider key 등록으로 실행 가능
- [x] `authJwt` 미들웨어 (Supabase JWT 검증)
- [x] P1 랜딩 페이지 (Hero + 3-step 온보딩 프리뷰)
- [x] P2 로그인/회원가입 (Supabase Auth UI)
- [x] P3 가격 페이지 (Free / Starter / Team)
- [x] P4~P5 온보딩 (Provider Key 입력 → API Key 발급 → 코드 스니펫)
- [x] P6 메인 대시보드 — 총 요청/비용/토큰 카드 + 시계열 차트 (Recharts)
- [x] P7 요청 로그 목록 — 필터(모델, 시간, 상태), 페이지네이션
- [x] P8 요청 상세 — request/response body, 비용, latency, token 내역
- [x] P10 프로젝트/API Key 관리 (생성·폐기·회전)
- [x] P12 계정 설정 (Provider Key 추가/삭제/로테이션) — 정식 UI
- [x] P14 에러 페이지 (404/500)

### 1D. Phase 1 릴리스 기준 (Week 4)
- [x] 3개 프로바이더(OpenAI/Anthropic/Gemini) 모두 프록시 작동
- [x] 스트리밍/논스트리밍 모두 토큰·비용 정확 집계 (±1% 오차) — 단위 테스트 통과
- [x] 수동 집계 쿼리로 일별 사용량 조회 가능 (cron 자동화는 Phase 2A로 이관)
- [x] 로컬 `docker compose up`으로 개발 스택 부팅 성공 (공식 셀프호스팅 이미지는 Phase 2C)
- [ ] 내부 알파 테스트: 본인 프로젝트 1개를 Spanlens로 1주일 프록시 — 수동 진행 필요
- [x] Known Gotcha 회귀 테스트 (Anthropic usage, 복호화 빈문자열, RLS, 비용 null, dated model suffix) — `src/__tests__/gotcha.test.ts` 6개 + 기존 파서/crypto/cost 테스트 포함 총 29개 그린. `calculateCost()`에 longest-prefix 매칭 추가로 `gpt-4o-mini-2024-07-18` 같은 dated variant도 가격 매칭됨

---

## Phase 2 — Launch Readiness (Week 5~8, ~2026.06.22)

에이전트 트레이싱 + 운영 기능 + 결제 완성. 런치 자체는 Phase 4로 이관 — Growth 기능을 쌓은 뒤 런치해야 Product Hunt 스토리가 강해짐.

### 2A. 에이전트 트레이싱 백엔드 + UI (Week 5~6)
> SDK npm publish는 Week 7로 분리 — 포장 작업(README, 버전, 배포 파이프라인) 따로.
- [x] 마이그레이션: `traces`, `spans` (parent_span_id FK 없음, 의도적) — `20260421000000_agent_tracing.sql` 프로덕션 적용 완료, `refresh_trace_aggregates` 트리거 포함
- [x] `usage_daily` 1시간 cron 배치 집계 — `aggregate_usage_daily(target_date)` PLPGSQL RPC + `/cron/aggregate-usage` 엔드포인트 (CRON_SECRET bearer 인증) + GitHub Actions `cron-aggregate-usage.yml` 매시간 실행. Vercel Hobby plan이 hourly cron 지원 안 해서 GHA로 대체.
- [x] `/api/v1/traces/*` 엔드포인트 (dashboard 조회: list/get) + `/ingest/*` (SDK 쓰기: POST/PATCH traces/spans). 관심사 분리 — 전자는 authJwt, 후자는 authApiKey.
- [x] P9 에이전트 트레이스 화면 — Gantt/waterfall 뷰, pre-order DFS span 트리 + depth 기반 인덴트, spanType별 색상, 선택 시 상세 패널 (tokens/cost/input/output/metadata + `/requests/:id` 딥링크)
- [x] 병렬 span 시각화 — 같은 부모 하에 overlap되는 span들은 같은 depth에서 시간축으로 자연스럽게 병렬 표현됨. LangGraph fan-out 패턴 그대로 처리. (실제 병렬 데이터 재현 테스트는 SDK auto-instrumentation 완료 후 dogfood로 진행 예정)
- [x] SDK `packages/sdk` 내부 구현 — `SpanlensClient.startTrace()`, `TraceHandle.span()`, `SpanHandle.child()`, `.end()`, `observe()` 헬퍼 + README + 13개 테스트 그린. 클라이언트 생성 UUID(idempotent 재시도), fire-and-forget 네트워크, unhandled rejection 방지 포함
- [x] SDK OpenAI/Anthropic/Gemini auto-instrumentation — `observeOpenAI / observeAnthropic / observeGemini` 헬퍼가 span 생성 + `x-trace-id`/`x-span-id` 헤더 주입 + 응답 usage 자동 파싱 + 에러 시 status='error'. 7개 테스트 포함.
- [x] **Paddle(MoR) 통합 기본 골격 (Week 6)** — Sandbox API 클라이언트 + HMAC 서명 검증 webhook + checkout 엔드포인트 + subscriptions 테이블 + 8개 유닛 테스트. 실제 결제 플로우 end-to-end는 Paddle 대시보드에서 Product/Price 생성 + `PADDLE_PRICE_*` 환경변수 설정 후 가능.
> Paddle 프로덕션 KYC 신청은 Phase 2B에서 Sandbox end-to-end 검증 끝난 뒤 진행 (Sandbox 미검증 상태로 심사 올리면 반려 리스크).

### 2B. 운영 기능 + SDK 배포 (Week 7 전반)
- [x] SDK npm publish 준비 — LICENSE(MIT) + CHANGELOG + README에 OpenAI/Anthropic/LangChain/LlamaIndex 통합 예시 + `publish-sdk.yml` Actions 워크플로(`sdk-v*` 태그 or 수동 트리거 시 provenance publish). 실제 `npm publish`는 NPM_TOKEN 시크릿 + `git tag sdk-v0.1.0` 하면 실행.
- [x] SDK LangChain/LlamaIndex 샘플 — README에 복사 가능한 코드 스니펫 포함. 실기기 검증은 dogfood 단계.
- [x] 마이그레이션: `alerts`, `notification_channels`, `alert_deliveries` (`20260421030000_alerts_and_webhooks`)
- [x] P11 알림 설정 UI (`/alerts` 페이지) — alert CRUD + 채널 CRUD + 최근 delivery audit.
- [x] Resend/Slack/Discord notifier (`lib/notifiers.ts`) + `/cron/evaluate-alerts` (15분 주기 GHA) — threshold 넘으면 cooldown 체크 후 모든 활성 채널에 전달 + `alert_deliveries` 기록.
- [x] **P15 In-app Billing/Upgrade 페이지** (`/billing`) — 현재 구독 요약 + 4-plan 카드 + Upgrade → Paddle hosted checkout URL redirect.
- [ ] Paddle 프로덕션 KYC 신청 — Sandbox end-to-end 검증 후 사업자등록증 + 대표 신분증 + 웹사이트 URL + 이용약관 제출.
- [x] Paddle 사용량 기반 overage 인프라 — `lib/paddle-usage.ts` `computeAndReportOverages()` + `/cron/report-usage-overage` (매일 03:30 UTC). Starter/Team 별 overage price ID 환경변수로 주입. 프로덕션 전환은 KYC 통과 후.
- [x] 무료 플랜 리밋 (10K req/mo) + Starter 100K + Team 500K — `/proxy/*`에 `enforceQuota` 미들웨어 + 429 응답 + `X-RateLimit-*` 헤더 + 대시보드 `QuotaBanner` (80% 경고, 100% 차단).
- [x] 로그 보존 정책 (Free 7일 / Starter 30일 / Team 90일 / Enterprise 365일) — `prune_logs_by_retention()` PLPGSQL RPC + `/cron/prune-logs` (매일 03:00 UTC) — requests/traces/alert_deliveries 삭제.

### 2C. Phase 2 완성도 기준 (Week 8, 런치 전 내부 검증)
> 런치 전에 반드시 걸려야 하는 품질 게이트. 런치 자체는 Phase 4.
- [x] Paddle Sandbox end-to-end 검증 (signup → upgrade → Paddle.js 오버레이 → webhook → plan=starter, status=active) — 테스트 카드 `4242 4242 4242 4242` 로 전체 플로우 성공. `transaction.completed` 핸들러가 `fetchPaddleSubscription` 으로 billing period 보강하도록 수정 완료.
- [ ] **Paddle 프로덕션 KYC 통과** + Production price ID 환경변수 전환 — **외부 의존, 유저 작업**. 사업자등록증 + 신분증 + 웹사이트 URL + 이용약관 제출 → 심사 1~2주.
- [ ] 에이전트 트레이싱 **내부 dogfood** 프로젝트 3개+ (본인 프로젝트들을 Spanlens로 관측) — **점진적**. SDK 배포 완료됐으므로 실제 서비스에 연결만 하면 됨. 현재 `projects=1, traces=0`.
- [x] **셀프호스팅 공식 Docker 이미지** `docker pull ghcr.io/sunes26/spanlens-server:latest` 배포 — multi-stage node:22-alpine, non-root user, HEALTHCHECK 포함. `.github/workflows/docker-publish.yml` 로 amd64+arm64 자동 빌드. 3m 43s 소요. (※ GHCR 패키지 public 전환은 유저 수동 작업.)
- [x] 스트리밍/논스트리밍 토큰·비용 ±1% 오차 유지 — server 39 + sdk 28 = 총 67 테스트 그린. OpenAI 프로덕션 streaming e2e 검증 완료.
- [x] SDK npm publish 완료 — `@spanlens/sdk@0.1.0` (로컬 수동 publish) + `@spanlens/sdk@0.1.1` (CI 자동 publish, provenance 포함). `sdk-v*` 태그 푸시 시 `publish-sdk.yml` 자동 실행. LangChain/LlamaIndex 실기기 검증은 dogfood 단계에서 수행 예정.
- [x] 보안: Provider Key 로그 노출 정적 스캔 0건 (test-e2e.ts도 마스킹 처리), RLS 누락 테이블 0건 (`SELECT FROM pg_tables WHERE rowsecurity=false AND schemaname='public'` = 빈 결과).

**Phase 2C 게이트 상태**: 7개 중 5개 완료 (71%), 2개 외부 의존/점진적(KYC, dogfood). 코드 인프라는 런치 준비 완료 → Phase 3 착수 가능.

---

## Phase 3 — Growth (Week 9~12, ~2026.07.20)

이상 탐지 + 팀 기능. Retention 확보 & $3,800 MRR 달성.

### 3A. 이상 탐지 & 최적화 (Week 9~10)
- [x] 모델별 평균 latency/비용 이상치 탐지 (3-sigma) — `lib/anomaly.ts` + `GET /api/v1/anomalies` + `/anomalies` 페이지. 1h 관측 vs 7일 baseline 샘플 stddev.
- [x] 프롬프트 주입·PII 감지 (경량 휴리스틱) — `lib/security-scan.ts` (정규식 6개 PII 규칙 + Luhn + 5개 injection 패턴) 로그 훅 + `requests.flags` JSONB + `GET /api/v1/security/{flagged,summary}` + `/security` 페이지.
- [x] 마이그레이션: `prompt_versions` (프롬프트 버저닝) — `prompt_versions` 테이블 (version immutable, UNIQUE org+name+version) + `requests.prompt_version_id` FK + RLS.
- [x] 프롬프트 A/B 비교 뷰 (비용·성공률·latency) — `lib/prompt-compare.ts` + `GET /api/v1/prompts/:name/compare` + `/prompts` 페이지 (버전별 sample count / avg latency / error rate / avg+total cost / avg tokens).
- [x] 모델 추천 엔진 (GPT-4o → Haiku 대체 제안) — `lib/model-recommend.ts` (curated SUBSTITUTES + 토큰 envelope fit check + 월간 절감액 extrapolation) + `GET /api/v1/recommendations` + `/recommendations` 페이지.
- [x] 테스트: anomaly, security-scan, prompt-compare 모듈 단위 테스트 (server 65 green).

### 3B. 팀 & 협업 (Week 11)
- [ ] P13 팀 관리 — 초대, 역할(Owner/Admin/Member/Viewer)
- [ ] 조직 단위 예산/쿼터
- [ ] SSO 준비 작업 (Team 플랜 상위 제공용)
- [ ] 감사 로그 UI (`audit_logs` 기반)

### 3C. 고도화 (Week 12)
- [ ] Postgres → ClickHouse 이관 옵션 검토 (>10M rows 시)
- [ ] Public API + API 문서 (OpenAPI 스펙 자동 생성)
- [ ] 데이터 export (CSV/JSON) + BigQuery 커넥터 베타
- [ ] Enterprise plan ($99+) 랜딩 페이지 + 문의 폼

### 3D. Phase 3 완성도 기준 (런치 자산 준비 전제)
> Phase 3 기능이 런치 스토리의 차별점. 여기까지 쌓고 Phase 4에서 런치.
- [ ] Growth 기능 3종 작동: 이상 탐지 / 프롬프트 A/B / 모델 추천
- [ ] 팀 초대 & 역할 구조 동작 — 2인 이상 조직 내부 dogfood 완료
- [ ] Public API + OpenAPI 문서 공개
- [ ] 알파 유저 10~20명 waitlist 운영 중 (런치 전 사전 접근 권한)
- [ ] 크리티컬 버그 0건, p95 proxy latency < +50ms (provider 대비)

### 3E. Developer Experience 개선 — 런치 전 필수 (Week 12~13)
> **트리거**: mind-scanner 첫 통합 경험에서 "5단계 온보딩이 복잡하다"는 피드백. Sentry/PostHog/Datadog 수준의 "1분 온보딩"을 Phase 4 런치 마케팅 핵심 카피로 활용 ("`npx @spanlens/sdk init` 한 번으로 설치").

#### 3E.1. SDK 래퍼 함수 — **Option A** (1일 이내)
기존 `baseURL` 수동 설정을 단 한 줄로 축약. 가장 빠른 win.
- [ ] `@spanlens/sdk/openai` 서브경로 export — `createOpenAI()` 헬퍼
  ```ts
  // Before (5줄 + 외우기 힘든 URL)
  const openai = new OpenAI({
    apiKey: process.env.SPANLENS_API_KEY,
    baseURL: 'https://spanlens-server.vercel.app/proxy/openai/v1',
  })
  // After (1줄)
  import { createOpenAI } from '@spanlens/sdk/openai'
  const openai = createOpenAI()
  ```
- [ ] `@spanlens/sdk/anthropic` — `createAnthropic()` 동일 패턴
- [ ] `@spanlens/sdk/gemini` — `createGemini()` 동일 패턴
- [ ] `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`를 **peerDependencies** 로 등록 (SDK 자체 크기 유지)
- [ ] 환경변수 누락 시 친절한 에러 메시지 ("Set SPANLENS_API_KEY or pass apiKey option")
- [ ] `observeOpenAI` 등 기존 tracing API와 호환 (래핑된 클라이언트 + trace 헤더)
- [ ] SDK v0.2.0 bump → npm publish (CI 자동 실행, `sdk-v0.2.0` 태그 push)
- [ ] README에 Before/After 예시 + 마이그레이션 노트

#### 3E.2. `npx` Wizard CLI — **Option B** (1일)
"1 명령어 설치" 달성. PH 런치 시 차별화 포인트. Sentry `sentry-wizard` 패턴.
- [ ] 새 패키지 `packages/cli/` (`create-spanlens` + `@spanlens/sdk init` 양쪽 배포)
- [ ] Interactive 흐름:
  1. 프로바이더 선택 (체크박스)
  2. `https://spanlens.io/auth/device` 브라우저 OAuth-style 로그인 (device-code flow)
  3. 프로젝트 이름 입력 → Spanlens API로 자동 프로젝트 + API key 생성
  4. Provider key 입력 → 암호화해서 Spanlens에 저장 (`POST /api/v1/provider-keys`)
  5. `.env.local` / `.env.example` 에 `SPANLENS_API_KEY=...` 자동 추가
  6. AST 파싱(`ts-morph`)으로 `new OpenAI({...})` 찾아서 `createOpenAI()`로 자동 교체 (사용자 확인 후)
  7. 성공 화면 + Vercel/Railway 환경변수 추가 안내 + 대시보드 링크
- [ ] 새 서버 엔드포인트 `POST /api/v1/onboarding/provision` — 원샷 프로젝트+API key 발급 (device token 인증)
- [ ] Next.js / Vite / Express / Fastify 프레임워크 자동 감지 (`package.json` 체크)
- [ ] `--dry-run` 플래그 (실제 파일 수정 없이 미리보기)
- [ ] E2E 테스트 — 빈 Next.js 앱에 wizard 돌렸을 때 정상 작동하는지

#### 3E.3. 완료 기준
- [ ] 새 유저가 **1분 내** (명령어 입력 ~ 첫 요청 Spanlens에 기록까지) 온보딩 완료
- [ ] 기존 수동 baseURL 통합 대비 오류 제보 **0건**
- [ ] Helicone / Langfuse 대비 경쟁 우위 명문화 — "npx 원샷 vs 수동 설정 2배 빠름"

### 3F. Node Runtime Migration (트리거 기반, 지금은 deferred)
> **현재 상태**: `apps/server/api/index.ts`는 Edge runtime (`export const runtime = 'edge'`). Phase 1C에서 Node streaming 버그(5분 timeout)로 Edge로 이사온 뒤 안정 운영 중.
>
> **트리거 없는 한 진입 금지** — 2026-04-22에 섣부른 Node 전환 시도로 대시보드 전체 다운 사고 발생 (handler signature 오류). Edge가 99%+ 트래픽 문제없이 처리 중이므로 **현재는 투자 대비 효과 낮음**.

#### 3F.1. 진입 트리거 (아래 중 하나 이상)
- [ ] **고객 앱 504율 1% 초과** — Spanlens가 Edge 25초 한계 때문에 실제 품질 이슈
- [ ] **Agent 트레이싱 실사용 고객 등장** — multi-step tool call workflow는 60초+ 불가피
- [ ] **긴 문서 요약 / reasoning 모델(o1) 고객 다수 유입** — 평균 응답 40초+
- [ ] **Langfuse / Helicone에서 "timeout 때문에 왔다"는 피드백** 3건+

#### 3F.2. 구현 방식 (트리거 발생 시)
- [ ] `hono/vercel`의 공식 어댑터 사용 (`handle()`) — `app.fetch` 직접 export는 Node에서 안 됨
- [ ] `apps/server/api/index.ts` 수정:
  ```ts
  import { handle } from 'hono/vercel'
  import { app } from '../src/app.js'
  export const runtime = 'nodejs'
  export const maxDuration = 60  // Hobby, Pro면 300
  export default handle(app)
  ```
- [ ] **로컬 `vercel dev`로 사전 검증 필수** — Edge → Node 전환 시 streaming 동작이 Phase 1C 버그로 되돌아가지 않는지 체크
- [ ] Streaming 회귀 테스트 정비 (현재 `scripts/test-e2e.ts` 수동 실행만 있음)
- [ ] 프로덕션 배포 전 preview URL에서 대시보드/프록시/cron 전부 smoke test
- [ ] `fireAndForget()`은 그대로 동작 (`@vercel/functions` waitUntil은 Edge+Node 양쪽 지원)

#### 3F.3. 완료 기준
- [ ] Edge 롤백 없이 Node 배포 1주일 이상 안정 운영
- [ ] p95 proxy latency 열화 10% 이내 (Node cold start 감수)
- [ ] 25초+ 걸리는 테스트 요청 504 없이 성공

#### 3F.4. 대안 경로 (Node 전환 없이 해결)
트리거 발생해도 Node 전환이 부담스러우면:
- [ ] **Vercel Pro 플랜 업그레이드** ($20/mo) — Edge timeout 60초로 증가 (대부분 커버)
- [ ] **Streaming 강제** — 프록시에서 비스트리밍 요청도 내부적으로 stream 받아 passthrough
- [ ] **고객에게 streaming 권장 문서화** — SDK README에 "장시간 요청은 `stream: true` 권장"

---

## Phase 4 — Public Launch (Week 13~14, ~2026.08.03)

Product Hunt + HN + 커뮤니티 동시 런치. Phase 1~3에서 쌓은 차별화 기능 총동원.

> 기존 Phase 2C/2D에서 이관. Growth 기능(Phase 3) 완성 **후** 런치해야 스토리가 강함 — "Just another LLM proxy"가 아니라 "proxy + tracing + anomaly detection + prompt A/B + team" 풀 스택으로 포지셔닝.

### 4A. 런치 준비 (Week 13)
- [ ] 랜딩 페이지 공식 도메인 연결 (`spanlens.io` / `spanlens.com`) + SEO 메타
- [ ] 1분 데모 영상 녹화 (base_url 교체 → 대시보드 즉시 반영 흐름)
- [ ] PH 런치 자산: 로고, 스크린샷 5장, GIF, 태그라인
- [ ] Hacker News "Show HN" 글 초안 작성 + 내부 리뷰
- [ ] Helicone / Langfuse → Spanlens 마이그레이션 가이드 문서
- [ ] 알파 유저 waitlist 에게 **런치 D-1 사전 초대** (투표/댓글 우군 확보)
- [ ] PH 런치일 태스크 분 단위 타임라인 (00:01 UTC 포스팅 기준)

### 4B. D-day & 런치 후 1주 (Week 14)
- [ ] PH 런치일 커뮤니티 동시 배포: Reddit r/LocalLLaMA, r/LangChain, r/MachineLearning, Twitter, LinkedIn
- [ ] HN "Show HN" 포스팅 + 댓글 적극 대응
- [ ] 런치 48h 동안 실시간 피드백 triage (본인 + 1명 백업 체제)
- [ ] 크리티컬 버그 24h 이내 핫픽스 체제
- [ ] 가입자 피드백 이슈 트래킹 (Linear 또는 GitHub Issues)
- [ ] 온보딩 전환율 측정 (가입 → 첫 요청 프록시) 실시간 모니터링

### 4C. Phase 4 성공 기준 (런치 직후 지표)
- [ ] Product Hunt 주간 Top 5 진입
- [ ] HN 프론트페이지 진입 (최소 6시간 유지)
- [ ] 런치 주 가입자 **200명+**
- [ ] 런치 후 2주 내 유료 전환 **50명+** ($950+ MRR) — Paddle 프로덕션 작동 전제
- [ ] 에이전트 트레이싱 실사용 프로젝트 **10개+**
- [ ] 첫 24h 크리티컬 버그 0건 또는 1h 이내 핫픽스

> **100일 최종 목표**(Phase 3D + 런치 후 스노우볼 반영): 가입 500명+, 유료 200명+, MRR $3,800+

---

## Phase 5 — Enterprise Readiness (트리거 기반, Post-launch)

Enterprise `$99+` 플랜은 이미 Pricing 페이지에 판매 중. **첫 Enterprise 리드 발생 시점에 실행** — 그 전까지는 speculative 구현 금지. 각 섹션은 독립 트리거.

> 왜 지금 문서화하나: 리드가 왔을 때 "뭘 해줘야 하지?" 1~2주 허비 방지 + 한국 세금계산서 같은 **구조적 블로커**를 미리 인지.

### 5A. 한국 B2B 결제 (트리거: 국내 기업 첫 문의)
> Paddle은 한국 세금계산서 발행 안 함 — 경리팀 요구 충족 못 하면 딜 무산.
- [ ] 세금계산서 발행 경로 결정: Toss Payments / 나이스페이 병행 vs Paddle USD 인보이스 + 별도 발행 대행
- [ ] 법인 간 Purchase Order / 연간 선납 프로세스

### 5B. SSO / SAML (트리거: 기업 IT 구매팀 요구)
- [ ] Supabase Auth SAML 활성화 (Supabase Pro 전환 필요)
- [ ] IdP 4종 연동 runbook (Okta / Azure AD / Google Workspace / OneLogin)
- [ ] `organizations.sso_domain` + 도메인 기반 자동 라우팅

### 5C. 컴플라이언스 (트리거: 연 $20K+ 딜 또는 금융권 리드)
- [ ] SOC2 Type I (Vanta / Drata, 연 $2K~5K)
- [ ] GDPR DPA 공식 발행 + DPIA 템플릿
- [ ] 99.9% SLA 문서 + status page (`status.spanlens.io`)

### 5D. 운영 지원 (트리거: 첫 Enterprise 계약)
- [ ] 전용 Slack Connect 채널
- [ ] 4h 응답 SLA (일반 24h → Enterprise 4h)
- [ ] 온콜 로테이션 최소 2인

---

## Post-Launch UX Polish (non-phase, 백로그)

런칭 직후에는 필수 아님. 유저 피드백 누적되거나 가입자 임계치(예: 500명) 도달 시 순차 진행.

### UX-1. 네비게이션 유저 메뉴 (트리거: 유저 피드백 또는 가입자 500명)
- [ ] 랜딩/`/docs`/`/pricing` 상단 nav에 **유저 아바타 + 이메일 드롭다운** 추가 (현재는 로그인 상태에서 "Go to dashboard" 단일 버튼만 표시)
- [ ] 드롭다운 메뉴 항목: Dashboard / Settings / Billing / **Sign out**
- [ ] Supabase Auth `user_metadata.avatar_url` 표시 (Google OAuth 가입자), 없으면 이메일 이니셜 원형 fallback
- [ ] 클라이언트 컴포넌트로 구현 (드롭다운 상태 관리 필요) — 현재 `AuthNavButtons`는 서버 컴포넌트이므로 분리 필요
- [ ] 모바일: 햄버거 메뉴에 통합
- 왜 지금 안 하는가: 드롭다운 UX 다듬기(외부 클릭 닫기, 키보드 접근성, 포커스 트랩)에 반나절 소요. 현재 단일 "Go to dashboard" 버튼으로 핵심 기능(로그인 상태 인지 + 대시보드 접근) 이미 충족.

### UX-2. 다크 모드 (트리거: 요청 누적 5건+)
- [ ] `next-themes` 도입, 전역 토글
- [ ] 기존 `globals.css`의 CSS variable 다크 팔레트 정의 (구조는 이미 준비됨)
- [ ] 사이드바 + 대시보드 차트 색상 대비 재검토

---

## 상시 운영 체크리스트 (매주)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 메인 브랜치 녹색
- [ ] 프로덕션 에러율 < 0.5%, p95 proxy latency < +50ms (provider 대비)
- [ ] 스트리밍 토큰 집계 ±1% 오차 유지
- [ ] Provider Key 로그 노출 0건 (정적 스캔)
- [ ] 보안: RLS 정책 누락 테이블 0개, 의존성 취약점 High 0건
- [ ] 사용자 피드백 triage (24h 이내 응답)

---

## 리스크 & 완화

| 리스크 | 완화책 |
|---|---|
| Provider API 스펙 변경 (특히 Anthropic 스트리밍) | 파서 계약 테스트 + weekly canary |
| Supabase Postgres 쓰기 병목 (100K req/day↑) | `logRequestAsync` 큐잉 + ClickHouse 이관 플랜 |
| Helicone/Langfuse 재진입 | 독립성·셀프호스팅·단순함 메시지 강화 |
| 결제/Paddle 장애 | Grace period 3일 + 알림 이중화, Paddle webhook 재시도 큐 모니터링 |
| Paddle KYC 반려 또는 지연 | 사업자등록증·대표 신분증 미리 준비, 1차 반려 시 Week 8 안에 2차 제출 — 런치(Week 13~14) 전 승인 목표. Phase 2C에 KYC 통과 체크 있음. 최악의 경우 수동 인보이스(Toss/Stripe Atlas 대체안)로 첫 결제 1~2주 흡수 |
| ENCRYPTION_KEY 분실 | 운영 runbook + KMS 이관 검토 (Phase 3) |

---

## 조기 경보 (Tripwire) — 목표 미달 시 피벗 기준

Phase별 목표 수치에 못 미칠 경우 미리 정해둔 행동을 트리거. 감정이 아닌 수치로 결정.

| 시점 | 미달 조건 | 트리거 행동 |
|---|---|---|
| Week 4 (Phase 1 끝) | 내부 알파 테스트 회귀 버그 > 5건 또는 스트리밍 토큰 오차 > 3% | Phase 2 착수 1주 연기 · 안정화 최우선 |
| Week 8 (Phase 2 끝) | Paddle KYC 미통과 또는 dogfood 트레이싱 < 3 프로젝트 | Phase 3 착수 연기 · 결제 + 트레이싱 안정화 우선 |
| Week 12 (Phase 3 끝) | Growth 기능 3종 중 2개 이상 미완 또는 waitlist < 100명 | 런치 2주 연기 · 스토리 강화 (기능 보강 + waitlist 마케팅) |
| Week 13 (런치 직전) | Waitlist < 100명 또는 내부 dogfood 크리티컬 이슈 | 런치 포지셔닝 재검토 or D-day 1주 연기 |
| Week 14 (런치 후 1주) | 가입자 < 150명 | GTM 채널 전환 (HN → dev Twitter/Reddit 집중) |
| Week 16 | MRR < $500 | 가격 재검토 (Starter $19 → $9 실험 또는 무료 리밋 축소) |
| Week 18 (100일 마감) | 유료 전환율 < 5% (가입 대비) | 온보딩 마찰 진단 + 피벗 후보 점검 (트레이싱 특화 vs 비용 특화) |

### 모니터링 지표 (주간 리뷰)
- [ ] 가입 전환율 (랜딩 방문 → 가입)
- [ ] Activation 전환율 (가입 → 첫 프록시 요청 24h 내)
- [ ] 유료 전환율 (Activation → 결제)
- [ ] Day-7 / Day-30 리텐션
- [ ] Self-host vs Cloud 사용 비율 (마케팅 채널 가중치 판단용)

---

## 참고 문서
- 기획서: 제품 전략, 시장, GTM, 가격
- 화면 설계서 v1.1: 14개 화면 wireframe, 경쟁사 벤치마킹
- 기술 아키텍처 v1.0: 14 테이블 DB, 47 API, 3 cycles 검증
- [CLAUDE.md](CLAUDE.md): 개발 규칙 & Known Gotchas
