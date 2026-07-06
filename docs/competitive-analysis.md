# Spanlens Competitive Analysis

> **목적**: Spanlens의 전체 기능 인벤토리와 경쟁사 5종(Langfuse, Helicone, LangSmith, Braintrust, Arize Phoenix) 대비 차별점을 한 곳에 정리한 내부 분석 문서.
> **기준일**: 2026-05-21 · **owner**: founder
>
> ⚠️ **STALE WARNING (2026-06-16 기준 26일 경과)**: 경쟁사 가격/포지셔닝은 빠르게 변동. 마케팅 `/compare/*` 페이지나 영업 자료 인용 전 각 경쟁사 사이트에서 가격/플랜 재확인 권장. 특히 Helicone(인수 후 로드맵 불확실), Langfuse Pro 가격, LangSmith 무료 티어 변경 가능성 체크.
>
> 이 문서는 Spanlens 마케팅(`/compare/*`) 페이지의 근거이자, 제품 결정과 로드맵 우선순위의 reference이다.
> 경쟁사 항목은 마지막 검증 시점 기준 공개 정보를 토대로 하며, 사실 오류 발견 시 즉시 수정한다.

---

## 0. Executive Summary

Spanlens는 **proxy-first LLM observability 플랫폼**이다. 다른 도구들이 SDK wrapper, OTel exporter, framework integration을 요구하는 동안, Spanlens는 `baseURL` 한 줄만 바꾸면 OpenAI / Anthropic / Gemini / Azure OpenAI 모든 호출이 즉시 캡처된다.

전체 코드베이스가 **MIT 라이선스 단일 트리**로 공개되어 있어 commercial folder(예: Langfuse `ee/`) 같은 라이선스 경계가 없다. Docker Compose 한 줄로 self-host 가능하고, 동시에 `spanlens.io`에서 free / $29 / $149 / Enterprise 가격대의 managed cloud로도 제공된다.

핵심 차별점은 6가지로 압축된다:

1. **1-line baseURL proxy install** — 코드 변경 없이 1분 안에 instrumentation 완료
2. **Critical Path on agent traces** — 멀티스텝 agent에서 longest dependency chain 자동 계산
3. **Prompt A/B with Welch t-test** — 통계적 유의성을 built-in으로 보고
4. **Judge-to-human correlation tracking** — LLM judge가 human rater와 얼마나 일치하는지 metric으로 노출
5. **Model swap recommender with dollar figures** — "gpt-4o → gpt-4o-mini로 바꾸면 월 $412 절약" 같은 구체적 권장
6. **ClickHouse fallback-replay queue** — 분석 DB 장애 시 Postgres 큐로 fallback 후 자동 replay (silent log loss 방지)

타겟은 **글로벌 LLM 애플리케이션 개발자**, 특히 Next.js / FastAPI / Hono로 production 트래픽을 운영하면서 cost / quality / latency 답을 빠르게 얻고 싶은 팀이다. ML 엔지니어, 데이터 과학자, 또는 LangChain 풀스택 전용 팀은 우리의 main persona가 아니다.

---

## 1. Spanlens 제품 전체상

### 1.1 스택

| Layer | Technology |
|------|-----------|
| Web app | Next.js 16 (App Router) on Vercel |
| API server | Hono on Vercel (Node runtime, maxDuration 300s) |
| Auth / OLTP | Supabase PostgreSQL (RLS-enabled) |
| Analytics OLAP | ClickHouse Cloud Development tier |
| TypeScript SDK | `@spanlens/sdk` (npm) |
| Python SDK | `spanlens` (PyPI) |
| CLI | `@spanlens/cli` (npm) |
| Billing | Paddle (Merchant of Record) |
| Email | Resend |
| Provider key leak scan | GitGuardian |

### 1.2 인증 계층

- `/proxy/*` — `authApiKey` 미들웨어 (SHA-256 hash 검증)
- `/api/*` — `authJwt` 미들웨어 (Supabase JWT)
- `/api/v1/me/key-info` — `authApiKey` 단독 (CLI introspection)
- DB 쓰기는 `supabaseAdmin` (service_role, RLS bypass), 읽기는 RLS 적용

### 1.3 핵심 데이터 흐름

```
Client SDK → POST /proxy/openai/v1/chat/completions
         → [API Key 검증] → [Provider Key 복호화 (AES-256-GCM)]
         → Upstream OpenAI/Anthropic/Gemini
         → Response passthrough + body.tee()
         → 비동기 로깅 (fireAndForget) → ClickHouse `requests` 테이블
         → CH 장애 시 Supabase `requests_fallback` 큐로 자동 backup
         → cron `/replay-fallback` 5분 간격으로 CH 복구 후 이관
```

요청은 clien이 첫 byte를 받기까지 sync, 그 이후 로깅은 fully async fire-and-forget. p99 overhead < 3ms.

---

## 2. 핵심 기능 인벤토리

### 2.1 Observability — 관측

| 기능 | 상세 |
|------|------|
| Request log | 모든 LLM call의 model, tokens (input/output/cache), cost, latency, full request/response body, status, error |
| Streaming reconstruction | SSE/streaming 응답을 마지막 chunk까지 누적해 완전한 response body로 저장 |
| Cache token billing | Anthropic / OpenAI prompt-cache hit을 reduced rate로 정확히 계산 |
| Agent tracing | Trace ID로 묶인 multi-step span tree, Gantt-style waterfall 렌더링 |
| **Critical Path** | Agent trace에서 longest dependency chain 자동 계산 후 highlight |
| Retry span annotation | 같은 span의 retry 여부 표시 |
| Per-user analytics | `x-spanlens-user` 헤더로 태깅된 호출을 `/users` 페이지에서 user-level cost / token / error / model 집계 |
| Session 뷰 | `x-spanlens-session` 헤더 기반 session-level 집계 (P1 진행 예정) |
| Saved filters | model, status, cost range, tags 등 자주 쓰는 쿼리를 pin |
| Data export | CSV / JSON으로 request 로그 다운로드 |

### 2.2 Cost — 비용

| 기능 | 상세 |
|------|------|
| Per-request cost | provider별 동적 가격표(`model_prices` 테이블, 5분 SWR 캐시) 기반 정확 계산 |
| Daily / weekly rollup | 시계열 비용 트렌드 |
| Budget alerts | 일/주/월 단위 임계치 초과 시 이메일 알림 |
| **Model savings recommender** | 트래픽을 분석해 "이 routes를 gpt-4o-mini로 옮기면 월 $X 절약" 같은 구체적 권장. Compare 버튼으로 현재/추천 모델 side-by-side 즉시 실행 |
| Cost certainty mode | overage off 옵션으로 quota 도달 시 hard-block |

### 2.3 Prompts & Experiments — 프롬프트 관리

| 기능 | 상세 |
|------|------|
| Prompt 버전 라이브러리 | 이름 + 시맨틱 버전 관리, Markdown editor |
| 프롬프트 diff | 두 버전 side-by-side diff |
| **A/B traffic split** | `X-Spanlens-Prompt-Version: name@v1\|name@v2` 헤더로 점진적 rollout 또는 50/50 split |
| **Welch t-test** | A/B 결과의 latency / cost / judge score에 대해 통계적 유의성(Welch's t-test) 자동 계산. averages만이 아니라 p-value 보고 |
| Prompt playground | 변수 주입해서 dashboard에서 실제 호출 후 응답 + 비용 확인 |
| Gradual rollout | 헤더에 weight 지정해 단계별 트래픽 이동 |

### 2.4 Eval & Quality — 평가

| 기능 | 상세 |
|------|------|
| LLM-as-judge | 사용자 정의 rubric으로 LLM 자체 채점 evaluator 등록 |
| Human annotation queue | trace에 사람이 직접 점수 매기는 큐 |
| **Judge ↔ human correlation** | LLM judge 점수와 human 점수 사이 Pearson correlation을 metric으로 노출. judge drift 감지 |
| IAA (Inter-Annotator Agreement) | 여러 reviewer 일치도 계산 |
| Datasets | golden test set 빌드해 prompt 변경 때마다 re-run |
| Experiments | 두 prompt version을 동일 dataset에 돌려 score 비교 |
| Heuristic evaluator | regex / contains / json-schema 등 비-LLM 평가 (P2) |

### 2.5 Security — 보안

| 기능 | 상세 |
|------|------|
| API key leak detection | request/response body에서 `sk-`, `sk-ant-`, `sk-proj-`, `AIza`, `sl_live_` 패턴 매칭 후 자동 마스킹 + Security dashboard 플래그 |
| PII detection | SSN, IBAN (mod-97 검증), credit card (Luhn), email, phone, passport 정규식 매칭 |
| Prompt-injection detection | 잠재적 instruction override 패턴 검출 |
| Per-call log-body opt-out | `X-Spanlens-Log-Body: full \| meta \| none` 헤더로 body 저장 수준 제어 |
| Security export | flagged된 호출만 별도 export |
| GitGuardian provider key scan | 등록된 provider key에 대해 매일 leak 검사 |
| Stale key digest | 90일 이상 미사용 provider key에 대해 weekly 정리 이메일 |

### 2.6 Reliability — 안정성

| 기능 | 상세 |
|------|------|
| **ClickHouse fallback-replay** | CH INSERT 실패 시 Supabase `requests_fallback` 큐에 payload 보관. cron `/replay-fallback`이 5분 간격 batch로 재시도. 7일/100회 retry 후 만료 |
| Stream deadline | `STREAM_DEADLINE_MS=290000` (290초)에 graceful close + `truncated:true` 마킹. Vercel maxDuration 300초 한계 안에서 안전 |
| Fire-and-forget logging | `fireAndForget(c, promise)` 헬퍼로 `@vercel/functions` `waitUntil` 래핑. Edge/Node 모두 drain 보장 |
| Async ingestion | 로깅 실패가 client 응답에 영향 없음. Spanlens는 critical path에 sit 안 함 |

### 2.7 Anomaly Detection — 이상 탐지

| 기능 | 상세 |
|------|------|
| 3σ baseline | 7일 rolling baseline 대비 latency/cost/error rate 3σ 이상 deviation 감지 |
| Contributing factors | anomaly 발견 시 token delta, HTTP status breakdown 등 RCA hint 제공 |
| Real-time triggering | 호출 도착 시점에 평가 (배치 아님) |
| Alert system | 5개(Pro) / unlimited(Team)까지 alert rule, 이메일 + Slack + webhook |
| Anomaly confidence | 다층 검증으로 false-positive 감소 (P3.2) |

### 2.8 Integrations — 통합

| 종류 | 지원 |
|------|------|
| Provider proxy | OpenAI, Anthropic, Gemini, Azure OpenAI |
| Local LLMs | Ollama (SDK wrapper `observeOllama()`) |
| TypeScript SDK | `@spanlens/sdk` — Next.js, Hono, Bun, Cloudflare Workers 등 모두 first-class |
| Python SDK | `spanlens` — sync + async, OpenAI/Anthropic/Gemini integration |
| Framework | LangChain (JS + Python), LlamaIndex (JS + Python), Vercel AI SDK, LangGraph |
| OpenTelemetry | OTLP/HTTP ingest 지원 (`POST /v1/traces`, `gen_ai.*` semantic conventions) |
| Outbound webhooks | `request.created`, `trace.completed`, `alert.triggered` 이벤트 HMAC-서명된 payload |
| Direct sinks | S3 / BigQuery 등 (P3) |

### 2.9 Team & Workspaces

| 기능 | 상세 |
|------|------|
| Multi-workspace | sb-ws 쿠키로 워크스페이스 전환, multi-tenant 격리 |
| Role | `admin` / `editor` / `viewer` (last admin 보호) |
| Email invitations | 7일 만료, SHA-256 hash token, Resend 발송 |
| Pending invitation banner | dashboard 상단 surface |
| Audit log | 모든 membership / role / settings 변경 기록 |
| SSO (SAML / Okta) | Enterprise plan |

### 2.10 Deployment — 배포

| 옵션 | 상세 |
|------|------|
| Managed cloud | spanlens.io — free / $29 / $149 / Custom |
| Docker Compose self-host | repo 클론 후 `docker-compose up` 한 줄 |
| Full MIT license | 전체 트리, EE 폴더 없음 |
| Postgres 17 + ClickHouse | self-host 시 Supabase 대신 stock PG 사용 가능 |

---

## 3. 고유 차별점 (Unique Differentiators)

### 3.1 1-line baseURL proxy install

**왜 차별점인가**: SDK-기반 instrumentation (Langfuse, Phoenix, Braintrust)이나 framework wrapping (LangSmith)을 요구하는 경쟁사들과 달리, Spanlens는 환경변수 하나 또는 `baseURL` 한 줄 교체로 끝난다. 기존 codebase에 LLM call site가 100개 있어도 instrumentation 비용은 동일하게 "한 줄".

**구현**: `apps/server/src/proxy/*.ts`에서 OpenAI/Anthropic/Gemini/Azure를 각각 passthrough proxy로 구현. SDK는 `createOpenAI()` 같은 thin wrapper만 제공 (실제 인증/로깅은 서버에서).

### 3.2 Critical Path on agent traces

**왜 차별점인가**: 멀티스텝 agent의 latency 문제 RCA는 "어떤 스팬이 가장 길었나"가 아니라 "어떤 dependency chain이 가장 길었나"이다. 병렬 실행되는 짧은 스팬들보다 직렬로 묶인 중간 스팬이 critical일 수 있다. Spanlens는 이를 자동으로 계산해 노란 highlight로 강조한다.

**구현**: `components/traces/gantt.tsx`에서 span tree DAG 위에 longest path algorithm. parent_span_id를 따라가며 cumulative duration 계산.

### 3.3 Prompt A/B with Welch t-test

**왜 차별점인가**: prompt v1과 v2의 평균 비용/지연이 다르다고 진짜 차이인지, sample noise인지 알 수 없다. 통계적 유의성 검정 없이 "v2가 더 좋다"는 결론은 위험하다. Spanlens는 등분산을 가정하지 않는 Welch's t-test를 built-in으로 돌려 p-value를 보고한다.

**구현**: `apps/server/src/api/promptABTest.ts`에서 두 group 데이터 fetch 후 mean/variance 계산 → Welch t-statistic + degrees of freedom (Welch-Satterthwaite) → p-value.

### 3.4 Judge-to-human correlation tracking

**왜 차별점인가**: LLM-as-judge는 빠르고 싸지만 human ground truth에서 drift할 수 있다. Spanlens는 같은 trace에 human annotation과 LLM judge 점수가 모두 있으면 Pearson correlation을 계산해 dashboard에 노출한다. 0.6 미만으로 떨어지면 judge prompt 재설계 시그널.

**구현**: `apps/server/src/lib/eval-correlation.ts` (P2 구현 예정 / 부분 완료).

### 3.5 Model savings recommender with dollar figures

**왜 차별점인가**: cost dashboard만 보여주는 도구는 많다. "그래서 어떻게 줄이지?"의 답을 주는 건 적다. Spanlens는 traffic pattern을 분석해 "이 classification route는 gpt-4o-mini로 충분, 월 $412 절약"처럼 실행 가능한 권장사항을 점수와 함께 제시한다. Compare 버튼으로 추천 모델을 즉석 테스트도 가능.

**구현**: `apps/server/src/lib/model-recommend-rules.ts` — short-prompt classification 패턴 감지, response length 분포 분석, exact-match + longest-prefix model lookup.

### 3.6 ClickHouse fallback-replay queue

**왜 차별점인가**: 대부분 도구는 분석 DB INSERT 실패 시 silent loss. Spanlens는 CH 장애 시 자동으로 Supabase `requests_fallback`에 payload 보관 → cron이 5분 간격으로 batch retry → CH 복구 후 자동 replay. 운영 hiccup이 production logs 손실로 이어지지 않는다.

**구현**: `apps/server/src/lib/logger.ts` (catch + fallback INSERT) + `apps/server/src/lib/fallback-replay.ts` + `/cron/replay-fallback`.

### 3.7 Paddle MoR billing (operational differentiator)

**왜 차별점인가**: 글로벌 SaaS의 가장 큰 hidden cost는 VAT/GST/sales tax 컴플라이언스이다. Stripe는 customer-of-record가 우리이므로 200개국 세금 신고를 우리가 해야 한다. Paddle은 Merchant of Record로서 이 부담을 인수한다. Day 1부터 글로벌 판매 가능. (이건 product feature가 아니라 operational 차별점이지만, self-host 결정의 핵심 변수가 되기도 한다.)

---

## 4. 아키텍처 결정과 트레이드오프

### 4.1 Proxy vs SDK

| | Proxy (Spanlens, Helicone) | SDK (Langfuse, Phoenix, Braintrust) |
|---|------------------------------|----------------------------------------|
| 설치 비용 | 1-line baseURL | 매 call site wrapping |
| 코드 변경 | 환경변수만 | imports + 함수 호출 변경 |
| 추가 latency | network hop 1회 (~3-15ms) | in-process (0ms) |
| 캡처 완전성 | 100% (서버에서 record) | sampling 가능 |
| 디버깅 가능성 | local에선 보이지 않음 | local에서 print 가능 |
| Streaming | server-side tee()로 100% 캡처 | wrapper가 chunk 받아야 |

**결론**: Spanlens는 application developer가 production traffic을 빠르게 instrumentation하는 게 1차 목표라 proxy를 택했다. 단, OTel/OTLP ingest도 동시 지원해 "이미 OTel 쓰는 팀"도 수용한다.

### 4.2 ClickHouse vs Postgres for analytics

| | ClickHouse (Spanlens) | Postgres (대다수) |
|---|------------------------------|------------------------------------|
| OLAP 쿼리 속도 | very fast (columnar) | row-based, 인덱스 의존 |
| Cardinality | 수십억 row OK | 수억 row 시 어려움 |
| INSERT 비용 | batch friendly | row-by-row OK |
| RLS | 없음 (lib에서 강제) | native |
| 운영 부담 | Cloud Dev tier $50/mo | Supabase 무료 |
| Backup | snapshot 별도 | Supabase 자동 |

**트레이드오프**: ClickHouse는 RLS가 없어 멀티테넌트 격리를 application layer에서 강제해야 한다. `lib/requests-query.ts`의 `requestsScope` 헬퍼가 모든 read에 `organization_id` 필터를 자동 주입하는 게 그 답.

### 4.3 TypeScript Hono vs Python FastAPI for backend

**결정**: TypeScript (Hono). 이유는 (1) Vercel Node runtime 친화적, (2) Next.js와 같은 언어로 fullstack 가독성, (3) TS SDK와 backend가 같은 타입을 공유, (4) Hono는 Edge-portable이라 향후 Cloudflare Workers 이전 옵션도 열려있음.

**대가**: Python ML 생태계 직접 호출 불가. ML-heavy feature(예: embedding drift)는 별도 microservice 또는 client-side compute로 우회.

### 4.4 Full MIT vs OSS + EE folder

**결정**: 전체 트리를 MIT로 공개. SSO, audit logs, enterprise feature도 같은 라이선스.

**해자는 어디서?**: 코드 자체가 아니라 (1) SaaS 운영 (managed cloud), (2) brand, (3) support, (4) integration depth, (5) data network effect (model price db, anomaly baseline).

**Langfuse 비교**: Langfuse는 `ee/` 폴더가 commercial license. SSO나 일부 analytics는 OSS 빌드에서 막혀 있다. 이 모호한 라이선스 경계는 large enterprise 결정에 friction. Spanlens는 이 ambiguity가 없음.

**미래**: Sentry처럼 BSL 전환 옵션은 열려있음. 복제 위협이 실제로 커질 때 검토.

---

## 5. 정직한 약점 (Honest Weaknesses)

### 5.1 Smaller community
- Langfuse: 수천 GitHub stars, 활발한 Discord
- Spanlens: 더 작은 footprint, 성장 중

### 5.2 Smaller integration list
- 4개 provider proxy (OpenAI, Anthropic, Gemini, Azure) + Ollama SDK
- Helicone, Langfuse는 20개+ provider 지원
- **완화책**: OpenAI-compatible endpoint generic 지원 + AWS Bedrock 추가 예정

### 5.3 No embedding drift / projector
- Phoenix는 UMAP 기반 embedding visualization 제공
- Spanlens는 ML-engineer-friendly tool이 아니라 의도적 패스
- application dev persona에는 fit하지 않음

### 5.4 No LangGraph native graph view
- LangSmith는 LangGraph의 nodes/edges/state를 graph topology로 렌더링
- Spanlens는 OTel span으로 받아 waterfall로만 표시
- LangGraph 사용자에게는 LangSmith가 우월

### 5.5 No public prompt hub
- LangSmith Hub처럼 community에 prompt 공유하는 marketplace 없음
- 현재는 workspace-local 라이브러리만

### 5.6 Eval marketplace 부재
- Langfuse는 toxicity, helpfulness 등 pre-built evaluator 다수
- Spanlens는 LLM-as-judge + 사용자 정의 rubric 중심
- P2에서 heuristic evaluator 추가 예정

### 5.7 Side-by-side eval diff UI
- Braintrust의 diff UX가 더 polished
- Spanlens는 dataset + experiments로 비슷한 워크플로 가능하나 UX 갭 있음

### 5.8 Body 10KB cap
- 현재 storage 절약을 위해 10KB 초과 body는 truncate
- P3에서 S3 풀바디 옵션 추가 예정

### 5.9 Fulltext 본문 검색
- Postgres에서는 가능, ClickHouse 이전 후 일시적으로 lost
- P3에서 ClickHouse-native 또는 외부 인덱스로 복원 예정

---

## 6. 경쟁사별 상세 분석

### 6.1 Langfuse

**그들의 위치**: OSS LLM observability의 de-facto leader. 2023년 출범, 수천 GitHub stars, EU(독일) 본사.

**그들의 강점**:
- Mature 생태계 — 수많은 integration, community contribution
- OTel-native instrumentation
- Datasets-as-a-product 워크플로
- Pre-built evaluator marketplace
- 활발한 community + docs

**그들의 약점**:
- SDK-기반 instrumentation 강요 (기존 codebase에 fit 어려움)
- `ee/` 폴더의 commercial license boundary
- SSO 같은 기능이 OSS 빌드에 없음
- A/B test의 통계 layer는 BYO

**Spanlens가 이기는 곳**:
- Integration speed (1-line vs SDK wrapping)
- License clarity (full MIT)
- Statistical rigor (Welch t-test built-in)
- Judge-to-human correlation as a metric
- Model swap recommendations
- Critical Path computation

**그들이 이기는 곳**:
- Community size / GitHub stars
- OTel pedigree
- Pre-built evaluator marketplace
- Datasets feature 성숙도

**Target overlap**: 80% — 둘 다 production LLM app 개발자 대상

---

### 6.2 Helicone

**그들의 위치**: YC-backed, proxy-based의 reference player. Spanlens와 가장 architecture가 닮은 경쟁사.

**그들의 강점**:
- 검증된 proxy 모델
- 광범위한 provider 지원
- Gateway 기능(rate limiting, caching, retries)이 강력
- 긴 트랙 레코드, 다수 public case study

**그들의 약점**:
- 통계적 A/B test 부재
- Critical Path 계산 없음
- Judge ↔ human correlation 미명시
- Log durability 안전망 약함

**Spanlens가 이기는 곳**:
- Critical Path on agent traces
- Welch t-test on A/B
- Judge-to-human correlation
- ClickHouse fallback-replay (silent log loss 방지)
- Model savings recommendations

**그들이 이기는 곳**:
- 트랙 레코드 / docs 깊이
- Gateway features (rate limiting, caching at edge)
- Provider 커버리지 breadth
- Simpler ops surface for tiny teams

**Target overlap**: 90% — architecture가 가장 가까움. Spanlens는 same architecture + deeper analytics 포지셔닝.

---

### 6.3 LangSmith

**그들의 위치**: LangChain의 commercial offering. LangChain stack에 가장 깊이 통합된 observability.

**그들의 강점**:
- LangChain / LangGraph 자동 instrumentation
- LangGraph topology native 렌더링
- LangSmith Hub (community prompt marketplace)
- LangChain Inc.의 단일 vendor 지원

**그들의 약점**:
- LangChain 외부 traffic은 manual SDK 호출 필요
- LangChain abstraction에 lock-in
- Enterprise self-host만 가능 (sales gate)
- Framework-agnostic team에 부적합

**Spanlens가 이기는 곳**:
- Framework-agnostic install (proxy)
- No LangChain lock-in
- MIT + Docker self-host
- Statistical A/B testing
- Model savings recommendations

**그들이 이기는 곳**:
- LangChain / LangGraph deep integration
- LangGraph graph topology view
- LangSmith Hub
- Single-vendor support for LangChain users

**Target overlap**: 50% — LangChain 풀스택 팀은 LangSmith로, 아닌 팀은 Spanlens로. 명확한 segmentation.

---

### 6.4 Braintrust

**그들의 위치**: Eval-first 도구. Series A. 가장 polished한 eval UX.

**그들의 강점**:
- Side-by-side model output diff UI (업계 최고)
- 다양한 모델 비교 playground
- Experiment-driven workflow가 product 그 자체
- Scoring rubric / regression detection

**그들의 약점**:
- 관측(per-request log, agent trace, anomaly detection) 약함
- 100% closed-source SaaS, self-host 불가
- 데이터 외부 전송 불가능한 워크로드는 사용 불가
- Cost dashboard / model recommendation 부재

**Spanlens가 이기는 곳**:
- Full observability stack
- Self-host (MIT + Docker)
- Proxy-based no-code-change instrumentation
- Cost tracking + savings recommender
- Critical Path agent tracing
- Built-in security scanning

**그들이 이기는 곳**:
- Eval UX의 polish (diff, scoring, regression)
- Multi-model playground
- Experiment-as-culture 워크플로

**Target overlap**: 40% — Braintrust는 eval-as-release-gate 팀에, Spanlens는 observability-first 팀에. 보완적 segmentation.

---

### 6.5 Arize Phoenix

**그들의 위치**: Arize(엔터프라이즈 ML observability)의 OSS offshoot. ML-engineer 친화적 도구.

**그들의 강점**:
- OpenInference 스펙의 reference implementation
- ML observability DNA (embedding drift, UMAP projector)
- Notebook-driven exploration 워크플로
- Python ML 생태계 깊은 통합
- Arize 엔터프라이즈로의 upgrade path

**그들의 약점**:
- JS/TS support가 second-class
- SDK-기반 instrumentation
- Application dev workflow에 부적합
- Managed cloud는 enterprise sales gate
- Statistical A/B test 부재
- Cost recommendation 부재

**Spanlens가 이기는 곳**:
- App developer 친화적 UX
- JS/TS first-class (Python과 동격)
- Proxy install
- Transparent SMB pricing (no enterprise sales)
- Welch t-test A/B
- Model savings recommendations
- Critical Path

**그들이 이기는 곳**:
- ML engineer / notebook workflow
- OpenInference standard 깊이
- Embedding projector / drift analysis
- Arize 엔터프라이즈 upgrade path

**Target overlap**: 30% — Phoenix는 ML 엔지니어, Spanlens는 application 개발자. 거의 다른 페르소나.

---

## 7. 시장 포지셔닝

### 7.1 4-quadrant map

```
                  Framework-coupled
                       ▲
                       │
              LangSmith│
                       │
                       │
   Eval-focused◄───────┼───────►Observability-focused
                       │
                       │ Braintrust            Helicone
                       │                       Langfuse
                       │ Phoenix               Spanlens
                       │
                       ▼
                  Framework-agnostic
```

- **Spanlens 위치**: framework-agnostic + observability-focused with eval included
- **가장 가까운 위치**: Helicone (architecture), Langfuse (scope)
- **반대편**: LangSmith (framework-coupled), Braintrust (eval-only)

### 7.2 Differentiator weight matrix

| 차별점 | 영향력 | 검증 비용 | Spanlens 우위 강도 |
|---------|--------|-----------|------------------------|
| 1-line proxy install | 🔥 High | 🟢 Low (1분 데모) | 🟢 명확 |
| Critical Path | 🟡 Mid | 🟡 Mid (예시 trace 필요) | 🟢 명확 |
| Welch t-test A/B | 🔥 High (data team) | 🟢 Low (스크린샷) | 🟢 명확 |
| Judge ↔ human correlation | 🟡 Mid (eval team) | 🟡 Mid | 🟡 일부 (Langfuse partial) |
| Model savings recommender | 🔥 High (FinOps) | 🟢 Low (예시 수치) | 🟢 명확 |
| ClickHouse fallback-replay | 🟢 Low (운영팀만 관심) | 🔴 High (장애 시나리오) | 🟢 명확 |
| Fully MIT | 🟡 Mid (enterprise) | 🟢 Low (라이선스 비교) | 🟢 명확 |

### 7.3 Anti-positioning (we explicitly don't compete here)

- **LangGraph-first teams** — LangSmith 권장
- **Eval-as-release-gate teams** — Braintrust 권장
- **ML engineers with notebook workflows** — Phoenix 권장
- **OpenInference standard 헌신** — Phoenix 권장
- **수십개 provider 동시 지원** — Helicone breadth 권장 (당분간)

이 명확한 anti-positioning이 "모든 팀에 fit한다"는 메시지보다 신뢰를 빌드한다.

---

## 8. 타겟 고객 정의

### 8.1 Ideal Customer Profile (ICP)

- **Team size**: 1~30명 engineering org
- **Stack**: Next.js / FastAPI / Hono / Cloudflare Workers 중 하나
- **LLM usage**: 월 50K~10M requests
- **Use case**: customer-facing LLM feature (챗봇, 요약, 분류, RAG)
- **Pain**: "production에서 뭐가 비싸지? 뭐가 느리지? 뭐가 깨졌지?"
- **Budget**: $29 ~ $499/mo self-serve
- **Compliance**: PII 처리, audit log 필요, but full enterprise sales 부담

### 8.2 Non-ICP

- LangChain만 쓰는 팀 → LangSmith
- ML 엔지니어 / notebook user → Phoenix
- Eval-driven release culture → Braintrust
- 100명+ enterprise with dedicated FinOps → 별도 BI 도구
- 단순 cost dashboard만 필요 → OpenAI usage page

### 8.3 GTM 채널

- **SEO**: `/compare/*` 페이지로 "Langfuse alternative" 등 키워드 흡수
- **OSS** : GitHub README + 한국/북미 dev community
- **Content**: 기술 블로그 (proxy 아키텍처, Welch t-test 도입 후기)
- **Word-of-mouth**: indie hacker / YC startup 네트워크

---

## 9. 가격 비교

### 9.1 Spanlens

| Plan | Price | Requests / mo | Retention | Seats |
|------|-------|---------------|-----------|-------|
| Free | $0 | 50K | 14d | 1 |
| Pro | $29 | 100K (+$8/100K overage) | 90d | 3 |
| Team | $149 | 1M (+$5/100K overage) | 365d | 10 |
| Enterprise | Custom | Custom | Custom | Unlimited |

### 9.2 경쟁사 비교 (2026-05 기준 공개 정보)

| Product | Free | Cheapest Paid | Self-host |
|---------|------|---------------|-----------|
| **Spanlens** | 50K req | $29 Pro | Free MIT Docker |
| Langfuse | 50K obs | $29 Hobby | Free OSS Docker (EE 별도) |
| Helicone | 10K req | $20 Pro | Free OSS Docker |
| LangSmith | 5K traces | $39 Plus | Enterprise sales only |
| Braintrust | 1K logs | $249/mo Team | Not available |
| Arize Phoenix | OSS only | Arize sales | Free OSS |

**관찰**: Spanlens는 Free tier가 가장 풍부($0에 50K req)하고, paid 가격이 Langfuse와 같으며 retention/seat가 비교 가능. Enterprise sales를 강요하지 않는 transparent SMB 가격이 차별점.

---

## 10. 전략적 함의 / Roadmap 우선순위

### 10.1 단기 (1~2개월)

1. **GitHub stars/community growth** — current가장 큰 약점. README polish, launch HN/Reddit, content marketing.
2. **AWS Bedrock proxy** — provider breadth 추가
3. **OpenAI-compatible generic endpoint** — 20개+ provider를 한 번에 흡수
4. **Side-by-side eval diff UI** — Braintrust 갭 좁히기 (P2)
5. **Embedding similarity (lightweight)** — Phoenix 갭 완화 (full projector는 안 하더라도 nearest-neighbor 같은 기본 기능)

### 10.2 중기 (3~6개월)

1. **Public prompt hub** — LangSmith Hub 갭 좁히기
2. **Heuristic evaluator types** — regex / contains / json-schema
3. **OTel outbound export** — Datadog / Honeycomb / New Relic 등으로 emit
4. **Custom dashboard builder** — 위젯형 dashboard
5. **Full-text 본문 검색** — ClickHouse-native 인덱스
6. **10KB → S3 풀바디**

### 10.3 장기 (6~12개월)

1. **Multi-modal tracing** — image, audio, video input
2. **Compliance certifications** — SOC 2 Type II, ISO 27001, HIPAA BAA
3. **Enterprise SSO depth** — Okta, Azure AD, custom SAML
4. **Region rollout** — EU data residency (Frankfurt), APAC (Tokyo)
5. **Built-in eval marketplace** — Langfuse parity

### 10.4 명시적 비목표 (Won't do)

- LangChain orchestration 기능 (LangChain 그 자체)
- Notebook 환경 / Python-first repositioning
- Eval-as-primary-product repositioning
- ML training observability (Arize 본업)
- Full BSL 라이선스 전환 (당분간) — open core / managed cloud로 충분

---

## 11. 마지막 검토 체크리스트

이 문서를 매 분기 1회 업데이트할 때 다음을 확인:

- [ ] 경쟁사 각각의 공개 docs / pricing 페이지 재방문
- [ ] Spanlens 자체 feature 인벤토리가 최신 코드와 일치
- [ ] `/compare/*` 마케팅 페이지의 사실 주장이 이 문서와 sync
- [ ] 새 경쟁사 출현 여부 (Hugging Face, Weights & Biases 등의 LLM-shift)
- [ ] Pricing 페이지 비교 표 업데이트
- [ ] Roadmap 우선순위 재평가 (특히 약점 항목)

---

**문서 위치**: `docs/competitive-analysis.md`
**관련 문서**:
- `docs/plans/competitive_parity_roadmap.md` — 갭 채우기 작업 계획
- `apps/web/app/compare/*` — 공개 마케팅 페이지
- `CLAUDE.md` — 프로젝트 컨텍스트
- `README.md` — 공개 product 소개
