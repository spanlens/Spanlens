# Competitive Parity Roadmap

> **목적**: Langfuse / Helicone 대비 Spanlens가 빠지거나 수준이 낮은 13개 항목을 모두 채우기 위한 개발 계획.
> **기준일**: 2026-05-14 → **최종 업데이트**: 2026-05-15 · **owner**: TBD
>
> 우선순위는 "유저 가치 ÷ 구현 비용" 기준이며, 의존성과 인프라 부담을 함께 고려해 정렬했다.
> 각 항목은 _현재 상태 → 목표 상태 → 단계별 작업 → DB/API/UI 변경 → 추정 공수 → 의존성_ 의 6칸 구조를 유지한다.

---

## 0. 우선순위 매트릭스

| # | 기능 | 영향도 | 구현 난이도 | 의존성 | Phase | 상태 |
|---|------|--------|-------------|--------|-------|------|
| 1 | User analytics 전용 뷰 | 🔥 High | 🟢 Low | — | **P1** | ✅ 완료 (2026-05-14) |
| 2 | Session 전용 뷰 | 🔥 High | 🟢 Low | requests.session_id (DONE) | **P1** | ⏳ 진행 예정 |
| 3 | Annotation 다중 reviewer 평균/일치도 | 🟡 Mid | 🟢 Low | IAA(DONE) | **P1** | ⏳ 진행 예정 |
| 4 | Cache 토큰 별도 비용 계산 | 🔥 High | 🟢 Low | — | **P1** | ✅ 완료 (2026-05-14) |
| 5 | Heuristic Evaluator 타입 | 🟡 Mid | 🟡 Mid | evals(DONE) | **P2** | ⏳ 진행 예정 |
| 6 | Experiments N-arm 확장 | 🟡 Mid | 🟡 Mid | experiments(DONE) | **P2** | ⏳ 진행 예정 |
| 7 | Playground 멀티 모델 비교 | 🟡 Mid | 🟡 Mid | playground(DONE) | **P2** | 🔶 부분 완료 — Savings 페이지에 Compare 버튼 추가 (현재 모델 vs 추천 모델 side-by-side 실행). 독립 Experiments 탭은 별도 P2 항목 |
| 8 | 스트리밍 응답 본문 캡처 | 🟡 Mid | 🟡 Mid | parser(DONE) | **P2** | ✅ 완료 (2026-05-14) |
| 9 | Full-text 본문 검색 | 🟡 Mid | 🔴 High | pg_trgm | **P3** | ⏳ 진행 예정 |
| 10 | 10KB body cap → S3 풀바디 | 🟡 Mid | 🔴 High | R2/S3 인프라 | **P3** | ⏳ 진행 예정 |
| 11 | OTel Export (outbound) | 🟢 Low | 🟡 Mid | otlp(DONE) | **P3** | ⏳ 진행 예정 |
| 12 | Custom Dashboard (위젯 빌더) | 🟢 Low | 🔴 High | stats API | **P4** | ⏳ 진행 예정 |
| 13 | Multimodal Tracing | 🟢 Low | 🔴 High | S3 + parser 확장 | **P4** | ⏳ 진행 예정 |

> **Phase 구분**
> - **P1 (1주차)** — 기존 데이터로 신 화면만 추가하면 끝나는 quick win
> - **P2 (2–4주차)** — 마이그레이션 + API 1–2개 추가
> - **P3 (5–8주차)** — 외부 인프라 의존 또는 스키마 변경 큼
> - **P4 (9주차+)** — 별도 product surface, 전용 작업 필요

---

## P1 · Quick Wins (1주 내 마감 목표)

### 1. User Analytics 전용 뷰

**현재 상태**
- `requests.user_id` 컬럼은 존재 (mig `20260513040000_requests_user_session.sql`)
- SDK 헬퍼 `withUser()` / `with_user()` 구현됨
- `/requests?userId=…` 필터링 지원
- **단, 유저별 집계 화면 자체 없음** — Langfuse `/users`, Helicone User analytics 탭과 동일한 surface 부재

**목표 상태**
- `/users` 라우트 신설 — 테이블: userId, 첫 요청, 마지막 요청, 총 요청 수, 토큰, 비용, 평균 latency, 평균 사용 모델
- 행 클릭 → `/users/[id]` 상세 페이지 (시간순 request 리스트 + 사용 패턴 차트)
- 사이드바 `OBSERVE → Users` 진입점

**단계별 작업**
1. **server**: `apps/server/src/api/users.ts` 새 라우터
   - `GET /api/v1/users` — params: `projectId`, `range`, `search`, `sort`, `limit`, `offset`
   - `GET /api/v1/users/:userId` — 단일 유저 상세 (집계 + 최근 요청 50개)
   - SQL 한 방으로 `GROUP BY user_id` 집계 (request 수 / sum tokens / sum cost / max(created_at) / min(created_at))
2. **db function**: `get_user_analytics(p_org uuid, p_project uuid, p_from, p_to)` SQL function — 자주 호출되므로 인덱스 활용 plan 안정화
3. **index**: `requests (organization_id, user_id, created_at DESC)` partial index where `user_id IS NOT NULL` (mig 신규)
4. **web**: `apps/web/app/(dashboard)/users/page.tsx` + `[userId]/page.tsx`
5. **navigation**: sidebar 메뉴 추가

**DB 변경** (mig: `YYYYMMDDHHMMSS_users_analytics.sql`)
```sql
CREATE INDEX requests_org_user_created_idx
  ON requests (organization_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- 집계 함수
CREATE FUNCTION get_user_analytics(...)
```

**API 변경**
- `GET /api/v1/users` (신규)
- `GET /api/v1/users/:userId` (신규)

**UI 변경**
- `/users` 라우트, sidebar 항목
- 유저별 토큰/비용 stacked area chart (Recharts)

**추정 공수**: **2 days** (백엔드 0.5d, UI 1d, 인덱스/migr 0.25d, 테스트 0.25d)
**의존성**: 없음 (모든 데이터 준비됨)

---

### 2. Session 전용 뷰

**현재 상태**
- `requests.session_id` 컬럼 존재
- SDK 헬퍼 `withSession()` / `with_session()` 있음
- 필터링 가능
- **세션 단위 뷰 없음** — Helicone Sessions, Langfuse Session Replay와 같은 surface 부재

**목표 상태**
- `/sessions` 라우트 — 세션 목록 (sessionId, userId, 시작, 종료, 메시지 수, 총 비용, 마지막 모델)
- `/sessions/[id]` — 시간순 conversation replay (멀티턴 채팅 UI)
- request → response 본문을 timeline 형태로 렌더
- session_id가 같은 spans/traces도 묶어서 표시 (agent workflow 통합 뷰)

**단계별 작업**
1. **server**: `apps/server/src/api/sessions.ts`
   - `GET /api/v1/sessions` — list + 집계
   - `GET /api/v1/sessions/:id` — 단일 세션 내 모든 request + spans
2. **index**: `requests (organization_id, session_id, created_at)` partial index where `session_id IS NOT NULL`
3. **web**: `/sessions` list + `/sessions/[id]` replay
   - Replay UI: chat bubble 스타일, role(user/assistant)별 색상
   - 비용/토큰 stats bar 상단 고정
4. **deep link**: `/requests` 행에서 sessionId 클릭 → `/sessions/[id]` 이동
5. **trace integration**: 같은 session_id 가진 trace도 함께 표시 (옵션)

**DB 변경** (mig: `YYYYMMDDHHMMSS_sessions_index.sql`)
```sql
CREATE INDEX requests_org_session_created_idx
  ON requests (organization_id, session_id, created_at)
  WHERE session_id IS NOT NULL;
```

**API 변경**: `/api/v1/sessions` 2개 신규

**UI 변경**: `/sessions` 라우트 + sidebar

**추정 공수**: **2.5 days** (replay UI에 시간 더 듬)
**의존성**: 없음

---

### 3. Annotation 다중 Reviewer 평균/일치도 반영

**현재 상태**
- IAA(Inter-Annotator Agreement) 탭은 이미 구현됨 (`/annotation` Agreement 탭)
- **단, Pearson r 상관도 계산 시 한 reviewer의 최신 점수 1개만 사용** — `human-evals.ts:correlation` endpoint 기준
- `docs/features/annotation/page.tsx` Limitations 섹션에도 명시됨

**목표 상태**
- `correlation` endpoint가 reviewer당 점수를 평균내서 사용
- 옵션 파라미터 `aggregation`: `mean` | `median` | `latest` (default: `mean`)
- UI에 aggregation 토글 추가 — `/evals` 페이지 Pearson 카드 우상단
- "based on N reviewers, M paired samples" 부가 표시

**단계별 작업**
1. **server**: `apps/server/src/api/human-evals.ts:correlation`
   - 현재: `SELECT score FROM human_evals WHERE request_id = X LIMIT 1 ORDER BY updated_at DESC`
   - 변경: `SELECT AVG(score) FROM human_evals WHERE request_id = X GROUP BY request_id`
   - query param `aggregation` 추가, switch (`AVG` / `percentile_cont(0.5)` / `latest`)
2. **web**: Pearson r 카드 컴포넌트에 토글 UI 추가
3. **docs**: `/docs/features/annotation` Limitations 섹션 갱신 (해당 항목 제거)
4. **test**: pearson 계산기 단위 테스트 (mean 모드 검증)

**DB 변경**: 없음

**API 변경**: `GET /api/v1/human-evals/correlation?aggregation=mean` (param 추가)

**UI 변경**: `/evals` Pearson 카드 토글

**추정 공수**: **0.5 day**
**의존성**: 없음

---

### 4. Cache 토큰 별도 비용 계산

**현재 상태**
- Anthropic 응답에 `cache_read_input_tokens`, `cache_creation_input_tokens` 있음
- 현재 `lib/cost.ts`가 둘 다 `prompt_tokens`에 합산
- 실제 Anthropic 가격: `cache_read = input × 0.1`, `cache_creation = input × 1.25`
- **2–10× 잘못 계산되는 경우 있음** (특히 long-context RAG)

**목표 상태**
- `model_prices` 테이블에 `cache_read_price`, `cache_write_price` 컬럼 추가
- `requests` 테이블에 `cache_read_tokens`, `cache_write_tokens` 컬럼 추가 (NULL allowed)
- `calculateCost()` 시 cache breakdown 반영
- 대시보드 비용 카드에 "cache savings" 별도 표시
- Anthropic 외 OpenAI prompt caching도 동일 schema로 흡수

**단계별 작업**
1. **db migration**
   ```sql
   ALTER TABLE model_prices
     ADD COLUMN cache_read_price NUMERIC,
     ADD COLUMN cache_write_price NUMERIC;
   ALTER TABLE requests
     ADD COLUMN cache_read_tokens INT,
     ADD COLUMN cache_write_tokens INT;
   ```
2. **seeds**: `seeds/model_prices.sql` Anthropic / OpenAI 모델별 캐시 가격 추가
3. **parser**: `parsers/anthropic.ts` — `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens` 추출해서 별도 필드로 반환
4. **parser**: `parsers/openai.ts` — `usage.prompt_tokens_details.cached_tokens` 흡수
5. **lib/cost.ts**: cache breakdown 반영한 비용 계산기
   ```ts
   cost = (prompt_tokens - cache_read - cache_write) × prompt_price
        + cache_read × cache_read_price
        + cache_write × cache_write_price
        + completion_tokens × completion_price
   ```
6. **logger**: cache token 필드 INSERT
7. **UI**: `/requests/[id]` 상세 페이지에 cache breakdown 표시
8. **UI**: 대시보드 비용 카드 — "cache savings: $X.XX" 칩

**DB 변경**: 2개 신규 mig (`_model_prices_cache.sql`, `_requests_cache_tokens.sql`)
**API 변경**: 없음 (logger 내부 처리)
**UI 변경**: 비용 카드 + request 상세 페이지

**추정 공수**: **2 days** (parser 양쪽 + cost 함수 + DB + 시드 + UI)
**의존성**: 없음

> ⚠️ **gotcha**: 기존 row 의 비용은 다시 계산하지 않음 (re-aggregation 비용 큼). 마이그레이션 이후 신규 요청부터 정확. 과거 데이터 backfill은 별도 job 옵션.

---

## P2 · 중간 규모 (2–4주차)

### 5. Heuristic Evaluator 타입 추가

**현재 상태**
- `evaluators.type = 'llm_judge'` 하나뿐
- `eval_results.score` 컬럼 0..1 NUMERIC

**목표 상태**
- 추가 타입: `regex`, `json_schema`, `length`, `contains`, `latency`, `cost_threshold`
- 점수 타입 다양화: `numeric` (0..1), `boolean` (0/1), `categorical` (label)
- UI에서 evaluator 생성 시 type 드롭다운 + type별 config 폼

**단계별 작업**
1. **db migration**
   ```sql
   ALTER TABLE evaluators
     ADD COLUMN config JSONB DEFAULT '{}'::jsonb;
   ALTER TABLE eval_results
     ADD COLUMN score_type TEXT DEFAULT 'numeric',  -- numeric | boolean | categorical
     ADD COLUMN label TEXT;  -- for categorical
   ```
2. **server**: `apps/server/src/lib/evaluator-runners/` 디렉토리 신설
   - `llm-judge.ts` (기존)
   - `regex.ts`, `json-schema.ts` (Ajv), `length.ts`, `contains.ts`, `latency.ts`, `cost.ts`
   - `runEvaluator(evaluator, request)` dispatch 함수
3. **api**: `POST /api/v1/evaluators` body 변경 — `type` + `config` 받기
4. **web**: evaluator 생성/수정 폼에 type별 config UI
   - regex: pattern + flags
   - json_schema: schema JSON editor (Monaco)
   - length: min/max
   - contains: substring + case_sensitive
5. **catalog**: 미리 정의된 평가기 템플릿 4–5개 시드
   - "Output is valid JSON" (json_schema)
   - "Response under 500 chars" (length)
   - "Latency under 3s" (latency)

**DB 변경**: `_evaluators_heuristic.sql`
**API 변경**: 기존 evaluator 엔드포인트 body 확장
**UI 변경**: evaluator 폼 + catalog

**추정 공수**: **4 days**
**의존성**: 없음 (`evals` 인프라 위에 얹는 형태)

---

### 6. Experiments N-arm 확장 (현재 2-arm)

**현재 상태**
- `experiments` 테이블 — `arm_a_prompt_version_id`, `arm_b_prompt_version_id` 두 컬럼 고정
- UI도 2개 prompt version 하드코딩

**목표 상태**
- N개 prompt version 비교 가능 (보통 3–5개)
- 결과 테이블: 각 arm의 winner % / latency / cost
- 차트: arm별 score distribution overlay

**단계별 작업**
1. **db migration** — N-arm 정규화
   ```sql
   CREATE TABLE experiment_arms (
     id uuid PK,
     experiment_id uuid FK,
     prompt_version_id uuid FK,
     label TEXT,
     created_at timestamptz
   );
   -- 기존 arm_a / arm_b 데이터를 experiment_arms로 이전 (data mig)
   -- 기존 컬럼은 backward compat 위해 일단 남기되 deprecated 마킹
   ```
2. **server**: `experiments.ts` `runExperiment` 로직 — arms array를 돌면서 fork 호출
3. **api**: `POST /api/v1/experiments` body — `armPromptVersionIds: string[]`
4. **web**: 실험 생성 UI — "+ Add arm" 버튼, drag reorder
5. **stats**: pairwise comparison 매트릭스 표시 (NxN 그리드)

**DB 변경**: `_experiment_arms.sql` (data backfill 포함)
**API 변경**: experiments 라우터 body 확장
**UI 변경**: 실험 생성/결과 페이지 전면 개편

**추정 공수**: **5 days**
**의존성**: 기존 experiment 데이터 migration이 핵심 — backward compat 신경 써야 함

> ⚠️ **gotcha**: 기존 `arm_a_prompt_version_id`/`arm_b_prompt_version_id` 참조하는 client 코드를 모두 grep 해서 함께 수정. 깜빡 두면 dashboard에서 NULL FK 빠짐.

---

### 7. Playground 멀티 모델 사이드바이사이드 비교

**현재 상태**
- `/playground` 또는 prompts-playground 단일 실행
- 단일 모델 결과만 표시

**목표 상태**
- 동일 prompt를 N개 모델 / N개 prompt version에 동시에 던지고 결과 사이드바이사이드 표시
- Tool calling 지원 (function definitions UI)
- Structured output (JSON schema) 지원

**단계별 작업**
1. **web**: `/playground` UI 재설계
   - 좌측: prompt editor (system + user 메시지)
   - 우측: column별 "model / version" 선택 → "Run all" 버튼
   - 각 column에 stream 결과 + cost + latency
2. **server**: `prompts-playground.ts` — 동시 N개 모델 호출 (Promise.all)
3. **tool calling**: prompt 옆에 "Tools" 탭 — JSON 정의 입력 → 모델별 tool_calls 응답 비교
4. **structured output**: "Response format" 드롭다운 — JSON schema 입력 시 OpenAI `response_format: json_schema` 모드

**DB 변경**: 없음 (playground는 휘발성)
**API 변경**: `/api/v1/playground/run` body — `targets: [{model, promptVersionId}, ...]`
**UI 변경**: `/playground` 전면 개편

**추정 공수**: **5 days**
**의존성**: 없음

---

### 8. 스트리밍 응답 본문 캡처

**현재 상태**
- 스트림은 `body.tee()`로 클라이언트 + 로깅 두 갈래로 분기
- **현재 로깅 갈래에서 response_body 누락 (parser는 usage만 추출)**
- request 상세 페이지에서 streamed response는 본문 NULL

**목표 상태**
- streaming 청크를 누적해서 final text를 `response_body`에 저장
- size cap (10KB) 동일 적용
- OpenAI / Anthropic / Gemini parser 모두 대응

**단계별 작업**
1. **parser** — 각 parser의 chunk 누적 로직 확장
   - `parsers/openai.ts` — `delta.content` 누적 → `assembledText` 반환
   - `parsers/anthropic.ts` — `content_block_delta.text` 누적
   - `parsers/gemini.ts` — `candidates[0].content.parts[0].text` 누적
2. **proxy**: stream 종료 시점에 logger 호출 시 `response_body: assembledText` 포함
3. **size cap**: `assembledText.slice(0, 10_000)` (P3에서 S3로 옮길 때까지 임시)
4. **edge case**: stream abort 시 부분만이라도 저장 (try/finally)
5. **test**: openai-mock + anthropic-mock 스트림 fixture로 회귀 테스트

**DB 변경**: 없음
**API 변경**: 없음
**UI 변경**: 없음 (자동으로 표시됨)

**추정 공수**: **2 days**
**의존성**: 없음
**주의**: Vercel `fireAndForget()` 패턴 유지 — assembledText 누적은 stream 끝난 후 promise → `fireAndForget()`로 전달

---

## P3 · 인프라 의존 (5–8주차)

### 9. Full-text Body Search

**현재 상태**
- `/requests` 검색은 `model ILIKE '%X%'`만 지원
- 본문 검색 불가

**목표 상태**
- request_body / response_body 풀텍스트 검색
- 한국어 + 영어 둘 다 처리
- 검색 highlight + 점수 정렬

**단계별 작업**
1. **postgres extension**: `pg_trgm` 활성화 (`CREATE EXTENSION pg_trgm`)
   - tsvector + GIN 인덱스도 옵션 (tsvector는 형태소 분석 영어 위주 → trgm이 한국어 친화)
2. **db migration**
   ```sql
   CREATE INDEX requests_body_trgm_idx
     ON requests USING gin (
       (coalesce(request_body::text, '') || ' ' || coalesce(response_body::text, ''))
       gin_trgm_ops
     );
   ```
3. **server**: `requests.ts` search query —
   ```sql
   WHERE search_text ILIKE '%' || $1 || '%'
   ORDER BY similarity(search_text, $1) DESC
   ```
4. **web**: 검색창 옆 "Match body" 토글 + 검색어 highlight (mark.js)
5. **performance**: 대용량(>10M rows)에서 검색 query plan 확인 — partial index 필요할 수도

**DB 변경**: `_requests_body_search.sql` (GIN index)
**API 변경**: `GET /api/v1/requests?q=…&searchBody=true`
**UI 변경**: 검색창 옵션

**추정 공수**: **3 days**
**의존성**: pg_trgm은 supabase 기본 제공
**주의**: GIN 인덱스 크기 매우 큼 (테이블의 30–50%). 대용량 환경에선 partition 후 인덱스 고려

---

### 10. 10KB Body Cap → S3 풀바디 아카이브

**현재 상태**
- `request_body` / `response_body` 컬럼이 10KB 초과 시 truncate
- 긴 RAG context, document summarization 워크로드에서 본문 잘림

**목표 상태**
- 10KB 이하면 그대로 DB 저장
- 초과 시 Cloudflare R2 (또는 S3) 업로드 후 URL만 DB 저장
- `/requests/[id]` 페이지에서 lazy fetch
- Self-host 사용자도 R2 / S3 / 로컬 디스크 중 선택

**단계별 작업**
1. **infra**: Cloudflare R2 버킷 + IAM 발급, env `R2_*` 4종 추가
2. **lib**: `apps/server/src/lib/blob-storage.ts` — `uploadBody()`, `getBody()` 추상화 (R2 / S3 / local 어댑터)
3. **db migration**
   ```sql
   ALTER TABLE requests
     ADD COLUMN request_body_url TEXT,
     ADD COLUMN response_body_url TEXT;
   ```
4. **logger**: 본문 > 10KB 시 R2 업로드 → URL을 컬럼에 저장, 기존 body 컬럼은 truncate된 preview만
5. **api**: `GET /api/v1/requests/:id/body?part=request|response` — presigned URL 또는 stream
6. **UI**: 본문 영역에 "Load full body (15.3KB)" 버튼 — 클릭 시 lazy fetch
7. **GDPR**: 본문 삭제 (`DELETE /requests/:id`) 시 R2 객체도 함께 삭제
8. **self-host**: `BLOB_STORAGE_BACKEND` env (`r2` | `s3` | `local` | `none`) — none이면 truncate 유지

**DB 변경**: `_requests_body_url.sql`
**API 변경**: `/api/v1/requests/:id/body` 신규
**UI 변경**: lazy load 버튼

**추정 공수**: **6 days** (스토리지 추상화 + 인프라 + 데이터 마이그 + UI)
**의존성**: R2 계약 / 자체 호스팅 stratrategy 결정 필요

> ⚠️ **gotcha**: stream 응답은 P2 #8 작업과 결합. 누적 본문이 10KB 넘으면 즉시 R2로 우회 업로드.

---

### 11. OTel Export (Spanlens → 외부 APM)

**현재 상태**
- OTel 수신만 가능 (`/otlp/v1/traces` endpoint)
- 외부 APM (Datadog, Honeycomb, Grafana Tempo)로 export 불가

**목표 상태**
- 워크스페이스 설정에서 OTel exporter endpoint 등록
- Spanlens spans / requests를 OTLP 포맷으로 변환해 외부에 push
- Sampling rate 설정 가능

**단계별 작업**
1. **db**: `otel_exporters` 테이블 신설 (org_id, endpoint, headers, sampling_rate, enabled)
2. **server**: `apps/server/src/lib/otel-exporter.ts` — Spanlens row → OTLP Span proto 변환기
3. **cron**: 5초마다 미발송 span을 batch push (queue table 또는 outbox 패턴)
4. **proto**: `@opentelemetry/otlp-transformer` 활용 (공식 npm 패키지)
5. **UI**: 워크스페이스 settings → "Integrations → OpenTelemetry export" 폼
6. **test**: Honeycomb sandbox에 실제 push해서 도착 확인

**DB 변경**: `_otel_exporters.sql`
**API 변경**: `/api/v1/integrations/otel-exporters` CRUD
**UI 변경**: settings 페이지에 섹션 추가

**추정 공수**: **5 days**
**의존성**: 옵션 outbox 테이블 + cron 트리거

---

## P4 · 별도 Product Surface (9주차+)

### 12. Custom Dashboard (위젯 빌더)

**현재 상태**
- `/dashboard`는 고정 카드 (요청 수, 비용, latency p95 등)
- 사용자가 위젯 조합 불가

**목표 상태**
- Langfuse 식 위젯 빌더: 드래그앤드롭 grid, 차트 종류 / 메트릭 / 필터 조합
- 위젯 종류: line, bar, pie, big number, table, heatmap
- 저장 가능한 named dashboard (per-org, per-project)

**단계별 작업**
1. **db**: `dashboards`, `dashboard_widgets` 2개 테이블
2. **query DSL**: 위젯 정의 JSON schema — `{metric, groupBy, filters, timeRange, chartType}`
3. **server**: 통합 `POST /api/v1/dashboards/:id/query` — DSL을 SQL로 변환해 실행
   - 안전성: DSL은 whitelist 된 metric / filter만 허용, raw SQL 금지
4. **web**: `/dashboards` 라우트 — `react-grid-layout` + Recharts
5. **share**: dashboard 임베드 URL (token 기반)

**DB 변경**: `_dashboards.sql`
**API 변경**: `/api/v1/dashboards/*`
**UI 변경**: 신규 product surface

**추정 공수**: **15 days** (DSL 안전성 + 위젯 빌더 UI 큰 작업)
**의존성**: 명확한 metric/filter catalog 확정 필요

---

### 13. Multimodal Tracing

**현재 상태**
- 텍스트 LLM만 추적 (chat/completion)
- 이미지 입력 (Vision)도 base64 그대로 request_body에 들어가서 size cap에 걸림

**목표 상태**
- 이미지 / 오디오 input 자동 감지 → 별도 blob storage 저장
- request 상세 페이지에서 미리보기 (이미지 thumbnail, 오디오 player)
- 모달리티별 토큰/비용 분리 표시 (image token, audio second 단위)

**단계별 작업**
1. **db**: `request_attachments` 테이블 (request_id, modality, blob_url, size, mime)
2. **parser**: messages 배열 traversal — `image_url` / `image` / `audio` 콘텐츠 추출
3. **storage**: P3 #10의 blob storage 인프라 재활용
4. **cost**: 모달리티별 가격 시드 (e.g. GPT-4o image: $0.003765/image, Whisper: $0.006/min)
5. **UI**: request 상세에서 inline preview

**DB 변경**: `_request_attachments.sql`
**API 변경**: blob fetch endpoint
**UI 변경**: 미리보기 컴포넌트

**추정 공수**: **8 days**
**의존성**: P3 #10 (blob storage 인프라) 완료 필수

---

## 종합 일정 (예상)

```
Week 1   ████████ P1: User analytics + Sessions + Annotation avg + Cache cost
Week 2   ████████ P2: Heuristic evaluators
Week 3   ████████ P2: N-arm experiments
Week 4   ████████ P2: Multi-model playground + Stream body capture
Week 5   ████████ P3: Full-text search
Week 6   ████████ P3: Blob storage (S3/R2) infra
Week 7   ████████ P3: Blob storage UI + lazy fetch
Week 8   ████████ P3: OTel export
Week 9+  ████████ P4: Custom dashboard
Week 12+ ████████ P4: Multimodal tracing
```

**총 단순 합산 공수**: ~57 person-days (≒ 11주 1인 풀타임).
실제로는 review / QA / docs 포함하면 1.5x 보정 → **~16주차에 모두 완료**.

---

## 위험 / 결정 필요 사항

1. **Blob storage 백엔드 선택** — P3 #10 시작 전에 결정해야 함
   - Cloudflare R2 (egress 무료, S3 호환) ↔ AWS S3 (관성)
   - self-host 사용자에게도 옵션 제공? → 어댑터 패턴 필수
2. **Custom dashboard DSL의 안전성** — SQL injection 방지를 위해 metric/filter catalog 화이트리스트 정밀 설계 필요
3. **Cache 토큰 backfill** — 기존 row 비용 다시 계산할지 결정 (계산비용 큼, opt-in으로)
4. **N-arm experiments 데이터 마이그** — 기존 2-arm row → arms 테이블로 옮길 때 client 코드 충돌 — feature flag 두고 점진 전환 권장

---

## 작업 시 공통 규칙 (CLAUDE.md 발췌 재확인)

- 모든 DB 변경은 `supabase/migrations/YYYYMMDDHHMMSS_desc.sql` 새 파일로 추가, **기존 파일 수정 금지**
- `supabase db push` 후 반드시 `supabase gen types --lang typescript --local > supabase/types.ts`
- 새 테이블에 `ALTER TABLE … ENABLE ROW LEVEL SECURITY` 빠뜨리지 말 것
- 새 X-Spanlens-* 헤더 추가 시 4곳 모두 — 서버 매핑 / SDK 헬퍼 / `/docs/proxy` / `/docs/sdk`
- 새 cost calculation 모델 식별 로직은 **exact match + longest boundary-aware prefix** 패턴 유지
- 모든 비동기 로깅 / DB write은 `fireAndForget(c, promise)` 사용 (Vercel Edge drain 안정성)
- 검증: 변경 범위별 `pnpm typecheck && lint && test` 통과 후 PR
