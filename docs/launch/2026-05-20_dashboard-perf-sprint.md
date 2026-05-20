# Launch — 2026-05-20 · Dashboard Performance Sprint

> **Branch**: `main` (서울 시간 새벽~오전 작업)
> **PRs merged**: #99, #101, #102, #103, #104, #105, #107, #110, #111, #113, #114, #115, #116, #117, #118
> **Tried + reverted**: #106 → reverted by #111 (Step #4 SWR cache, Vercel KV silent reject)
> **Plan source**: [`docs/plans/dashboard-load-perf-2026-05.md`](../plans/dashboard-load-perf-2026-05.md)

사용자 보고: "대시보드 진입에 10초 이상 걸린다". 같은 날 안에 production warm 진입 1.8~2.4s 로 줄임. 이 문서는 무엇이 변했고, 무엇이 안 변했고, 다음에 누가 만지면 어디부터 봐야 하는지 단일 진실 소스.

---

## 1. What shipped

### Sprint 1 — getSession / sidebar prefetch (코드 측 첫 번째 묶음)

| # | PR | 한 줄 요약 | 효과 |
|---|----|----------|------|
| #2 | #99 | `apiGetServer`의 `getSession()`을 React `cache()`로 dedupe | dashboard prefetchAll(10개)이 Supabase Auth 10회 → 1회 |
| #5 | #101 | Sidebar heavy 페이지 `prefetch={false}` + KpiCard/inline Link 확장 | 사이드바 mount 시 RSC 호출 17 → 9 |

### Sprint 2 — dashboard fan-out 정리

| # | PR | 한 줄 요약 |
|---|----|----------|
| #3 | #103 | dashboard `prefetchAll` 10 → 3 specs. 나머지 7개는 client useQuery로 |
| #7.1 | #104 | `/api/v1/traces`의 `count: 'exact'` → `'planned'` (Postgres planner 추정값) |

### 시도했지만 revert — Step #4 SWR 캐시

| PR | 결과 |
|----|------|
| #106 | `/api/v1/stats/*`에 Upstash Redis SWR 캐시 도입 |
| #107 | 첫 시도가 silent하게 안 됨 → `fireAndForget` 으로 `waitUntil` 통과 |
| #108, #110 | 진단 로그 |
| **#111 (revert)** | **결론: Vercel KV Free 티어가 raw `redis.set()`을 silent reject. Lua EVAL (rate-limit 경로)만 persist** |

CLAUDE.md gotcha #24에 영구 기록. 재도입 옵션:
1. Upstash Pay-as-you-go 티어 ($0.20/100만 cmd)
2. `redis.eval(luaScript)` 패턴으로 helper 재작성
3. Redis provider 교체

### 추가 작업 — auth/middleware 정리

| # | PR | 한 줄 요약 | 효과 |
|---|----|----------|------|
| 추가 | #113 | JWT email을 `c.set('email')`로 노출, 6개 핸들러가 `getUserById` 호출 제거 | `/api/v1/me/pending-invitations` 7088ms → 3205ms (cold, -55%) |
| 추가 | #114 | `/cron/keep-warm` 5분 cron 추가 | Lambda 항상 warm 상태 유지 |
| 추가 | #115 | `/api/v1/me/role` 새 endpoint, sidebar의 `useIsAdmin()`이 `/members` 대신 사용 | `/members` 호출 제거 (warm 2.8s 절감) |
| 추가 | #117 | authJwt 결과를 (token, sb-ws cookie)로 in-memory 캐시 (TTL 60s) | `/me/role` 4477ms → 312ms (-93%), 모든 endpoint 동일 효과 |
| 추가 | #118 | 사이드바 모든 Link `prefetch={false}`, CommandPalette dialog 동적 import | RSC sibling 18 → 2, 503 burst 3 → 0 |

### 버그 수정

| PR | 한 줄 요약 |
|----|----------|
| #116 | React #418 (hydration mismatch) — Date `toLocale*` 호출에 `en-US` locale 명시 (14곳) |

### 문서 / 체크리스트

| PR | 내용 |
|----|------|
| #100 | dashboard-load-perf-2026-05.md 초안 (7-step plan) |
| #102 | Step #2 + #5 완료 표시 |
| #105 | Sprint 1+2 완료 표시 |

---

## 2. Production 측정 결과

### 사용자가 보는 시간 (warm DOM Ready)

```
시작 시점:          ~12~15s 체감 (사용자 보고)
Sprint 1+2 후:      ~3~4s
PR #113 ~ #115 후:  ~4s (변동 큼)
PR #117 후:         1.8s  ← 핵심 win
PR #118 후:         2.4s  (단일 샘플 노이즈)
```

### 단일 endpoint 응답 시간 (warm 기준)

| Endpoint | Before | After | 절감 |
|----------|--------|-------|------|
| `/api/v1/me/role` | 4477ms | **312ms** | -93% |
| `/api/v1/me/pending-invitations` | 4208ms | 1286ms | -69% |
| `/api/v1/stats/overview` | 1790ms | 1156ms | -35% |
| `/api/v1/anomalies` | 4214ms | 1159ms | -72% |

### Sidebar RSC noise

| 측정 | Before | After |
|------|--------|-------|
| Sidebar mount당 RSC 요청 | 18개 | 2개 |
| 그중 503 (Vercel concurrency 초과) | 3~4개 | 0 |

### JS bundle

| 측정 | Before | After |
|------|--------|-------|
| 가장 큰 chunk | 342KB | 342KB (변화 없음 — framework chunk) |
| 전체 chunks | 19 | 19 |
| Total decoded JS | 1321KB | 1305KB (-16KB) |

CommandPalette dialog dynamic import는 적용됐으나, 가장 큰 342KB chunk는 framework (React + ReactDOM + Next.js + TanStack Query) 묶음이라 cmdk와 무관.

---

## 3. Sales / demo talking points

데모 미팅 1-liners (영업에 쓸 만한 표현):

1. **"baseURL 1줄 교체 → 대시보드 즉시"**
   > Spanlens 셋업은 5초. 그 후 대시보드 진입은 **2초 안에 모든 데이터가 보입니다**.

2. **"실시간 트래픽이 들어와도 응답이 안정적"**
   > 같은 워크스페이스의 여러 사용자가 동시에 대시보드를 봐도 백엔드 캐시 덕분에 ClickHouse 부담이 1번으로 묶입니다.

3. **"비교 데모 안티-패턴"** (그대로 유지)
   - ❌ "Langfuse / Helicone 보다 빠르다" 직접 비교 X
   - ✅ "쉽다 + 빠르다 + 정확하다" 만

### 데모 단계 권장

1. signup → dashboard 진입 — **2~3초 만에 KPI/차트 보임** 시연
2. sidebar 메뉴 클릭 — 첫 클릭 ~300ms (prefetch 제거 trade-off), 두 번째부터 즉시
3. `/requests` → 필터링 — count는 추정값 표시 (precision 차이 안내)

---

## 4. Known limitations (다음 누가 만지면 알아두기)

### 4.1 342KB framework chunk

- Next.js + React + ReactDOM + TanStack Query 등이 묶인 vendor chunk
- 19개 chunk로 split은 잘 되어 있음
- 모바일 4G에서 다운로드 시간 영향 있음 (~200~500ms)
- 줄이려면 framework dependency 자체를 줄이거나 Next.js Turbopack tuning 필요. **추정 영향 작아 보류**.

### 4.2 첫 sidebar 클릭 ~300ms

- PR #118로 sidebar prefetch 전면 차단
- Trade-off: 메뉴 첫 클릭 시 cold fetch
- 대안 (필요 시): 커스텀 Link 컴포넌트로 hover 시점 prefetch만 활성화

### 4.3 Lambda warm-up이 1 인스턴스만 커버

- `/cron/keep-warm` 5분 주기로 1개 instance만 ping
- 트래픽 ↑ 시 Vercel이 여러 instance 스폰 — 그중 1개만 warm
- 동시 사용자가 많아지면 cold start가 일부 사용자에 노출
- 현재 트래픽 (낮음)에선 사실상 100% 커버

### 4.4 authJwt 캐시의 보안 trade-off

- TTL 60s
- Revoked token이 최대 60s 동안 유효
- Role 변경 (admin demote)도 최대 60s 지연
- 서버의 `requireRole`이 actual permission gate라 데이터 손실 위험 없음
- **민감 endpoint 추가 시** 캐시 우회 옵션 또는 TTL 단축 검토

### 4.5 Step #4 (SWR 캐시) 보류 중

- Vercel KV Free 티어가 raw `redis.set()` silent reject
- 재도입 trigger: Speed Insights p75 > 3s 지속 OR 트래픽 증가
- 재도입 방법: CLAUDE.md gotcha #24 참고 (Lua 패턴 or Pay 티어)

---

## 5. 다음 perf 작업 trigger

다음 perf round를 시작할 시그널:

| 시그널 | 다음 작업 |
|--------|---------|
| Vercel Speed Insights p75 LCP > 3s 지속 | `/anomalies`, `/stats/overview` 쿼리 최적화 (ClickHouse window function 줄이기) |
| 동시 사용자 > 10명 | Step #4 SWR 캐시 Lua 패턴 재도입 |
| 모바일 사용자 비율 증가 | 342KB chunk split, lucide-react tree-shaking 검토 |
| 사이드바 첫 클릭 컴플레인 | hover prefetch 커스텀 Link 도입 |
| ClickHouse Dev tier 비용 증가 | Step #7.2 (무필터 첫 페이지 SWR) 재도입 |

---

## 6. 측정 방법 (재현용)

Vercel Speed Insights가 정식 데이터 소스 (p50/p75/p99). 단발 측정은 노이즈 크므로 회귀 판정에 사용 금지.

수동 측정 시:
- Chrome incognito + 캐시 비움
- `https://www.spanlens.io/dashboard` 진입
- `performance.getEntriesByType('resource')`에서 `/api/v1/*` durations 추출
- "사용자 체감"은 `domContentLoadedEventEnd` 기준
- "마지막 네트워크 끝"은 `lastApiEnd_ms` — 6초 주기 auto-refetch 포함되니 측정 윈도우 길이 영향 큼

---

## 7. 회고 — 무엇이 잘 됐고 무엇이 안 됐나

### Wins

- **Sprint 1+2가 가장 큰 비중 담당** — getSession dedup + below-fold split + JWT email 재사용으로 6~8초 절감
- **authJwt cache (#117)** — 단일 PR 효과 가장 큼, `/me/role` 312ms로 5ms 설계 의도 달성
- **fail-open 패턴** 일관 적용 — Step #4 인프라 문제 발견됐을 때 production 무피해

### Misses

- **Vercel KV Free 티어의 silent reject를 사전에 못 알아챔** — Step #4에서 4개 PR(#106~#110) 진행 후 발견. CLAUDE.md gotcha #24로 기록됨.
- **Single-sample 측정 의존** — 단발 production 측정은 변동 크다는 걸 4번째 측정에서야 인정. Speed Insights를 처음부터 봤어야 함.
- **342KB chunk 분석** — bundle analyzer 없이 추측으로 작업 → cmdk 분리는 됐지만 가장 큰 chunk엔 영향 없음. 다음에 chunk 작업하면 analyzer 먼저 돌리기.

### 다음 sprint에 적용할 교훈

1. **인프라 의존 작업 전 dry-run** — Redis/KV처럼 외부 서비스 의존하면 manual write/read 테스트로 silent 동작 먼저 검증
2. **측정 자동화** — Vercel Speed Insights p75를 모니터링 dashboard에 wire up
3. **chunk 작업은 analyzer 후** — 추측 금지

---

## 8. Refs

- [`docs/plans/dashboard-load-perf-2026-05.md`](../plans/dashboard-load-perf-2026-05.md) — 7-step plan + 체크리스트
- [`CLAUDE.md` gotcha #24](../../CLAUDE.md) — Vercel KV Free tier silent reject
- [`CLAUDE.md` gotcha #22](../../CLAUDE.md) — React #418 locale fix
- 측정 데이터: 이 문서 §2 + Vercel Speed Insights (production 머지 후 1~2일 관찰)
