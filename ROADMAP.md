# Spanlens (AgentOps) ROADMAP

> LLM 관찰성 SaaS · 90일 MVP · 런치 목표 2026.07.20
> 수익 모델: Free / Starter $19 / Team $49 / Enterprise $99
> 90일 현실 목표: 가입 500명, 유료 200명, MRR $3,800

---

## Phase 0 — 초기 셋업 (Week 0, ~2026.04.27)

프로젝트 기반 구축. 코드 한 줄 쓰기 전에 인프라부터.

### 성공 기준 체크리스트
- [ ] pnpm monorepo 초기화 (`apps/web`, `apps/server`, `packages/sdk`, `supabase/`)
- [ ] Next.js 14 (App Router) + Tailwind + shadcn/ui 부트스트랩
- [ ] Hono 서버 부트스트랩 (포트 3001, `/health` 엔드포인트)
- [ ] Supabase 로컬 실행 (`supabase start`) 성공
- [ ] TypeScript strict mode, ESLint, Prettier 설정
- [ ] Vitest 테스트 러너 설정 + 샘플 테스트 1개 통과
- [ ] `.env.example` 작성 (SUPABASE_*, ENCRYPTION_KEY, PORT)
- [ ] GitHub 비공개 레포 + CI (typecheck + lint + test)
- [ ] Vercel 프로젝트 연결 (web)
- [ ] **로컬 개발용** `docker-compose.yml` (server + supabase) — 공식 셀프호스팅 배포는 Phase 2E
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과

---

## Phase 1 — MVP Foundation (Week 1~4, ~2026.05.25)

핵심 프록시 + 대시보드. "요청 로깅 + 비용 추적" 단일 가치 제공.

### 1A. DB 스키마 (Week 1)
- [ ] 마이그레이션: `organizations`, `projects`, `api_keys`, `provider_keys`
- [ ] 마이그레이션: `requests`, `model_prices`, `usage_daily`, `audit_logs`
- [ ] 모든 테이블 `ENABLE ROW LEVEL SECURITY` + 정책 작성
- [ ] `seeds/model_prices.sql` (OpenAI, Anthropic, Gemini 주요 모델)
- [ ] `supabase gen types` 성공, `supabase/types.ts` 생성
- [ ] Supabase Auth (이메일 + Google OAuth) 활성화

### 1B. 프록시 서버 — 논스트리밍 (Week 2)
> 스트리밍은 Week 3으로 분리 — 난이도가 달라 같은 주에 묶으면 일정 터짐.
- [ ] `lib/crypto.ts` AES-256-GCM 암/복호화 + 단위 테스트
- [ ] `lib/cost.ts` `calculateCost()` + `model_prices` 조회 + null 처리
- [ ] `lib/logger.ts` `logRequestAsync()` fire-and-forget
- [ ] `authApiKey` 미들웨어 (SHA-256 해시 검증)
- [ ] `/proxy/openai/v1/*` OpenAI passthrough (**stream=false만**) + 비용 계산
- [ ] `/proxy/anthropic/v1/*` Anthropic passthrough (**stream=false만**)
- [ ] `/proxy/gemini/v1/*` Gemini passthrough (**stream=false만**)
- [ ] `request_body` 저장 전 `Authorization` 헤더 제거 검증 (테스트)
- [ ] 10KB 초과 body → Supabase Storage 분기 로직
- [ ] **dev-only Provider Key 삽입 스크립트 또는 미니 폼** (Week 2 프록시 e2e 테스트 용도, P12 정식 UI는 Week 3)
- [ ] 프록시 e2e 테스트: 실제 OpenAI/Anthropic 키로 요청→로그 확인 (논스트리밍)

### 1C. 대시보드 + 스트리밍 (Week 3)
- [ ] **스트리밍 `body.tee()` SSE passthrough + 병렬 파싱** (Week 2에서 이관)
- [ ] Anthropic `message_delta` usage 집계 회귀 테스트
- [ ] 스트리밍 e2e 테스트: OpenAI/Anthropic/Gemini 전 provider
- [ ] `authJwt` 미들웨어 (Supabase JWT 검증)
- [ ] P1 랜딩 페이지 (Hero + 3-step 온보딩 프리뷰)
- [ ] P2 로그인/회원가입 (Supabase Auth UI)
- [ ] P3 가격 페이지 (Free / Starter / Team)
- [ ] P4~P5 온보딩 (Provider Key 입력 → API Key 발급 → 코드 스니펫)
- [ ] P6 메인 대시보드 — 총 요청/비용/토큰 카드 + 시계열 차트 (Recharts)
- [ ] P7 요청 로그 목록 — 필터(모델, 시간, 상태), 페이지네이션
- [ ] P8 요청 상세 — request/response body, 비용, latency, token 내역
- [ ] P10 프로젝트/API Key 관리 (생성·폐기·회전)
- [ ] P12 계정 설정 (Provider Key 추가/삭제/로테이션) — 정식 UI
- [ ] P14 에러 페이지 (404/500)

### 1D. Phase 1 릴리스 기준 (Week 4)
- [ ] 3개 프로바이더(OpenAI/Anthropic/Gemini) 모두 프록시 작동
- [ ] 스트리밍/논스트리밍 모두 토큰·비용 정확 집계 (±1% 오차)
- [ ] 수동 집계 쿼리로 일별 사용량 조회 가능 (cron 자동화는 Phase 2A로 이관)
- [ ] 로컬 `docker compose up`으로 개발 스택 부팅 성공 (공식 셀프호스팅은 Phase 2E)
- [ ] 내부 알파 테스트: 본인 프로젝트 1개를 Spanlens로 1주일 프록시
- [ ] Known Gotcha 회귀 테스트 (Anthropic usage, 복호화 빈문자열, RLS)

---

## Phase 2 — Launch (Week 5~8, ~2026.06.22)

에이전트 트레이싱 + Product Hunt 런치. 차별화 기능 완성.

### 2A. 에이전트 트레이싱 백엔드 + UI (Week 5~6)
> SDK npm publish는 Week 7로 분리 — 포장 작업(README, 버전, 배포 파이프라인) 따로.
- [ ] 마이그레이션: `traces`, `spans` (parent_span_id FK 없음, 의도적)
- [ ] `usage_daily` 1시간 cron 배치 집계 (Phase 1에서 이관)
- [ ] `/api/v1/traces/*` 엔드포인트 (list, get, ingest)
- [ ] P9 에이전트 트레이스 화면 — Gantt/waterfall 뷰, span 트리
- [ ] 병렬 span 시각화 테스트 (LangGraph 스타일 fan-out)
- [ ] SDK `packages/sdk` 내부 구현 — `startTrace()`, `span()`, `end()` API
- [ ] SDK OpenAI/Anthropic auto-instrumentation (로컬 링크로 테스트)
- [ ] **Stripe 통합 기본 골격 (Week 6)** — Starter/Team 결제 테스트 모드 완료
- [ ] Stripe 프로덕션 승인 신청 (최소 1주 소요 감안)

### 2B. 운영 기능 + SDK 배포 (Week 7 전반)
- [ ] SDK npm publish v0.1.0 + README + 사용 예제 + CHANGELOG
- [ ] SDK e2e: LangChain/LlamaIndex 샘플 트레이싱 성공
- [ ] 마이그레이션: `alerts`, `webhooks`
- [ ] P11 알림 설정 — 예산 초과, 에러율, latency 임계치
- [ ] Resend 이메일 알림 + Slack/Discord 웹훅
- [ ] Stripe 프로덕션 전환 + 사용량 기반 overage
- [ ] 무료 플랜 리밋 (10K requests/mo) + upgrade CTA
- [ ] 로그 보존 정책 (Free 7일 / Starter 30일 / Team 90일)

### 2C. Product Hunt 런치 (Week 7 후반)
- [ ] 랜딩 페이지 공식 도메인 연결 + SEO 메타
- [ ] 1분 데모 영상 녹화 (base_url 교체 → 대시보드 즉시 반영)
- [ ] PH 런치 자산: 로고, 스크린샷 5장, GIF, 태그라인
- [ ] Hacker News "Show HN" 글 준비
- [ ] Helicone/Langfuse 마이그레이션 가이드 문서
- [ ] PH 런치일(D-day) 커뮤니티 동시 배포 (Reddit r/LocalLLaMA, Twitter)

### 2D. 런치 후 (Week 8)
- [ ] 가입자 피드백 이슈 트래킹 (Linear 또는 GitHub Issues)
- [ ] 크리티컬 버그 24h 이내 핫픽스 체제
- [ ] 온보딩 전환율 측정 (가입 → 첫 요청 프록시)

### 2E. Phase 2 성공 기준
- [ ] Product Hunt 주간 Top 5 진입
- [ ] 가입자 누적 200명+
- [ ] 유료 전환 50명+ ($950+ MRR) — Stripe 프로덕션 작동 전제
- [ ] **셀프호스팅 공식 Docker 이미지** `docker pull ghcr.io/.../spanlens` 배포
- [ ] 에이전트 트레이싱 실제 사용 프로젝트 10개+

---

## Phase 3 — Growth (Week 9~12, ~2026.07.20)

이상 탐지 + 팀 기능. Retention 확보 & $3,800 MRR 달성.

### 3A. 이상 탐지 & 최적화 (Week 9~10)
- [ ] 모델별 평균 latency/비용 이상치 탐지 (3-sigma)
- [ ] 프롬프트 주입·PII 감지 (경량 휴리스틱)
- [ ] 마이그레이션: `prompt_versions` (프롬프트 버저닝)
- [ ] 프롬프트 A/B 비교 뷰 (비용·성공률·latency)
- [ ] 모델 추천 엔진 (GPT-4o → Haiku 대체 제안)

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

### 3D. Phase 3 성공 기준 (90일 최종 목표)
- [ ] 가입자 누적 **500명+**
- [ ] 유료 유저 **200명+**
- [ ] **MRR $3,800+**
- [ ] 월간 처리 요청 **10M+**
- [ ] Day-30 리텐션 40%+
- [ ] 지원 티켓 응답 SLA 24h 이내
- [ ] NPS ≥ 30

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
| 결제/Stripe 장애 | Grace period 3일 + 알림 이중화 |
| ENCRYPTION_KEY 분실 | 운영 runbook + KMS 이관 검토 (Phase 3) |

---

## 조기 경보 (Tripwire) — 목표 미달 시 피벗 기준

Phase별 목표 수치에 못 미칠 경우 미리 정해둔 행동을 트리거. 감정이 아닌 수치로 결정.

| 시점 | 미달 조건 | 트리거 행동 |
|---|---|---|
| Week 4 (Phase 1 끝) | 내부 알파 테스트 회귀 버그 > 5건 또는 스트리밍 토큰 오차 > 3% | PH 런치 1주 연기 · 안정화 최우선 |
| Week 7 (런치 직전) | Waitlist 가입 < 100명 | 런치 포지셔닝 재검토 (메시지/타깃 채널 교체) |
| Week 8 (런치 후 1주) | 가입자 < 150명 | GTM 채널 전환 (HN → dev Twitter/Reddit 집중) |
| Week 10 | MRR < $500 | 가격 재검토 (Starter $19 → $9 실험 또는 무료 리밋 축소) |
| Week 12 | 유료 전환율 < 5% (가입 대비) | 온보딩 마찰 진단 + 피벗 후보 점검 (트레이싱 특화 vs 비용 특화) |

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
