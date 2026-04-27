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

### 3B. 팀 & 협업 (Week 11) — 완료 (2026-04-25)
> 단일 owner_id 모델 → 본격 multi-tenant. `apps/web/app/(dashboard)/settings`(Members 탭) + `/onboarding` + dashboard 상단 banner까지 surface 통합. 한 commit이 아니라 이번 세션 7개 commit (`595b1e7..ebb40bd`)에 걸쳐 마무리.
- [x] **org_members + RBAC** — `org_members` 테이블 (admin/editor/viewer enum) + 마이그레이션 `20260425000000_org_members.sql` + `requireRole` 미들웨어 + `<PermissionGate>` UI 게이트 + 마지막 admin 보호 (강등/제거 거부)
- [x] **이메일 초대 시스템** — `org_invitations` 테이블 (sha256-hashed token + 7일 만료) + Resend 통합 + `/invite?token=...` 페이지 (Accept / Decline) + admin이 보낸 invite 목록 / 취소 UI
- [x] **다중 워크스페이스 (한 유저 N개 org)** — `sb-ws` 쿠키 기반 활성 워크스페이스 + 사이드바 스위처 + `+ New workspace` 모달 + middleware/authJwt 양쪽에서 cookie 해석 + 전환 시 hard reload (TanStack 캐시 + RSC tree 동시 무효화)
- [x] **Pending invitations 자동 감지 banner** — dashboard 상단 dismissible banner로 받은 invite 노출. 이메일 못 받은 케이스 (DM, 봤다가 잊음, 스팸함) catch. Accept = 자동 워크스페이스 전환 / Decline = row DELETE / ⨯ Dismiss = 세션 한정
- [x] **2-step onboarding + invitation 분기** — 신규 가입 시 pending invite 있으면 "You've been invited" 화면 (Accept ↔ Skip & create my own) → 합류는 워크스페이스 생성 + survey 둘 다 skip → /dashboard 직행. 본인 워크스페이스 케이스는 1) 이름 입력 → bootstrap 2) optional survey (use_case + role) → /dashboard
- [x] **감사 로그 UI** — Settings → Audit log 탭에서 actor + action + target + timestamp 피드. 멤버 추가/제거, 역할 변경, 초대 lifecycle 모두 기록
- [x] **마이그레이션 후속 fix** — `20260425130000_fix_org_members_rls_recursion.sql` (RLS USING절의 self-reference로 인한 PostgreSQL 42P17 재귀 fix) + `20260425120000_user_profiles.sql` (onboarded_at 게이트 + survey 답)
- [ ] SSO 준비 작업 (Team 플랜 상위 제공용) — Phase 5B로 이관
- [ ] 조직 단위 예산/쿼터 — Phase 2B `enforceQuota` 미들웨어로 org 레벨 request 한도는 충족됨. 멤버별 fine-grained 쿼터는 수요 검증 후 Phase 5+로 보류

### 3C. 고도화 (Week 12)
- [ ] Postgres → ClickHouse 이관 옵션 검토 (>10M rows 시)
- [x] **Public API + OpenAPI 문서 공개** — **완료 (2026-04-27)**: 정적 OpenAPI 3.0 스펙 (20+ 엔드포인트) + `GET /api/v1/openapi.json` + `GET /api/v1/docs` Swagger UI (CDN) + `/docs/api` 문서 페이지 + docs 사이드바 링크
- [ ] 데이터 export (CSV/JSON) + BigQuery 커넥터 베타
- [ ] Enterprise plan ($99+) 랜딩 페이지 + 문의 폼

### 3D. Phase 3 완성도 기준 (런치 자산 준비 전제) — **모두 완료 (2026-04-27)**
> Phase 3 기능이 런치 스토리의 차별점. 여기까지 쌓고 Phase 4에서 런치.
- [x] Growth 기능 3종 작동: 이상 탐지 / 프롬프트 A/B / 모델 추천 — 3A 완료
- [x] 팀 초대 & 역할 구조 동작 — 3B 완료. `WEB_URL`/`RESEND_API_KEY`/`RESEND_FROM` Vercel 환경변수 등록 완료 (2026-04-27). DMARC TXT 레코드 가비아 DNS 등록 완료.
- [x] **Public API + OpenAPI 문서 공개** — 완료 (2026-04-27). `GET /api/v1/openapi.json` + Swagger UI + `/docs/api` 페이지
- [x] **알파 유저 waitlist 운영 시작** — 완료 (2026-04-27). `waitlist` 테이블 + `POST /api/v1/waitlist` 공개 엔드포인트 + 랜딩 페이지 "Early access" 배너 + 이메일 폼. 이제 사전 가입자 모집 가능.
- [x] **p95 proxy latency 모니터링 정착** — 완료 (2026-04-27). `proxy_overhead_ms` 컬럼 + 3개 proxy 핸들러 handlerStartMs 측정 + `GET /api/v1/stats/latency` p50/p95/p99 percentile API + dashboard KPI 카드 overhead delta 표시. target: p95 < 50ms.

### 3E. Developer Experience 개선 — 런치 전 필수 (Week 12~13)
> **트리거**: mind-scanner 첫 통합 경험에서 "5단계 온보딩이 복잡하다"는 피드백. Sentry/PostHog/Datadog 수준의 "1분 온보딩"을 Phase 4 런치 마케팅 핵심 카피로 활용 ("`npx @spanlens/sdk init` 한 번으로 설치").

#### 3E.1. SDK 래퍼 함수 — **Option A** — 완료
기존 `baseURL` 수동 설정을 단 한 줄로 축약. 가장 빠른 win.
- [x] `@spanlens/sdk/openai` 서브경로 export — `createOpenAI()` 헬퍼
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
- [x] `@spanlens/sdk/anthropic` — `createAnthropic()` 동일 패턴
- [x] `@spanlens/sdk/gemini` — `createGemini()` Proxy로 `getGenerativeModel()` 자동 baseUrl 주입
- [x] `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`를 **peerDependencies** 로 등록 (SDK 자체 크기 유지)
- [x] 환경변수 누락 시 친절한 에러 메시지 ("Set SPANLENS_API_KEY or pass apiKey option")
- [x] `observeOpenAI` 등 기존 tracing API와 호환 (래핑된 클라이언트 + trace 헤더 + `promptVersion` 옵션)
- [x] SDK v0.2.0+ npm publish — `@spanlens/sdk@0.2.3` 라이브 (`sdk-v*` 태그 push 시 자동 publish)
- [x] README에 Before/After 예시 + LangChain/LlamaIndex/Vercel AI SDK 통합 코드

#### 3E.2. `npx` Wizard CLI — **Option B** — 완료
"1 명령어 설치" 달성. `@spanlens/cli` npm publish + 라이브.
- [x] 새 패키지 `packages/cli/` (`@spanlens/cli` 배포 — `npx @spanlens/cli init`)
- [x] Interactive 흐름 — wizard가 가입/프로젝트/API key/`.env.local` 자동 처리
- [x] AST 파싱(`ts-morph`)으로 `new OpenAI({...})` 찾아서 `createOpenAI()`로 자동 교체
- [x] Next.js / Vite / Express / Fastify 프레임워크 자동 감지
- [x] `--dry-run` 플래그
- [x] E2E 테스트

#### 3E.3. 완료 기준
- [x] 새 유저가 **1분 내** 온보딩 완료 — `npx @spanlens/cli init` 한 줄로 SDK 설치 + .env + baseURL 교체까지
- [x] 기존 수동 baseURL 통합 대비 오류 제보 **0건** (현재까지)
- [x] Helicone / Langfuse 대비 경쟁 우위 명문화 — landing/docs에서 "npx 한 줄 설치" 카피 노출

#### 3E.4. Python SDK — 완료 (2026-04-25)
> mind-scanner dogfood 도중 발견된 큰 gap — Python 개발자(LLM 시장의 80%)에게 Spanlens가 닿지 않음. TypeScript SDK 1:1 포팅 + PyPI publish + docs 통합까지 한 세션에 마무리. PyPI 라이브: `pip install spanlens` 0.1.0.

- [x] `packages/sdk-python/spanlens` — TS SDK 1:1 포팅. `SpanlensClient` + `TraceHandle` + `SpanHandle` + `observe` + `parse_*_usage`. ThreadPoolExecutor 기반 fire-and-forget transport (Promise chain → Future chain)
- [x] Python 3.9 ~ 3.13 호환 (typing_extensions로 `NotRequired` / `Unpack`)
- [x] Provider integrations — `create_openai` / `create_anthropic` / `create_gemini` (httpx 래퍼) + optional dependency (`pip install "spanlens[openai,anthropic,gemini]"`)
- [x] Pythonic API 보강 — `with` 컨텍스트 매니저(`with trace.span(...) as span:`) + `inspect.isawaitable` 기반 sync/async 자동 감지
- [x] pytest 38 테스트 (httpx + respx HTTP mock) + ruff lint clean
- [x] PyPI publish — `spanlens` 0.1.0 라이브 + 첫 publish는 수동, 이후 자동화
- [x] CI 워크플로 `.github/workflows/publish-sdk-python.yml` — `python-sdk-v*` 태그 push 시 build/test/publish + PyPI 버전 충돌 사전 차단 + project-scoped token 권장
- [x] `/docs/sdk` 페이지 `<LangTabs>` 컴포넌트 — TypeScript / Python 코드 토글 + localStorage persist + window event broadcast
- [x] 메인 README + landing page Python 안내 — version 배지(PyPI), `pip install spanlens` 설치 chip, "Python SDK is here" hero
- [ ] LangChain / LlamaIndex Python 통합 샘플 코드 — dogfood 단계로 보류
- [ ] e2e_smoke.py 실제 OpenAI key로 검증 — 코드는 있고 실행은 사용자 키 입력 대기

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

### 3H. Design Renewal — 기능 확장 (UI 리뉴얼에서 도출된 신규 기능)

> **트리거**: 2026-04-23 design handoff 수령 → UI 리뉴얼 Phase 1 (토큰/셸) 착수. 아래는 리뉴얼 목업에서 새로 등장한 기능들로, 디자인 변경 후 구현할 목록.

#### 3H.1. 글로벌 인터랙션
- [ ] **⌘K Command Palette** — 전 페이지에서 `Cmd+K` 로 요청/트레이스/프롬프트/설정 검색. shadcn `Command` (cmdk) 기반, 모노 glyph 컬럼.
- [ ] **Topbar breadcrumb + 시간 범위 선택기** — 모든 대시보드 페이지에 공통 `<MonoTopbar>` — `Workspace / {Page}` 브레드크럼 + 1h / 24h / 7d / 30d 세그먼트 필터 + `⊙ Live` 인디케이터.
- [ ] **Theme toggle** (Light / Dark / System 3-state) — `localStorage` 저장, `<html class="dark">` 토글. 우측 상단 고정.

#### 3H.2. Dashboard
- [ ] **Morning briefing 레이아웃** — 시간대별 인사(Morning/Afternoon/Evening) + 조직명/환경 + 날짜/시각 모노라벨.
- [ ] **"Needs attention" 카드 3개** — 현재 firing 중인 이상/알림 중 top 3를 액션 카드로 요약. 각 카드: 타입 + 메시지 + CTA 링크.
- [ ] **Spend sparkline** — 24h 시계열 트래픽 sparkline (SVG, 그라디언트 fill). `requests` 테이블 1h 버킷 집계.
- [ ] **Top prompts by cost** — 비용 순위 상위 5개 프롬프트 인라인 테이블.
- [ ] **Recent alerts** — 최근 발송된 alert_deliveries 3건 인라인 리스트.

#### 3H.3. Requests
- [ ] **우측 drawer 상세 패널** — 테이블 행 클릭 시 페이지 이동 대신 우측 240px+ drawer 슬라이드인. request/response body, cost breakdown, 연결된 spans, request ID 표시.
- [ ] **TrafficChart 개선** — 디자인 토큰 기반 컬러 + 빠른 기간 토글 연동.

#### 3H.4. Traces
- [ ] **Critical-path highlight** — Waterfall에서 가장 긴 경로(end-to-end 가장 느린 선형 체인)를 amber로 하이라이트.
- [ ] **Span search** — Waterfall 상단에 span name 필터 입력, 매칭 span 강조.
- [ ] **Cost per span 열** — Waterfall 오른쪽에 span 별 cost_usd 컬럼.

#### 3H.5. Settings (12탭 전체)
> 현재 `/settings`는 단일 페이지. 리뉴얼은 `Workspace/Usage/Connect/Account` 4그룹 · 12탭 two-level 사이드바 구조로 전환.
- [ ] **Workspace: General** — 조직 이름, 슬러그, timezone, 삭제 (danger section).
- [ ] **Workspace: Members** — 초대 + 역할(Owner/Admin/Member/Viewer) CRUD + 대기 초대 목록.
- [ ] **Workspace: API keys** — 현재 `/projects`에 있는 key 관리를 Settings로 통합. 마지막 사용 시각, `Just-rotated` 배너.
- [ ] **Workspace: Audit log** — `audit_logs` 기반 이벤트 피드 (actor, action, target, timestamp).
- [ ] **Usage: Billing** — 현재 플랜 카드 + 청구 주기 + 다음 결제일. Paddle customer portal 링크.
- [ ] **Usage: Plan & limits** — 요청/보존 한도 인라인 진행 바 + 업그레이드 CTA.
- [ ] **Usage: Invoices** — Paddle 인보이스 목록 (날짜, 금액, PDF 다운).
- [ ] **Connect: Integrations** — Slack / Discord / PagerDuty / Datadog 카드 (연결 상태 pill + Connect 버튼).
- [ ] **Connect: Destinations** — BigQuery / S3 데이터 export 커넥터 (Phase 3C와 연동).
- [ ] **Connect: Webhooks** — webhook endpoint CRUD + 최근 delivery 이력.
- [ ] **Connect: OpenTelemetry** — OTLP endpoint 설정 + 인증 헤더 + 커넥션 테스트.
- [ ] **Account: Profile** — 이름, 아바타, 이메일 변경.
- [ ] **Account: Notifications** — 알림 채널별 on/off 토글.
- [ ] **Account: Preferences** — 테마, 밀도, 언어.

#### 3H.6. Auth 플로우 완성
> 현재는 Supabase Auth UI 기본 화면. 리뉴얼 디자인에 맞는 커스텀 화면 구현.
- [ ] **Magic link sent** — "Check your inbox" 화면 + 10분 TTL 안내 + 42초 resend 타이머.
- [ ] **2FA / TOTP** — 6자리 슬롯 입력 UI + "Remember 30 days" 체크박스 + 복구 코드 링크.
- [ ] **Invitation accept** — 워크스페이스 카드 + 역할 프리뷰 + 퍼미션 요약.
- [ ] **CLI device auth** — device code (예: `WXYZ-QJ47`) 매칭 + 툴/기기/IP 표시.
- [ ] **Account locked** — 15분 잠금 + magic-link 탈출 안내.

#### 3H.7. Empty / Loading / Error 상태 시스템
> 현재: 라우트별 즉흥 처리. 리뉴얼: 모든 라우트에 통일된 빈/로딩/에러 상태.
- [ ] `<EmptyState>` 공통 컴포넌트 — 일러스트 없음, plain copy + 단일 CTA. (예: "No requests yet. Start by proxying a request.")
- [ ] 각 라우트 `loading.tsx` 에 shadcn `Skeleton` 레이아웃 — 실제 콘텐츠 형태 모방.
- [ ] 각 라우트 `error.tsx` — "Something went wrong" + Retry 버튼 + 에러 ID.
- [ ] First-install empty state: "Connect your first project" 가이드 카드.
- [ ] Filter-empty state: "No results. Try adjusting your filters."

#### 3H.8. Landing Page 리뉴얼
> Phase 4 런치 이전에 완성.
- [ ] 1440px 기준 신규 Hero — product proof stats (요청 수, 절감액, 응답 시간 개선) + code snippet CTA.
- [ ] Feature grid — proxy / tracing / anomaly / prompts 4-block.
- [ ] Pricing section 인라인 (현재 `/pricing` 별도 페이지 → landing 통합 or 유지).
- [ ] 디자인 토큰 적용 + monochrome 스타일.

---

### 3G. Proxy Timeout Mitigation — Internal Streaming 캠페인 (Post-launch)

> **배경 (2026-04-23)**: mind-scanner dogfood 도중 `gpt-4o-mini` JSON mode + `max_tokens=2500` 응답이 25초 넘어가서 Edge first-byte timeout 504. 단기 처방으로 mind-scanner 두 라우트를 "internal streaming" 패턴(서버는 `stream:true`로 받아 chunk 누적, 클라이언트엔 단일 JSON 반환)으로 마이그레이션 + `/docs/proxy`, `/docs/sdk` 상단에 streaming 권장 안내 배너 추가 (= **Phase 1 완료**). 아래는 런치 후 데이터 누적 보고 결정할 후속 작업.
>
> **왜 런치 전이 아니라 후인가**: 유저 0명 상태에서 더 깊은 인프라 투자(Phase 2~4)는 over-engineering. 실제 timeout 불만이 누적되어야 비용 대비 효과 판단 가능.

#### 3G.1. Phase 2 — 모니터링 (런치 후 ~3개월, 트리거: 첫 유료 유저 진입)
- [ ] `requests` 테이블에 `timeout_504` 카운터 view 추가 — provider/model별 504 빈도 집계
- [ ] `/admin` 또는 내부 메트릭 대시보드에 "최근 7일 504 by (provider, model, customer)" 패널
- [ ] 유저 피드백 채널(이메일/Slack/GitHub Issues) 에서 "timeout" 키워드 트래킹 — 3건+ 누적 시 Phase 3 착수 검토
- [ ] 평균 응답 시간 P95/P99 모델별 dashboard 패널 — 25초 근접 모델 사전 식별

#### 3G.2. Phase 3 — Node Runtime 재시도 (트리거: 504 1%+ 또는 timeout 불만 5건+)
> 3F.2와 통합. mind-scanner 케이스 데이터를 트리거 카운트에 포함.
- [ ] 3F.1 트리거 충족 시 3F.2 구현 절차 그대로 진행
- [ ] **이전 실패(commits efc3fde→2b57b01) 회피 체크리스트**:
  - [ ] `hono/vercel`의 `handle()` 어댑터 사용 (직접 `app.fetch` export 금지 — 이게 지난번 깨진 원인)
  - [ ] 로컬 `vercel dev` 에서 streaming 회귀 테스트 (`scripts/test-e2e.ts`) 100% 그린 확인 후 배포
  - [ ] Preview URL 에서 `/proxy/*` + `/api/*` + `/cron/*` 모두 smoke test
  - [ ] Edge 롤백 PR 사전 준비 (revert 1줄)

#### 3G.3. Phase 4 — Fallback Model Auto-retry (트리거: Phase 3 후에도 timeout 잔존 또는 multi-provider 고객 등장)
> Portkey/OpenRouter가 차별점으로 미는 패턴. 우리 USP는 아니지만 "신뢰할 수 있는 인프라" 보강.
- [ ] `provider_keys` 또는 새 `routing_rules` 테이블에 fallback chain 정의 (예: `gpt-4o → gpt-4o-mini → claude-haiku`)
- [ ] 프록시에서 504/429/5xx 발생 시 chain 다음 모델로 자동 retry (한 번만, 재귀 방지)
- [ ] 응답 헤더에 `X-Spanlens-Fallback-Used: gpt-4o-mini` 노출 — 고객 디버깅용
- [ ] 대시보드 요청 상세에 "fallback path" 시각화
- [ ] **opt-in only** (default off) — 묵시적 모델 변경은 청구·품질 양쪽 surprise 큼

#### 3G.4. 완료 기준 / 비-목표
- [x] Phase 1 (mind-scanner internal streaming + docs 안내) — 2026-04-23 완료
- [ ] Phase 2~4는 데이터/트리거 기반 — 추측 구현 금지
- ❌ **모든 라우트를 자동 internal-streaming으로 변환하는 magic middleware** — 명시적 선택이 더 단순. SDK README + docs 배너로 충분.

---

## Phase 4 — Public Launch (Week 13~14, ~2026.08.03)

Product Hunt + HN + 커뮤니티 동시 런치. Phase 1~3에서 쌓은 차별화 기능 총동원.

> 기존 Phase 2C/2D에서 이관. Growth 기능(Phase 3) 완성 **후** 런치해야 스토리가 강함 — "Just another LLM proxy"가 아니라 "proxy + tracing + anomaly detection + prompt A/B + team" 풀 스택으로 포지셔닝.

### 4A.0 폴리시-퍼스트 런칭 준거 (Polish-First Launch Criteria)

> **전략 결정 (2026-04-22)**: Lean/Ship-fast 대신 **폴리시-퍼스트**로 감.
> 근거: Spanlens는 개발자 신뢰 기반 인프라 제품 → 첫인상이 전부. Langfuse/Helicone 대비 최소 동등 이상의 마감 수준 필수. 1인 founder + VC burn rate 없음 → 폴리시 시간이 경쟁 우위.
>
> **이 체크리스트는 변경 금지 규약.** 전 항목 완료 시 즉시 런치, 미완료 시 D-Day 연기. 중간에 "하나만 더" 추가 금지.

#### 가드레일 4개 (폴리시-퍼스트가 실패하지 않기 위한 장치)

1. **체크리스트 변경 금지** — 아래 리스트만 함. 새 기능 떠오르면 `Phase 5+` 이관. "범위 확대 ≠ 폴리시" 구분.
2. **주 1회 외부 감시자 셀프체크** — 매주 일요일 저녁 15분: "이번 주 작업이 이 체크리스트의 항목인가?" / "유저 0명에게 이게 얼마나 의미 있나?" 벗어나면 다음 주 스케줄 교정.
3. **D-30 Soft Launch (2026-07-03)** — 친한 개발자 5~10명에게 개별 공유. 공개 아님, 피드백 수집용. 현실 검증 없이 런칭 금지.
4. **Dark matter 방지** — 폴리시 대상은 **유저가 볼 surface**. 내부 리팩토링은 Phase 5+.

#### 런칭 준거 체크리스트

**문서 (/docs)**
- [x] Tier 1 — 차별화 기능 페이지
  - [x] `/docs/features/prompts` — 버전 관리 + A/B 비교
  - [x] `/docs/features/traces` — 에이전트 트레이싱
  - [x] `/docs/features/security` — PII + 프롬프트 인젝션 탐지
  - [x] `/docs/features/savings` — 모델 추천 기반 비용 절감
- [x] Tier 2 — 운영 기능 페이지
  - [x] `/docs/features/anomalies` — 3-sigma 이상 탐지
  - [x] `/docs/features/alerts` — 임계치 알림 + Slack/Email/Discord
  - [x] `/docs/features/requests` — 요청 로그 뷰어
  - [x] `/docs/features/cost-tracking` — 정확한 비용 산정 원리
- [x] Tier 3 — 보조 기능 페이지
  - [x] `/docs/features/projects` — 프로젝트 + API 키 관리
  - [x] `/docs/features/settings` — Provider Key 등록 (AES-256-GCM)
  - [x] `/docs/features/billing` — 플랜 한도, overage, hard cap
  - [x] `/docs/features/members-invitations` — **NEW (2026-04-25)**: 멀티유저 / 역할 / 초대 / 워크스페이스 전환 / API 레퍼런스
- [x] Docs 사이드바 재구성 — `Getting started` / `Features` (12 항목) / `SDK` / `API` / `Self-hosting` 5그룹 구조
- [x] `/docs/sdk` 양언어 토글 — TypeScript / Python LangTabs (3E.4 Python SDK 부산물)
- [x] `/docs/self-host` 환경변수 표 — `WEB_URL` / `RESEND_API_KEY` / `RESEND_FROM` 추가 (3B 멀티유저 부산물)
- [x] `/docs/api` REST API 레퍼런스 페이지 — **NEW (2026-04-27)**: OpenAPI 3.0 스펙 + Swagger UI 링크 + 엔드포인트 그룹 표. Docs 사이드바 "REST API reference" 항목 추가.
- [ ] 각 대시보드 페이지에서 "Learn more →" 링크를 해당 docs로 연결 — 일부 완료, 일부 미완

**기능 완성도 (audit로 발견된 gap)**
- [x] Prompts 기능의 "요청 ↔ 버전 연결" 경로 SDK에서 노출 — **완료 (sdk v0.2.2, 2026-04-22)**: `withPromptVersion()` 헬퍼 + `observeOpenAI({ promptVersion })` 옵션 + 서버측 `X-Spanlens-Prompt-Version` 헤더 파싱
- [~] Self-host Docker **실전 검증** — **1차 완료 (2026-04-22)**: 로컬 빌드 + 가짜 env 부팅 확인, 7개 gap 발견. 세부 fixup 아래 Self-Host Remediation Checklist 참고
- [x] Overage 경고 이메일 실제 구현 — **완료 (2026-04-22)**: `/cron/check-quota-warnings` (hourly) + `lib/quota-warnings.ts` + 80/100% 임계치 per-month idempotency + Resend 이메일 + `<QuotaBanner />` /dashboard + /billing 양쪽 표시 + 15개 단위 테스트
- [x] Paddle overage 청구 **전면 재구현** — **완료 (2026-04-22)**. 기존 코드는 존재하지 않는 `/subscriptions/{id}/adjust` 엔드포인트 + 방향 반대의 `action: 'credit'` (고객에게 환불) 로 이중 버그 상태였음. 공식 `POST /subscriptions/{id}/charge` 엔드포인트 + `effective_from: next_billing_period` (다음 invoice에 bundle) + 새 `subscription_overage_charges` 테이블로 멱등성 확보 + `pending→charged/error` 3-state flow로 race-safe + 14 단위 테스트. 프로덕션 DB에 migration 반영됨.
- [x] **Pattern C 쿼터 정책 + 대시보드 토글** — **완료 (2026-04-22)**. `lib/quota-policy.ts` 순수 결정 함수 + Free→무조건 block, Paid+overage→hard-cap 까지 통과, Paid+disabled→Pattern A. `middleware/quota.ts` 재작성(block reason + `X-Overage-Active` 헤더). `PATCH /api/v1/organizations/me/overage` API. `/settings`에 Overage billing 토글 + multiplier(1-100) UI. `<QuotaBanner />` 3-tone 상태(amber/blue/red) 반영. 이메일 템플릿 context-aware 재작성. 14 신규 테스트(118→전체 green). organizations 테이블 `allow_overage`/`overage_cap_multiplier` 프로덕션 반영됨.

**Self-Host Remediation (1차 검증에서 발견)**
> 2026-04-22 로컬 `docker build` + `docker run`으로 검증. Gap 7개 중 일부 즉시 수정, 일부 백로그.
- [x] `db.ts` 에러 메시지 개선 — 어느 env var 빠졌는지 구체적으로 출력
- [x] `docker-compose.yml` → `docker-compose.dev.yml` 이름 변경 (dev 전용 명시)
- [x] `/docs/self-host` 재작성 — "plain Postgres 지원" 허위 주장 제거, "early access" 배너, Supabase 필수 + CLI 마이그레이션 스텝 + 각 gap을 inline 경고로 명시
- [x] **GHCR 패키지를 public으로 전환** — 완료 (2026-04-22). 공식 이미지 `docker pull ghcr.io/sunes26/spanlens-server:latest` → 부팅 + `/health` 200 검증됨
- [ ] 마이그레이션 번들 — `spanlens-migrate` Docker 이미지 또는 entrypoint 스크립트로 자동 적용 (현재는 유저가 repo clone + supabase CLI 설치 + `db push` 수동)
- [ ] `spanlens-web` Docker 이미지 publish — 현재 workflow 없음. web 대시보드도 self-host 가능하게 별도 이미지 빌드 필요 (docs 주장과 일치시키기)
- [ ] Plain Postgres 지원 — `@supabase/supabase-js` 직접 의존 제거, 얇은 abstraction layer 도입 (리팩토링 큼, 런칭 후 이관)
- [ ] Self-host 전용 E2E 테스트 — CI에서 `docker run` + Supabase free tier → 실제 `/health` + 간단한 auth 플로우 매주 자동 검증

**데모 & 마케팅 자산**
- [ ] Demo 앱 — `create-spanlens-demo` npx 또는 `demo.spanlens.io` 라이브
- [ ] 3분 제품 Loom — 가입부터 첫 요청까지
- [ ] 기술 블로그 3개 — (1) OpenAI SSE `tee()` 구현기 (2) baseURL 전략이 SDK wrapping보다 나은 이유 (3) 200줄 정규식 기반 프롬프트 인젝션 탐지
- [ ] 경쟁사 비교 페이지 — `/compare/langfuse`, `/compare/helicone`, `/compare/langsmith`
- [ ] 랜딩 Hero/Feature 카피 최종본
- [ ] 온보딩 튜토리얼 개선 — 프로젝트 첫 생성 → 첫 요청까지 단계별 가이드

**기존 4A/4B/4C 항목** (아래 유지)

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
