# STATE OF REPO — 아카이브 통분석

> 작성: 2026-07-19 · 근거: ROADMAP.md, CLAUDE.md, spanlens-remaining-work.md, docs/plans/ 13개, docs/launch/ 회고 3개, ir/ 4개, git log 2026-06-07 이후 201커밋 (PR #239→#427)
>
> 목적: 문서 3벌(ROADMAP / remaining-work / platform-review)이 서로 다른 말을 하는 상태를 끝내는 단일 기준점.
> **런칭 목표 2026-08-03 기준 D-15.**

---

## 0. 한 줄 진단

ROADMAP.md는 6/7 이후 커밋 0회. 그 사이 201커밋이 쌓였고, 실질 로드맵은 `docs/plans/platform-review-roadmap-2026-06.md`로 이사했는데 아무도 공식 선언을 안 함. 회고에서 두 번 이상 반복된 실패 패턴 4개가 지금도 진행 중.

---

## 1. ROADMAP에 미완([ ])인데 실제로는 끝난 것 → 체크 처리 또는 삭제 대상

| ROADMAP 항목 | 실제 상태 | 근거 |
|---|---|---|
| L151 `[ ] ClickHouse 검토` | **완전 이관 완료.** requests 테이블은 ClickHouse 전용, CH 마이그레이션 8개 | CLAUDE.md gotcha 3, `docs/plans/clickhouse-migration.md`, ir/04 |
| L112 `[ ] Paddle KYC 통과` | **프로덕션 빌링 라이브 (2026-05-18 컷오버)** | ir/04 traction |
| L104 `[ ] Paddle 프로덕션 KYC 신청` | 위와 동일 — 신청은 당연히 끝남 | ir/04 |
| 프로바이더 3개 전제 (OpenAI/Anthropic/Gemini) | **~10개**: +Mistral, OpenRouter (#327/#328), +Groq, DeepSeek, xAI, Cohere (#382), +Azure, Ollama | git, `integrations-expansion-azure-ollama.md` |
| Phase 2C 트립와이어 "Wk8 KYC 미통과 시 중단" | 죽은 조건. KYC 통과됨 | — |

## 2. 출하됐는데 ROADMAP 어디에도 없는 것 → 문서 부채 (201커밋의 대부분)

git 테마별, 커밋 수 내림차순:

1. **Evals 플랫폼 심화 (~35커밋)** — pairwise judge (#354), judge↔human agreement + Cohen's κ (#360), 95% CI (#351), trajectory eval (#357), auto-run on new prompt version (#350), judge 결과 캐싱 (#361). ROADMAP 3I는 "Evals [x]" 한 줄뿐 — 실제 깊이의 5%도 반영 안 됨.
2. **에러 envelope 전면 이관 (~25커밋)** — ApiError 표준 + api-types 패키지 + Hono RPC (#276/#277), codemod로 100% 이관 (#296). ROADMAP에 개념 자체가 없음.
3. **프로바이더 + SDK 확장 (~22커밋)** — 위 표 참조. + FastAPI/ASGI 자동계측 python 0.8.0 (#383), SDK Mistral/OpenRouter (#425).
4. **SEO/마케팅 스프린트 P0–P3 (~20커밋)** — 59개 docs 페이지 JSON-LD (#394), 사이트 전역 스키마 (#427), /self-hosting 랜딩 (#308), pillar hubs, 비용 계산기.
5. **캐싱 3층 (~6커밋)** — judge 프롬프트 캐싱 (#368), 프록시 응답 캐싱 + 주간 다이제스트 (#400), 캐시 purge cron + SDK withCache (#403).
6. **cron 신뢰성 (~12커밋)** — self-monitor 워치독 (#260), GH Actions 안전망 (#280), run 로깅 await (#422).
7. **api.spanlens.io 호스트 이관 (~5커밋)** — #409/#410/#411, SDK v0.16.0, mcp-server v0.2.0.
8. **공개 피드백/로드맵 페이지 (~8커밋)** — 투표 테이블 (#298), 관리자 응답 UI (#302).
9. **OTLP export (~6커밋)** — #329, /v1/traces dual-write (#312).
10. **보안 하드닝 (~10커밋)** — 프리런칭 하드닝 (#388), CSV formula injection (#423), webhook SSRF 차단 (#317), dual-auth 갭 (#415).

릴리스: sdk v0.14→v0.17, python 0.7→0.8.1, mcp-server 0.1.3→0.2.1 (총 10 태그).

## 3. 문서 간 모순 — 어느 쪽이 진실인지 결정 필요

### 3a. 상태 모순
| 항목 | 문서 A | 문서 B | 판정 |
|---|---|---|---|
| SSO/SAML | ROADMAP L147: Phase 5B로 연기 | remaining-work #4: 엔터프라이즈 번들 핵심, 활성 작업 | remaining-work가 최신 (7/2). ROADMAP 갱신 필요 |
| Guardrails 차단 | ROADMAP 3A L132 "차단 모드 [x]" | remaining-work L62 "inline blocking guardrail ⬜" | **판정 완료 (07-19): 둘 다 맞음, 범위가 다름.** 기존 = regex injection 422 차단 (`proxy/shared/security-gate.ts`, 프로젝트별 opt-in). 잔여 = 업스트림 전 PII 삭제/수정 등 확장 guardrail (진짜 미구현) |
| Framework 통합 | ROADMAP 3E: SDK 완료 | remaining-work: Pydantic AI/DSPy/CrewAI ⬜ | 범위 정의가 다름. "완료"의 기준 명시 필요 |
| 조직 쿼터 | ROADMAP L148 "충족→Phase 5+" | remaining-work #6 feature-gating ⚠️ | remaining-work 우선 |

### 3b. 숫자 모순 (외부 노출되는 것 — 위험)
| 항목 | 값들 | 위험도 |
|---|---|---|
| **무료 한도** | clickhouse-migration: 50K · platform-review: 50K · **vercel-marketplace 카피: "100k"** | 🔥 마케팅이 2배 과대표기. PII 카피 사건(05-18) 재발 유형 |
| 가격 | ROADMAP: Starter $19/Team $49/Ent $99 · 현 사이트: Team $149 · ir: Team $149 vs Langfuse $271 | ROADMAP 가격표 죽음 |
| Next.js 버전 | CLAUDE.md: "16" · ir 전체 + gotchas: "14" | 하나는 오타/스테일 |
| Supabase 마이그레이션 수 | ir/01: 122 · ir/04: 126 | 투자 문서끼리 불일치 (2주 간격 스냅샷) |
| 프로바이더 수 | CLAUDE.md 서술: 3 · ir: 6 · 실제: ~10 | CLAUDE.md 인증/헤더 섹션이 3-프로바이더 세계관 |
| "No log loss" (ir) | CLAUDE.md gotcha 8/21/23/24/33/34 = 무음 손실 모드 6개 문서화 | 투자 주장은 완화-후 상태. 실사 시 설명 준비 필요 |

### 3c. 깨진 참조
- `docs/plans/launch-readiness-master-plan.md` — dmarc-setup, infrastructure-region-survey 등 3개 문서가 인용하는데 **파일이 존재하지 않음.**

## 4. 반복 언급되지만 결정 안 된 것

| 항목 | 등장 횟수/위치 | 방치 기간 |
|---|---|---|
| **PostHog 측정 배선** | 05-14 회고 §7 (체리픽 커밋 3개 명시, "30분 작업"), 코드 내 TODO 3개 (requests/users detail-client), "10+ DAU 시" 게이트 | 2개월+ |
| **dogfood 3+ 프로젝트** | ROADMAP L113 (현재 1개, traces=0), 트립와이어 Wk8 조건 | 트립와이어상 이미 위반 상태 |
| **Better Stack 외부 모니터** | remaining-work 사용자 액션, cron-server.yml 헤더 권고 | cron 96% 드랍 이슈의 최종 방어선인데 미설치 |
| **암호키 회전** | remaining-work #4 "🔥 단일키", ROADMAP L560 KMS 검토 | 런칭 전 최소 runbook 필요 |
| **DMARC DNS** | dmarc-setup-guide.md 전 체크박스 공란 (Gabia 수동 작업) | 이메일 도달률 직결 |
| **EU 레지던시** | survey 완료 → "아직 안 함" 결정 → 액션 아이템 미체크 | 결정은 됨. 체크만 안 됨 |
| **거대 클라이언트 파일 분할** | performance_optimization.md §7 측정표 전부 TBD — **한 번도 실행 안 된 계획.** settings 2464줄 / evals 2390줄 / requests 1704줄 여전 | 2개월+ |

## 5. 회고 3개에서 반복된 실패 패턴 (2회 이상)

1. **측정 없이 다음 기능으로 점프** — 05-14 (PostHog 컷, "측정 없이 건너뛰지 말 것" 명시) + 05-20 (단일 샘플 측정 의존). → 교훈이 문서화됐는데 **지금도 미실행** (§4 PostHog).
2. **무음 인프라 실패에 사이클 소모** — Vercel KV silent reject로 PR 4개 낭비 (#106–#110) + SSR "stuck" 오진 (Chrome-MCP 아티팩트) + Vercel cron 96% 드랍. 3회. → gotcha로 축적은 잘 됨. 남은 구멍: 외부 모니터 부재 (§4).
3. **마케팅 과대표기** — PII 카피 사건 (05-18) + 무료한도 100k 오기 (§3b, **현재 진행형**) + "no log loss" 주장. 3회.
4. **트랙션 0에서 기능만 축적** — DAU 1–2 (05-14), marketplace 가입 0 (06-05), GitHub 9 stars/0 forks (ir/04) 상태에서 evals에 35커밋. ROADMAP 자체 트립와이어(Wk14 가입<150)가 다가오는데 가입 유입 작업 비중이 낮음.

## 6. 보안 확인 결과

- `.env.local`: **커밋 이력 없음** (`git log --all --full-history` 공란), gitignore 적용 확인. 키 로테이션 불필요. ✅
- 루트의 4MB PDF/pptx/PNG 트래킹은 별건 — 공개 repo 위생 이슈로 남음 (커밋 f8b34cc 후속 미완).

---

## 이번 주 바로 할 일 5개 — 진행 상태 (2026-07-19 저녁 기준)

1. ✅ **ROADMAP.md 처분 선언** — 동결 배너 추가 + KYC 신청/통과/ClickHouse 3개 항목 체크 처리 완료.
2. ✅ **무료한도/가격 표기 전수 스캔** — 전체 grep 결과 실오류는 `vercel-marketplace.md` "100k" 1건뿐 → 50K 수정. terms/refund의 "under 100,000"은 Team 1M 쿼터의 10% 환불 기준으로 정상. 라이브 사이트(pricing/faq/llms.txt)는 모두 정확했음.
3. ✅ **PostHog 구현** — 체리픽 대신 정식 포팅 (5월 커밋 이후 eslint가 posthog-js import를 쿠키 동의 게이트 없이는 금지하도록 바뀜). 구현: `lib/posthog.ts` (typed 이벤트 카탈로그 + consent-gated capture + user ID 해싱), `components/providers/posthog-provider.tsx` (opt-in 후에만 SDK init, 동의 철회 시 opt-out), `components/cookie-consent-banner.tsx` (신규), `shouldShowBanner()` 활성화, TODO 3개 복원 (users_page_viewed / users_row_clicked / user_detail_viewed / cache_breakdown_viewed). typecheck ✅ lint ✅ test 65/65 ✅ build ✅. **잔여 유저 작업: Vercel에 `NEXT_PUBLIC_POSTHOG_KEY` 설정** (없으면 배너도 SDK도 완전 비활성 — 안전).
4. ✅ **Guardrails 판정** — §3a 참조. 둘 다 맞음, 범위 차이. 코드 수정 불필요.
5. 🟢 **외부 모니터** — Better Stack 가입/연결 확인됨 (status.spanlens.io: uptime 3개 라이브). heartbeat 코드 구현 완료 (`lib/cron-heartbeat.ts` + `logCronRun` 후킹, 테스트 4건 그린). **잔여 유저 작업: heartbeat 모니터 4개 생성 + Vercel env 4개** (`docs/plans/external-monitoring-setup.md` §B). 부수 발견: Proxy Deep 98.451% — 6월~7월 초 반복 다운 이력 조사 가치.

### 정정 (2026-07-19 저녁 — 웹 실측 후)
- **런칭은 이미 끝남.** ROADMAP의 "8/3 런칭 목표"는 동결 문서의 스테일 정보. 실제: Product Hunt 6월 초 런칭 완료 — 3 업보트, 댓글 1(메이커 본인). dev.to 3편 (5/27, 6/20, 7/8, 반응 1~2), glama.ai/promptzone/submithunt 등재. GitHub 9 stars/0 forks.
- **유통 채널 상태 (2026-07-19 기준)**:
  - Reddit: 섀도밴 상태, 이의제기 접수됨. 복구 전까지 포스팅 무의미 (보이지 않음). 대체 계정 생성은 ban evasion으로 영구밴 리스크 — 금지.
  - HN: 카르마 33. Show HN 제출물 전부 flagged. 당분간 카르마 수집 모드.
- **결론**: "기능 부족"이 아니라 "유통 차단+측정 부재"가 병목. 남은 가용 채널: SEO(이미 투자 중, 20커밋), 콘텐츠(dev.to/X), 디렉토리, 뉴스레터, 통합 마켓플레이스.

### 추가 발견 (이번 실행 중)
- eslint `no-restricted-imports`가 `@vercel/analytics`/`react`는 금지하는데 layout.tsx가 실제 쓰는 `@vercel/analytics/next` 서브패스는 목록에 없음 — 규칙 구멍으로 Vercel Analytics가 un-gated 배포 중. 규칙 저자 본인이 "non-essential cookies under GDPR"라고 적어놨으므로, (a) `/next`도 금지 목록에 추가하고 동의 게이트 뒤로 옮기거나 (b) cookieless 모드라고 판단해 규칙에서 3개 다 빼거나 — 제품 결정 필요.

### 다음 주로 미뤄도 되는 것
- launch-readiness-master-plan.md 재작성 (깨진 참조 3개 해소)
- CLAUDE.md 스테일 청소 (Next.js 버전, 프로바이더 수, CORS 날짜)
- ir/ 숫자 동기화 (122 vs 126) — 다음 피칭 직전에
- performance_optimization.md — 실행 안 할 거면 archive/로
