# Dashboard Load Performance — 7-Step Implementation Plan

작성: 2026-05-19 · 대상 브랜치: `claude/elegant-edison-4c75be` · 작성자: haeseong + Claude

> **2026-05-19 업데이트**: Step #7 추가 (`/requests`·`/traces` 등 list 페이지 전용 최적화). Step #1~#6은 `/dashboard` fan-out에 초점. List 페이지는 단일 쿼리지만 그 쿼리 자체가 무거워서 별도 트랙 필요.

## 0. 배경 (Why this plan)

대시보드 첫 진입이 5~6초 체감되는 문제. 실측은 FCP 1.1s지만, KPI/차트/익명 카드 등 모든 데이터가 채워지기까지 4~5초가 더 걸림. 추가로 `/requests`·`/traces` 같은 list 페이지도 비슷한 체감. 원인은 단일 문제가 아니라 **7개 누적**:

| # | 원인 | 영향 | 파일 |
|---|------|------|------|
| 1 | 서버 `apiGetServer`가 `cache: 'no-store'`로 fetch — 기존 `Cache-Control` 헤더 전부 무효화 | warm 진입 캐시 100% miss | [apps/web/lib/server/api.ts:28](apps/web/lib/server/api.ts:28) |
| 2 | `getSession()`이 prefetchAll 10개 쿼리 각각에서 호출 — Supabase Auth 왕복 10번 | `/dashboard` cold +300~600ms | [apps/web/lib/server/api.ts:19](apps/web/lib/server/api.ts:19) |
| 3 | `prefetchAll`이 10개 쿼리 전부 `await` — 가장 느린 것이 전체 TTFB 결정 | `/dashboard` cold +500~800ms | [apps/web/app/(dashboard)/dashboard/page.tsx:13](apps/web/app/%28dashboard%29/dashboard/page.tsx:13) |
| 4 | ClickHouse 집계 쿼리에 서버 측 캐시 없음 — SWR(fresh 10s / stale 60s)로 옛 데이터 윈도우 없이 캐시 가능 | 반복 진입 -150~250ms | `apps/server/src/lib/stats-queries.ts` |
| 5 | Next `<Link>`의 viewport prefetch가 12개 사이드바 항목 동시 트리거 | 서버 동시성 부담 | [apps/web/components/layout/sidebar.tsx:375](apps/web/components/layout/sidebar.tsx:375) |
| 6 | Web RSC → Hono server HTTP self-call 구조 — 같은 리전이라도 추가 30~80ms × N | 구조적 비용, 장기 | `apps/web/lib/server/api.ts` 전체 |
| 7 | `/requests`·`/traces` list 핸들러가 `count: 'exact'`(Supabase) / `countRequests`(CH) 강제 + 무필터 첫 페이지 비캐시 | list 페이지 cold +300~500ms | [apps/server/src/api/traces.ts:23](apps/server/src/api/traces.ts:23), [apps/server/src/api/requests.ts:111](apps/server/src/api/requests.ts:111) |

### 인프라 현황 (관련 사실관계)

- Web + Server 둘 다 Vercel `iad1` (Washington DC) — 같은 리전이지만 별도 함수
- ClickHouse Cloud Dev tier US — 같은 리전
- Rate Limit은 이미 Upstash Redis (Vercel KV) 사용 중 — 추가 작업 불필요
- 한국 사용자 RTT 단일 hop ~150ms

### Non-Goals (이 계획에서 다루지 않음)

- Suspense 스트리밍 재도입 — [16d83e6 revert](https://github.com/spanlens/spanlens/commit/16d83e6)의 TanStack Query injection race 미해결. 별도 R&D 필요
- JS 번들 크기 추가 최적화 — [performance_optimization.md](performance_optimization.md)에서 별도 트랙
- 마케팅 페이지 FCP — 같은 위 문서에서 다룸
- 다중 리전 / 한국 PoP — [infrastructure-region-survey.md](infrastructure-region-survey.md) 트리거 조건 미충족

---

## 1. Step #1 — `apiGetServer`에서 `cache: 'no-store'` 제거

### 문제

[apps/web/lib/server/api.ts:23-29](apps/web/lib/server/api.ts:23):
```ts
const res = await fetch(url, {
  headers: { ... },
  cache: 'no-store',   // ← 모든 fetch 캐시 무효화
})
```

서버([apps/server/src/api/stats.ts:82](apps/server/src/api/stats.ts:82))는 이미 `Cache-Control: private, max-age=10, stale-while-revalidate=30` 헤더를 내려보내지만, Next.js fetch가 `cache: 'no-store'`로 호출하면 **이 헤더가 무시되고 매번 origin까지 다녀옴**. 즉 서버팀의 캐시 작업이 작동을 안 함.

### 변경 사항

[apps/web/lib/server/api.ts](apps/web/lib/server/api.ts):

```ts
// Before
const res = await fetch(url, {
  headers: { ... },
  cache: 'no-store',
})

// After
const res = await fetch(url, {
  headers: { ... },
  // 서버가 내려주는 Cache-Control(`private, max-age=10, swr=30`)을 존중.
  // Per-user 데이터라 'private'이고, 짧은 max-age로 데이터 신선도 유지.
  // 인증이 필요한 엔드포인트는 Authorization 헤더가 캐시 키에 포함됨.
  next: { revalidate: 10 },
})
```

### 검증 방법

1. 로컬에서 `pnpm dev` 후 `/dashboard` 두 번 연속 진입
2. 두 번째 진입 시 Network 탭에서 `/api/v1/stats/overview` 응답 시간이 ~5ms (HIT)로 떨어지는지 확인
3. Vercel preview에서 동일 검증

### 리스크

- **사용자 A의 데이터가 사용자 B에게 보일 위험**: `Cache-Control: private` + `Authorization` 헤더 차이로 캐시 키 분리됨. 그러나 Next.js fetch 캐시는 URL + 메서드 + body 기준이라 헤더는 캐시 키에 포함되지 않음 → **인증 토큰이 다른 두 유저가 같은 URL을 요청하면 캐시 충돌 가능**.
- **완화**: URL 쿼리스트링에 `orgId`를 명시적으로 포함 (이미 그렇게 되어 있음) 또는 `cache: 'no-store'` 유지하되 `Cache-Control` 의존하지 말고 다른 캐시 메커니즘 사용.

### 결정

**보수적 옵션 채택**: `no-store` 유지 + Step #4의 서버 측 캐시(`unstable_cache`)로 우회. 클라이언트 측 stale-while-revalidate는 브라우저 → web 경로에서만 효과 있음.

→ **Step #1은 실질적으로 "Step #4의 사전 작업"으로 흡수**. 직접 `next: { revalidate }` 적용은 위험.

### 대안: 클라이언트 측 캐시 헤더는 유지

서버는 그대로 `Cache-Control` 내려보내고, **브라우저 → web** 구간은 SWR 작동. 변경 없음.

### 작업 시간

- 결정 자체: 30분
- 실제 코드 변경: 없음 (Step #4로 대체)

---

## 2. Step #2 — `getSession()` 요청 단위 캐싱

### 문제

[apps/web/lib/server/api.ts:15-20](apps/web/lib/server/api.ts:15):
```ts
export async function apiGetServer<T>(path: string): Promise<T> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  // ...
}
```

대시보드 진입 시 [page.tsx:13](apps/web/app/%28dashboard%29/dashboard/page.tsx:13)에서 `prefetchAll([...10개])`를 호출하면 각 쿼리가 `apiGetServer`를 호출하고, 각 호출이 `getSession()`을 새로 실행함. `getSession()`은 내부적으로:

1. `cookies()` 비동기 호출 (Next.js 14에서 await 필요)
2. JWT 디코딩 + 만료 검증
3. 만료 임박 시 Supabase Auth로 refresh 토큰 왕복

→ **10번 반복 = Auth 왕복 최대 10번 = +300~600ms** (cold)

### 변경 사항

`apps/web/lib/server/api.ts`를 다음과 같이 수정:

```ts
import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001'

/**
 * Request-scoped session loader. React `cache()` dedupes calls within
 * the same React request — so prefetchAll([...10 queries]) only triggers
 * one Supabase auth roundtrip instead of 10.
 *
 * Note: `cache()` is per-render, not cross-request. Auth security unaffected.
 */
const getServerSession = cache(async () => {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
})

export async function apiGetServer<T>(path: string): Promise<T> {
  const session = await getServerSession()
  const token = session?.access_token ?? null

  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Server API ${res.status}: ${path}`)
  }

  return res.json() as Promise<T>
}
```

### 핵심 원리

React `cache()`는 **같은 render 내에서 같은 함수 호출을 자동 dedupe**함. Next.js 14 App Router는 RSC 렌더링을 하나의 React render로 처리하므로, `prefetchAll`이 10번 호출해도 `getServerSession()`은 1번만 실행되고 나머지는 캐시된 Promise를 재사용.

다른 요청(다른 유저)은 다른 render이므로 캐시 공유 안 됨 → **보안 영향 0**.

### 검증 방법

1. `apps/web/lib/server/api.ts`에 임시 console.log 추가:
   ```ts
   const getServerSession = cache(async () => {
     console.log('[getServerSession] called', new Error().stack?.split('\n')[2])
     // ...
   })
   ```
2. 로컬에서 `/dashboard` 진입
3. 서버 로그에 `[getServerSession] called`가 **1번만** 찍혀야 함 (이전엔 10번)
4. 검증 후 console.log 제거

### 리스크

- **거의 없음**. `cache()`는 React 18.3+ stable API.
- 다만 prefetchAll 외부에서 (예: layout.tsx에서) 먼저 `getSession()` 호출한 경우 그 결과가 보존되지 않음 — `cache()`는 같은 *함수 reference*만 dedupe. layout에서도 같은 helper 쓰도록 통일하면 해결.

### Layout에서 동일 helper 사용으로 확장

[apps/web/app/(dashboard)/layout.tsx](apps/web/app/%28dashboard%29/layout.tsx)에서도 `createClient` 직접 호출하는 곳이 있다면 `getServerSession()`으로 교체. 이렇게 하면 **layout + page + prefetchAll** 전체가 1번의 Auth만 사용.

### 작업 시간

- 변경 자체: 30분 (api.ts 수정 + layout 추적)
- 검증: 1시간
- PR 작성 + 머지: 2시간 (총 ~3시간)

### 예상 효과

- **cold 진입: -300~600ms**
- warm 진입: 무시할 수 있는 수준 (이미 토큰 캐시됨)

---

## 3. Step #3 — Below-the-fold 쿼리를 client-side로 이동

### 문제

[dashboard/page.tsx:13-24](apps/web/app/%28dashboard%29/dashboard/page.tsx:13)의 `prefetchAll`이 10개 쿼리 전부 `await`:

```ts
const state = await prefetchAll([
  statsOverviewSpec(),        // ★ above-the-fold (KPI 4개 카드)
  statsTimeseriesSpec(),      // ★ above-the-fold (메인 차트)
  statsModelsSpec(),          // ○ below — Model breakdown
  spendForecastSpec(),        // ○ below — Spend forecast card
  anomaliesSpec({ ... }),     // ○ below — Anomaly cards
  alertsSpec(),               // ○ below — Active alerts list
  recommendationsSpec({...}), // ○ below — Model recommendations
  securitySummarySpec(24),    // ○ below — Security summary
  auditLogsSpec({ limit: 6 }),// ○ below — Recent activity
  dismissalsSpec(),           // ☆ critical (UI state — 무시 가능 카드)
])
```

가장 느린 쿼리(예: anomalies — ClickHouse 윈도우 함수) 1개가 늦으면 **전체가 그만큼 지연**. 사용자는 빈 화면에서 대기.

### 변경 전략

| 쿼리 | 분류 | 처리 |
|------|------|------|
| `statsOverviewSpec` | above-fold | server prefetch 유지 |
| `statsTimeseriesSpec` | above-fold | server prefetch 유지 |
| `dismissalsSpec` | UI 상태 | server prefetch 유지 (가벼움) |
| `statsModelsSpec` | below | **client useQuery로** |
| `spendForecastSpec` | below | **client useQuery로** |
| `anomaliesSpec` | below | **client useQuery로** |
| `alertsSpec` | below | **client useQuery로** |
| `recommendationsSpec` | below | **client useQuery로** |
| `securitySummarySpec` | below | **client useQuery로** |
| `auditLogsSpec` | below | **client useQuery로** |

### 작동 원리

`DashboardClient`는 이미 `'use client'` + `useStatsModels()` 등 TanStack Query 훅으로 데이터 사용 중 ([dashboard-client.tsx:8-15](apps/web/app/%28dashboard%29/dashboard/dashboard-client.tsx:8)). 현재는 server prefetch 결과가 `HydrationBoundary`로 주입되어 초기 렌더에 즉시 값이 있는 상태.

→ server prefetch에서 7개 제거하면 → 클라이언트가 **mount 후 useQuery로 fetch** → 그동안 **skeleton 표시** (이미 컴포넌트에 skeleton 분기 있음)

핵심: **Suspense 안 씀**. `HydrationBoundary`는 3개 쿼리만 주입. 나머지는 그냥 client query → React Query의 자연스러운 loading state.

### 변경 사항

**1. [apps/web/app/(dashboard)/dashboard/page.tsx](apps/web/app/%28dashboard%29/dashboard/page.tsx)**:

```ts
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { dismissalsSpec } from '@/lib/server/queries/dismissals'
import { statsOverviewSpec, statsTimeseriesSpec } from '@/lib/server/queries/stats'
import { DashboardClient } from './dashboard-client'

export default async function DashboardPage() {
  // Above-the-fold만 server prefetch — TTFB 단축.
  // 나머지는 DashboardClient 내부의 useQuery 훅이 mount 시 fetch.
  const state = await prefetchAll([
    statsOverviewSpec(),
    statsTimeseriesSpec(),
    dismissalsSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      <DashboardClient />
    </HydrationBoundary>
  )
}
```

**2. `DashboardClient` 변경 없음** — useQuery 훅들은 이미 hydrated cache가 있으면 그걸 쓰고, 없으면 자동 fetch. 그게 React Query의 동작.

**3. 컴포넌트 skeleton 검증**

각 below-fold 컴포넌트가 `isLoading` 상태에서 skeleton을 표시하는지 확인:

- `ModelBreakdown` — `useStatsModels`의 `isLoading`
- `SpendForecastCard` — 이미 `dynamic({ loading: <Skeleton /> })` 처리 ([dashboard-client.tsx:27](apps/web/app/%28dashboard%29/dashboard/dashboard-client.tsx:27))
- `RequestChart` — 이미 동일
- `AnomalyCards`, `AlertList`, `RecommendationsList`, `SecuritySummary`, `RecentActivity` — 각각 점검 필요

skeleton 없는 컴포넌트는 추가 (이 plan의 부속 PR).

### 검증 방법

1. Chrome DevTools → Network → Slow 3G throttling
2. `/dashboard` 진입
3. **0.5초 이내에 KPI 4개 + 메인 차트가 보여야 함** (above-fold 데이터)
4. 그 아래는 skeleton 표시되다가 점진적으로 채워짐
5. 모든 데이터 완료까지 시간이 cold 5~6s → ~1.5s

### 리스크

| 리스크 | 완화 |
|--------|------|
| Below-fold 컴포넌트 skeleton 누락 → 깜빡임 | 사전 점검 + 일괄 skeleton 추가 PR |
| `staleTime` 미설정 쿼리는 다시 mount 시마다 fetch | 각 use-* 훅에 `staleTime: 60_000` 확인 |
| Hydration mismatch (서버 prefetch 안 한 쿼리가 SSR HTML에 영향) | DashboardClient는 `'use client'` 컴포넌트라 SSR HTML에 데이터 의존하지 않음 → 영향 없음 |

### 작업 시간

- page.tsx 변경: 5분
- 컴포넌트 skeleton 점검 + 추가: 반나절~1일
- 시각 회귀 검증 (manual + Playwright e2e): 반나절
- 총: 1~2일

### 예상 효과

- **cold 첫 그리기: 0.5초 이내** (KPI/차트만 보이는 시점)
- **모든 데이터 완료: 1.5~2초** (이전 5~6초)

---

## 4. Step #4 — 서버 측 ClickHouse 결과 캐시 (SWR 패턴)

### 문제

`/api/v1/stats/overview`, `/api/v1/stats/timeseries` 등은 호출마다 ClickHouse `GROUP BY` 재실행. 같은 org의 같은 시간 윈도우 쿼리는 1분 단위로 캐싱해도 무방 (`fromIso`는 분 단위 라운딩 — [stats.ts:10](apps/web/lib/server/queries/stats.ts:10) 참고).

현재 응답에 `Cache-Control: max-age=10, swr=30`는 있지만 이건 클라이언트 측 캐시 → **여러 유저가 같은 org에 속한 경우 서버는 같은 쿼리 N번 실행**.

### 캐시 신선도 전략 선택 — SWR 채택

단순 TTL(60초 고정)로 가면 **"옛날 데이터 60초 윈도우"** 문제가 생김:
- 사용자가 방금 SDK로 LLM 호출 → 대시보드 진입 → 60초 동안 안 보임.
- BI 대시보드라 보통 허용되지만, 데모/온보딩/디버깅 흐름에서 "왜 안 보이지?" 혼란.

→ **Stale-While-Revalidate (SWR) 패턴** 채택:

| 데이터 상태 | 동작 |
|------|------|
| **fresh** (cachedAt < 10s) | 캐시 즉시 반환. 추가 작업 없음. |
| **stale** (10s ≤ cachedAt < 60s) | 캐시 즉시 반환 + **백그라운드에서 ClickHouse 재실행 → 캐시 갱신**. 사용자는 빠른 응답 받고, 다음 진입 때 자동으로 fresh. |
| **expired** (cachedAt ≥ 60s) | 동기로 ClickHouse 실행 후 반환. |

**효과:** 사용자는 거의 항상 fresh 또는 stale(즉시) 응답. "옛날 데이터" 가시 윈도우가 사실상 사라짐 (다음 진입 때 갱신됨).

### 변경 전략

**옵션 A: Vercel KV(Upstash Redis) 기반 SWR 캐시** ← 채택

- 이미 인프라 있음 (rate-limit이 사용 중)
- 명시적 키 제어 가능 (`org:<orgId>:stats:overview:<hours>`)
- 캐시 값에 `cachedAt` 타임스탬프 포함 → SWR 판정 가능
- TTL은 stale 한계값(60s)을 Redis 만료로 강제

**옵션 B: Hono 미들웨어 + in-memory LRU** — Vercel 서버리스 cold start 빈도로 hit률 낮음. 비추천.

**옵션 C: `unstable_cache` (Next.js)** — 우리 server는 Hono on Vercel이라 사용 불가.

### 구현

**1. 새 헬퍼 [apps/server/src/lib/stats-cache.ts](apps/server/src/lib/stats-cache.ts)**:

```ts
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null
function getRedis(): Redis | null {
  if (_redis) return _redis
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  _redis = new Redis({ url, token })
  return _redis
}

interface CacheEntry<T> {
  data: T
  cachedAt: number  // Unix ms
}

interface SwrOptions {
  /** Within this age (seconds), data is considered fresh — return as-is. */
  freshSeconds: number
  /** Beyond fresh but within this age, return stale + refresh in background.
   *  Beyond this, synchronous refetch. Also used as Redis TTL. */
  staleSeconds: number
}

// In-flight background refresh dedup — prevents thundering herd when
// many concurrent requests hit the same stale key.
const _inflight = new Map<string, Promise<unknown>>()

function refreshInBackground<T>(
  redis: Redis,
  key: string,
  staleSeconds: number,
  loader: () => Promise<T>,
): void {
  if (_inflight.has(key)) return  // already refreshing
  const p = (async () => {
    try {
      const fresh = await loader()
      const entry: CacheEntry<T> = { data: fresh, cachedAt: Date.now() }
      await redis.set(key, entry, { ex: staleSeconds })
    } catch (err) {
      console.warn('[stats-cache] background refresh failed:', err)
    } finally {
      _inflight.delete(key)
    }
  })()
  _inflight.set(key, p)
}

/**
 * Per-org ClickHouse aggregate cache with stale-while-revalidate.
 *
 * - Key MUST include orgId so tenants are isolated.
 * - Fresh window: returns cached as-is. ~5ms.
 * - Stale window: returns cached immediately + triggers background refresh.
 *   Next caller within the same TTL gets fresh data automatically.
 * - Beyond TTL: synchronous refetch.
 * - Fails open on Redis errors (executes loader directly).
 */
export async function withStatsCache<T>(
  key: string,
  opts: SwrOptions,
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis()
  if (!redis) return loader()

  let entry: CacheEntry<T> | null = null
  try {
    entry = await redis.get<CacheEntry<T>>(key)
  } catch (err) {
    console.warn('[stats-cache] read error — failing open:', err)
    return loader()
  }

  if (entry) {
    const ageSeconds = (Date.now() - entry.cachedAt) / 1000

    if (ageSeconds < opts.freshSeconds) {
      // Fresh — return as-is
      return entry.data
    }

    if (ageSeconds < opts.staleSeconds) {
      // Stale — return now, refresh in background
      refreshInBackground(redis, key, opts.staleSeconds, loader)
      return entry.data
    }
    // Beyond stale (shouldn't happen due to Redis TTL, but defensive) → fall through
  }

  // No cache or expired → synchronous load
  const fresh = await loader()
  const newEntry: CacheEntry<T> = { data: fresh, cachedAt: Date.now() }
  redis.set(key, newEntry, { ex: opts.staleSeconds }).catch((err) => {
    console.warn('[stats-cache] write error (ignored):', err)
  })
  return fresh
}

/** Default SWR window for stats endpoints — 10s fresh / 60s stale. */
export const STATS_SWR: SwrOptions = { freshSeconds: 10, staleSeconds: 60 }
```

**2. [apps/server/src/api/stats.ts](apps/server/src/api/stats.ts) overview 핸들러에 적용**:

```ts
import { withStatsCache, STATS_SWR } from '../lib/stats-cache.js'

statsRouter.get('/overview', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const from = c.req.query('from')  // 분 단위 라운딩 (client에서)
  const compare = c.req.query('compare') === 'true'

  const cacheKey = `org:${orgId}:stats:overview:${from}:${projectId ?? ''}:${compare}`
  const row = await withStatsCache(cacheKey, STATS_SWR, () =>
    getStatsOverview({ orgId, projectId, from, compare }),
  )

  c.header('Cache-Control', CACHE_STATS_LIVE)
  return c.json({ success: true, data: row })
})
```

동일 패턴을 `/timeseries`, `/models`, `/spend-forecast`에도 적용.

**3. 사용자 명시 새로고침 지원 (선택)** — 클라이언트가 "지금 캐시 무시하고 fresh 가져와줘"를 표현할 수 있게:

```ts
// 핸들러에서
const bypass = c.req.header('x-cache-bypass') === '1'
const row = bypass
  ? await getStatsOverview({ orgId, projectId, from, compare })
  : await withStatsCache(cacheKey, STATS_SWR, () => getStatsOverview({...}))
```

대시보드의 "Refresh" 버튼이 `X-Cache-Bypass: 1` 헤더로 fetch하면 사용자가 옛 데이터 의심 시 즉시 우회 가능. **이 지원은 추가 PR로 분리.**

### Fresh / Stale 임계값 튜닝 가이드

| 시나리오 | freshSeconds | staleSeconds | 비고 |
|---------|--------------|--------------|------|
| **기본 (대시보드 stats)** | 10 | 60 | 권장 |
| **forecast (느린 쿼리)** | 60 | 300 | ClickHouse 부담 큰 쿼리는 길게 |
| **alerts / anomalies** | 5 | 30 | 알람 성격상 조금 더 fresh하게 |
| **audit logs** | 30 | 120 | 변동 빈도 낮음 |

엔드포인트별로 `STATS_SWR` 대신 명시 인자 지정 가능.

### 캐시 무효화 정책

- **자연 만료**: `staleSeconds` 후 Redis TTL로 자동 삭제
- **백그라운드 갱신**: stale 윈도우에 진입 즉시 자동 (사용자 액션 불필요)
- **명시 우회**: `X-Cache-Bypass: 1` 헤더 (옵션 3)
- **이벤트 기반 invalidation 미도입**: 매 LLM 요청마다 캐시 삭제하면 Redis 부하 + race condition. SWR로 충분. 향후 필요 시 version key 패턴([부록 C](#부록-c))으로 추가.

### 검증 방법

**Fresh 동작:**
1. `/dashboard` 진입 → ClickHouse 쿼리 실행 (서버 로그)
2. 5초 후 같은 org 다른 사용자 진입 → 캐시 hit, 응답 5~10ms, **백그라운드 갱신 안 일어남**

**Stale-while-revalidate 동작:**
3. 15초 후 다른 사용자 진입 → 캐시 hit (옛 데이터), 응답 5~10ms
4. 서버 로그에 `[stats-cache] background refresh` 발생 확인
5. 즉시 다시 한 번 진입 → 응답에 갱신된 데이터 (cachedAt 새로움)

**Thundering herd 방지:**
6. stale 상태에서 동시 10개 요청 발사 → 백그라운드 refresh는 **1회만** 실행되어야 함 (`_inflight` map)

**Tenant 격리:**
7. org A 사용자가 데이터 본 후 org B 사용자 진입 → org B 데이터가 보여야 함 (캐시 키 분리)

### 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| **데이터 fresh window 10초 지연** | 거의 항상 OK. 필요 시 `freshSeconds: 5`로 단축. 또는 `X-Cache-Bypass` 사용. |
| **멀티테넌트 유출** | 캐시 키에 `orgId` 명시 포함. 헬퍼 함수 시그니처에서 캐시 키를 호출자가 만들도록 강제 — 코드 리뷰 시 키 확인. |
| **Vercel Lambda inflight 맵 손실** | `_inflight`는 Lambda 인스턴스 로컬. 다른 인스턴스가 동시 refresh 가능 — 최대 N회 ClickHouse 실행. ClickHouse 부담은 작고, 결과는 같으므로 정합성 영향 없음. |
| **Redis 장애 시** | fail-open. ClickHouse 직접 호출 — 느려지지만 정상 작동. |
| **fire-and-forget background refresh가 Vercel에서 drop될 위험** | 핸들러는 이미 stale 데이터로 응답 반환. `_inflight`에 promise 보관해도 Lambda freeze되면 끊김. 다음 사용자 진입 시 다시 stale 감지 → 재시도 → 결국 갱신됨. 즉 worst case는 "한 번 더 stale 본다". |
| **Vercel KV 비용** | 무료 티어 256MB / 30K commands/일. 대시보드 진입당 GET 1회 + 가끔 SET 1회. 하루 10K 진입까지 무료. |

### 작업 시간

- `stats-cache.ts` SWR 헬퍼 작성 + 테스트: 3시간
- 4개 핸들러 적용 + 캐시 키 명명 통일: 2시간
- `X-Cache-Bypass` 지원 (선택): 1시간
- 검증 + 모니터링 추가: 2시간
- 총: 1일

### 예상 효과

- **같은 org 두 번째 요청부터: -150~250ms** (캐시 hit 5~10ms)
- **stale 윈도우 진입 사용자도 동일 속도** — 백그라운드 갱신은 응답 지연 없음
- 전체 평균(여러 org 섞임): -80~120ms
- **사용자가 보는 "옛날 데이터" 윈도우 = 다음 진입까지** (사실상 첫 페이지 로드만)

---

## 5. Step #5 — 사이드바 prefetch 부담 완화

### 문제

[apps/web/components/layout/sidebar.tsx:375](apps/web/components/layout/sidebar.tsx:375)의 12개 `<Link>`가 **viewport 진입 시 RSC payload 자동 prefetch** (Next.js 14 default). 한 viewport에 다 보이므로 사실상 마운트 직후 일괄 prefetch.

각 prefetch는 해당 페이지의 `page.tsx`에서 `prefetchAll`을 실행함 → 서버 부담 12배. 대시보드 자체 prefetch와 경쟁.

### 변경 전략

**옵션 A: 무거운 페이지만 `prefetch={false}`** ← 추천

- 가벼운 페이지 (Settings, Profile)는 prefetch 유지
- 무거운 페이지 (Requests, Traces, Anomalies)는 hover 시점에만 prefetch

**옵션 B: 전체 prefetch 끄기**

- 사용자가 첫 클릭 시 latency 증가 — UX 하락

**옵션 C: `requestIdleCallback` 패턴**

- Next.js Link의 prefetch 동작을 우회해야 하므로 복잡

→ **옵션 A 채택**

### 구현

[apps/web/components/layout/sidebar.tsx](apps/web/components/layout/sidebar.tsx)의 메뉴 데이터 구조에 `heavy` 플래그 추가:

```ts
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Observe',
    items: [
      { href: '/dashboard',  label: 'Dashboard' },
      { href: '/requests',   label: 'Requests',   heavy: true },
      { href: '/traces',     label: 'Traces',     heavy: true },
      { href: '/anomalies',  label: 'Anomalies',  heavy: true },
      { href: '/users',      label: 'Users',      heavy: true },
    ],
  },
  // ...
]
```

렌더 부분:
```tsx
<Link
  key={href}
  href={href}
  prefetch={heavy ? false : undefined}  // ← 무거운 페이지는 hover 시점에만
  className={...}
>
```

Next.js의 `prefetch={false}`는 **viewport prefetch는 끄지만 hover prefetch는 유지** → UX 손실 최소.

### 검증 방법

1. Chrome DevTools → Network → RSC 필터
2. `/dashboard` 진입 직후 사이드바 RSC 호출 카운트 측정
3. 변경 전: 12개, 변경 후: 5~6개 (light pages만)
4. 무거운 페이지 hover → RSC 호출 발생 확인 (UX 정상)

### 리스크

- **무거운 페이지 첫 클릭 시 latency +200~500ms**: hover로 충분히 mitigation. 모바일 사용자는 hover 없어서 영향 있을 수 있음 → 향후 mobile-only 별도 처리 검토.

### 작업 시간

- 메뉴 데이터 구조 + Link 변경: 30분
- 검증: 30분
- 총: 1시간

### 예상 효과

- **서버 동시 요청 -40~50%**
- 대시보드 자체 prefetch는 같은 서버 자원을 덜 경쟁하므로 cold 진입 **추가 -50~100ms**

---

## 6. Step #6 — Web RSC ↔ Server HTTP self-call 통합 (장기)

### 문제

현재 구조 (Korean user 기준):
```
Browser (KR)
  ─[150ms HTTPS]→ Vercel Web (iad1)
                    ─[30~80ms HTTPS]→ Vercel Server (iad1)
                                        ─[10ms]→ ClickHouse Cloud (US)
```

같은 리전이라도 web Lambda → server Lambda는 **별도 HTTPS 요청 + TLS handshake**. 한 페이지에 10개 쿼리면 web-to-server hop만 300~800ms.

### 옵션 비교

| 옵션 | 장점 | 단점 | 공수 |
|------|------|------|------|
| **A. server를 web의 Route Handler로 통합** | 같은 Lambda, in-process 호출. -300~800ms. | 패키지 의존성 재배치. proxy(`/proxy/openai`)도 함께 이동 필요 — proxy의 timeout/streaming 동작 재검증. | 1~2주 |
| **B. internal HTTP 경로를 server 내부 함수 직접 호출로 교체** | web의 `apiGetServer` 대신 server 패키지를 직접 import. | 의존성 방향(`apps/web → apps/server`) 위반 — CLAUDE.md 정책. 또는 server 로직을 `packages/`로 추출. | 2~3주 |
| **C. `apiGetServer`를 keep-alive HTTP agent로 최적화** | 코드 변경 적음. TLS handshake 비용 일부 제거. | Vercel Lambda는 keep-alive 의미가 제한적 (cold start마다 새 연결). 효과 제한. | 1일 |
| **D. server에 BatchRPC 엔드포인트 추가** (`POST /api/v1/batch` — 여러 쿼리를 한 번에) | HTTP 호출 1번으로 통합. | 모든 spec과 응답 envelope 통일 필요. caching 헤더 처리 까다로움. | 1주 |

### 권장

**현재 단계에서는 보류**. Step #1~#5만 적용해도 5~6초 → 1.5초로 줄어드므로 **추가 ROI 낮음**.

다음 트리거 조건 발생 시 재검토:
- Step #1~#5 적용 후 여전히 cold 진입 > 2초
- 동시 사용자가 늘어 server Lambda 동시성이 부담될 때
- 다중 리전(EU) 도입 결정 시 — 그 시점에 web/server 통합이 자연스러움

### 만약 진행한다면 — Option A 우선

**이유**: Option B는 의존성 정책 변경, Option C는 효과 제한, Option D는 부분 해결.

**Option A의 단계적 진행**:
1. **Phase 1 (1주)**: API 엔드포인트만 Next.js Route Handler로 미러링 (`apps/web/app/api/v1/stats/overview/route.ts` 등). 기존 Hono server는 유지. Feature flag로 web → Route Handler 전환.
2. **Phase 2 (1주)**: Proxy(`/proxy/*`) 엔드포인트는 streaming 동작이 복잡 — 별도 PR. Node runtime 유지 필요 ([gotcha #11](../../CLAUDE.md)).
3. **Phase 3 (반나절)**: Hono server 제거 또는 internal-only로 축소.

### 리스크

- **Proxy 동작 회귀**: P2.2 stream-deadline, gotcha #8 fire-and-forget 등 까다로운 동작 다수. 전수 e2e 필요.
- **CORS allowlist 변경**: `apps/server/src/app.ts`의 origin 등록. 통합 시 같은 도메인이 되어 CORS 자체가 불필요해짐 — 운영상 단순화.

### 작업 시간

- 결정 + 설계: 1주
- 구현: 2~3주
- 총 보류 권장

---

## 7. Step #7 — List 페이지 (`/requests`, `/traces`) 쿼리 최적화

### 적용 범위

`/dashboard`와 별개 트랙. **`/requests`·`/traces`·`/anomalies`·`/users`·`/alerts` 등 list 페이지 전반**. 이 페이지들의 page.tsx는 `prefetchAll([singleSpec])` — fan-out 없으므로 Step #2 효과 없음.

### 문제 분석

**`/api/v1/traces` ([traces.ts:23-31](apps/server/src/api/traces.ts:23))**:
```ts
supabaseAdmin.from('traces')
  .select('...', { count: 'exact' })   // ← COUNT(*) 강제, 매번 실행
  .range(0, 49)
```
- `count: 'exact'`가 **전체 행 카운트** 실행 → 큰 테이블에서 풀스캔
- 페이지네이션 표시용 total 외에는 안 쓰이는데 매 페이지 로드마다 실행

**`/api/v1/requests` ([requests.ts:109-122](apps/server/src/api/requests.ts:109))**:
```ts
const [rows, total] = await Promise.all([
  selectRequests<RequestRow>({ ..., limit, offset }),
  countRequests({ scope, filters, params }),   // ← 별도 COUNT 쿼리
])
```
- ClickHouse에서도 동일 패턴 — COUNT 별도 실행
- `Promise.all`로 병렬 처리는 이미 됨 (잘 짠 부분)
- 거기에 `fetchProviderKeyNames` Supabase 보강 호출 1개 추가

### 변경 전략 — 3개 하위 작업

**7.1. `count: 'exact'` → `count: 'estimated'` (Supabase) / COUNT 옵션화 (ClickHouse)**

대부분의 list 페이지는 "정확한 total"이 critical UX 요소가 아님. "100+" / "1.2k" 같은 추정값으로 충분.

- Supabase: `count: 'estimated'` — `pg_class.reltuples` 사용, 즉시 반환
- ClickHouse: `EXPLAIN ESTIMATE` 또는 별도 sample-based 카운트
- 또는 **`?withCount=false`** 쿼리 파라미터로 클라이언트가 선택적 요청

**7.2. 무필터 첫 페이지를 Step #4 SWR 캐시에 포함**

`/api/v1/requests?page=1&limit=50` (필터 없음)는 같은 org에서 N명이 보면 결과 같음 → 캐시 가능.

```ts
// requests.ts 핸들러 안
const isFirstUnfilteredPage = !projectId && !provider && !model && !from && !to
  && !providerKeyId && !promptVersionId && !userIdFilter && !sessionIdFilter
  && !status && page === 1 && limit === 50

const result = isFirstUnfilteredPage
  ? await withStatsCache(`org:${orgId}:requests:first-page`, STATS_SWR, () =>
      runQuery(orgId, ...))
  : await runQuery(orgId, ...)  // 필터 있으면 캐시 우회
```

- 필터/페이지가 있으면 캐시 우회 (`Step #4` 헬퍼 재사용)
- TTL: SWR fresh 10s / stale 60s
- 같은 org 여러 사용자: 캐시 hit
- 같은 사용자 두 번 진입: 캐시 hit

**7.3. `LIST_COLUMNS` 축소 (선택)**

list view에서 실제로 표시하는 컬럼만 SELECT. 현재는 detail용 컬럼까지 포함됐을 가능성 — 클라이언트 컴포넌트에서 사용되는 필드를 grep해서 비교.

### 변경 사항

**파일**:
- [apps/server/src/api/traces.ts](apps/server/src/api/traces.ts) — `count: 'estimated'` 또는 옵션화
- [apps/server/src/api/requests.ts](apps/server/src/api/requests.ts) — 무필터 캐시 + count 옵션화
- [apps/server/src/lib/requests-query.ts](apps/server/src/lib/requests-query.ts) — `countRequests` 호출 옵션 추가
- 같은 패턴 검토: `/api/v1/anomalies`, `/api/v1/users`, `/api/v1/alerts`

### 검증 방법

**7.1 검증 (count 변경)**
- [ ] Supabase: `count: 'estimated'` 응답 시간 측정 — `exact` 대비 -80~95%
- [ ] ClickHouse: COUNT 생략 시 list 쿼리 단독 응답 시간 측정
- [ ] 클라이언트 페이지네이션 UI에 추정값 표시되는지 확인 (예: "약 1,200개")

**7.2 검증 (캐시)**
- [ ] 무필터 첫 페이지 1차 요청: ClickHouse/Supabase 쿼리 실행
- [ ] 같은 org 두 번째 진입(<10s): 캐시 hit, 5~10ms
- [ ] 필터 추가하면 캐시 우회 확인 (서버 로그)
- [ ] org 격리 (Step #4와 동일 보안 검증)

**7.3 검증 (컬럼 축소)**
- [ ] list 컴포넌트가 사용하는 필드 grep → 미사용 컬럼 식별
- [ ] 축소 후 응답 페이로드 크기 측정 (-20% 이상이면 가치 있음)

### 리스크

| 리스크 | 완화 |
|--------|------|
| 추정 count가 정확하지 않아 "1234개" → "약 1k"로 보이는 UX 변화 | "정확한 카운트가 critical한지" 사용자 인터뷰 — 보통 list 페이지는 무관 |
| 캐시 격리 위반 | Step #4와 동일 — `orgId` 키 포함 + 코드 리뷰 |
| 컬럼 축소로 detail 페이지 전환 시 추가 fetch 필요 | list → detail 흐름은 어차피 detail용 별도 query — 영향 없음 |
| Supabase `estimated` 카운트가 0 또는 매우 작게 나옴 (`pg_class.reltuples` 미갱신) | `ANALYZE` 정기 실행 또는 임계 미만일 때 fallback to exact |

### 작업 시간

- 7.1 count 옵션화: 반나절 (2개 핸들러 + 클라이언트 UI 적응)
- 7.2 무필터 첫 페이지 캐시: 반나절 (Step #4 헬퍼 재사용)
- 7.3 컬럼 축소: 반나절 (분석 + 변경 + 회귀 테스트)
- 검증: 반나절
- 총: 2일

### 예상 효과

- `/requests`, `/traces` cold 진입 **-300~500ms** (count 제거)
- 같은 org 반복 진입 **-150~300ms** (캐시 hit)
- 합계: list 페이지 5초 → 2~2.5초

### 의존성

- Step #4 헬퍼(`withStatsCache`)가 먼저 머지돼야 7.2 진행 가능
- 7.1 / 7.3은 독립적으로 진행 가능

---

## 8. 적용 순서 & 마일스톤

### Sprint 1 (이번 주, 1~2일)
- ✅ **Step #2**: `getSession()` cache — **완료 2026-05-19 (PR #99)** — `/dashboard` -300~600ms 측정 예정
- ✅ **Step #5**: 사이드바 `prefetch={false}` (1시간)
- **검증**: cold/warm 측정 → 목표 `/dashboard` ~3.5초

### Sprint 2 (다음 주, 2~3일)
- ✅ **Step #3**: below-fold client query 전환 + skeleton 정리 (1~2일)
- ✅ **Step #7.1**: list 페이지 count 옵션화 (반나절) — Step #3과 병행 가능
- **검증**: `/dashboard` cold ~1.5초, `/requests`·`/traces` -300~500ms

### Sprint 3 (선택, 1주)
- ✅ **Step #4**: 서버 측 KV 캐시 — SWR 패턴 (1일)
- ✅ **Step #7.2**: 무필터 첫 페이지 SWR 캐시 (반나절, Step #4 헬퍼 의존)
- ✅ **Step #7.3**: list 컬럼 축소 (반나절)
- **검증**: fresh / stale-while-revalidate / thundering herd / tenant 격리 4개 시나리오 측정

### Backlog (보류)
- ⏸ **Step #1**: 보안 분석 후 client-side cache 헤더 활용 가능성 재검토
- ⏸ **Step #6**: Step #1~#5/#7 결과가 충분하면 미실행

---

## 9. 측정 프로토콜 (Before/After 객관화)

각 단계 머지 전후로 다음 측정 반복:

### 환경 표준화
- Chrome (incognito, 캐시 비움)
- Throttling: Fast 3G (다운로드 1.5 Mbps, RTT 562ms) — Korean user 시뮬레이션
- CPU: 4× slowdown
- 측정 대상: `https://www.spanlens.io/dashboard`
- 같은 org, 같은 24h 시간 윈도우, 5회 반복 후 중간값

### 캡처 지표
| 지표 | 도구 | 목표 |
|------|------|------|
| TTFB | `performance.timing.responseStart - navigationStart` | < 800ms |
| FCP | Lighthouse | < 1.2s |
| Above-fold 완성 (KPI 4개 + 메인 차트) | manual + screencast | < 1.5s |
| 전체 완성 (모든 카드 데이터) | `performance.now()` 마크 | < 2.5s |
| 서버 RSC 호출 수 | Network 탭 카운트 | < 5 (sidebar 제외) |
| Supabase auth 왕복 수 | server log instrumentation | 1 (per page load) |

### 회귀 가드
- Vercel Speed Insights 대시보드 모니터링
- `/dashboard` 메인 메트릭이 7일 이동평균보다 +20% 이상 악화되면 알람

---

## 10. 롤백 계획

각 PR에 다음 명시:

| Step | 롤백 방식 | 영향 |
|------|-----------|------|
| #2 | `cache()` wrapping 제거, 직접 호출 복원 | 즉시, 영향 없음 |
| #3 | page.tsx에서 7개 쿼리 prefetchAll 복원 | 즉시, 사용자 경험만 변화 |
| #4 | `withStatsCache` 호출 제거, 핸들러 원복 | 즉시, KV 키는 자연 만료 |
| #5 | `prefetch={undefined}` 복원 | 즉시 |
| #7.1 | `count: 'exact'` 복원 / `withCount` 분기 제거 | 즉시 |
| #7.2 | `withStatsCache` 분기 제거, 모든 요청이 직접 query | 즉시, KV 키는 자연 만료 |
| #7.3 | `LIST_COLUMNS` 원래 컬럼셋 복원 | 즉시, 응답 payload 일시 증가 |

---

## 11. 성공조건 체크리스트 (Step별)

각 Step의 PR을 머지하기 전 **모든 체크박스가 통과해야 함**. 통과하지 않은 항목이 있으면 머지 보류 + 원인 분석.

체크리스트 4개 카테고리:
- **구현 (Code)** — 코드 자체 변경 사항
- **동작 검증 (Behavior)** — 의도한 대로 동작하는지
- **회귀 가드 (No Regression)** — 기존 기능 안 깨지는지
- **성능 (Performance)** — 측정 가능한 개선

### 11.1. Step #2 — `getSession()` cache 성공조건 ✅ **완료 (2026-05-19, PR #99)**

**구현 (Code)**
- [x] `apps/web/lib/server/api.ts`에 `import { cache } from 'react'` 추가됨
- [x] `getServerSession` 함수가 `cache()`로 래핑됨
- [x] `apiGetServer`가 `getServerSession()`을 호출 (직접 `supabase.auth.getSession()` 호출 없음)
- [x] ~~layout 등 server-side session 호출~~ → **N/A**: layout은 middleware가 set한 `x-spanlens-*` 헤더만 읽음 (직접 getSession 호출 없음)
- [x] TypeScript: `pnpm --filter web typecheck` 통과
- [x] Lint: `pnpm --filter web lint` 통과

**동작 검증 (Behavior)**
- [x] 임시 console.log 삽입 후 `/dashboard` 1회 진입 → **정확히 1번** 찍힘 (로컬 + Vercel preview 양쪽)
  - 로컬: 2 page loads → 2 lines
  - Vercel preview (`dpl_3FGXnJYW...`): 4 dashboard requests → 4 lines
- [x] 로그인 상태에서 대시보드 정상 진입 (preview 검증)
- [x] 로그아웃 후 `/dashboard` 접근 → `/login`으로 리다이렉트 (preview에서 307 응답 확인)
- [ ] 토큰 만료 직전 진입 → refresh 정상 동작 — **미검증** (cache()는 refresh 로직 변경 없음, 회귀 가능성 0)
- [x] 검증용 console.log 모두 제거됨 (커밋 `6a9749c`)

**회귀 가드 (No Regression)**
- [ ] 워크스페이스 스위치 — 미검증, production 머지 후 모니터링
- [ ] 초대 accept 흐름 — 미검증
- [ ] Onboarding step 2 → dashboard 이동 — 미검증
- [ ] 멀티탭 동기화 — 미검증
- [x] Vercel runtime 로그에 에러 0건 (preview 측정 구간)

**성능 (Performance)**
- [ ] cold dashboard 로딩 **-300ms 이상** 단축 — production 머지 후 Speed Insights 추적
- [x] Vercel 로그에 `getServerSession` 호출 빈도 페이지당 1회 (이전 10회) — preview 검증
- [ ] Vercel Speed Insights 회귀 알람 — production 머지 후 7일 관찰

---

### 11.2. Step #3 — Below-fold client query 전환 성공조건

**구현 (Code)**
- [ ] `apps/web/app/(dashboard)/dashboard/page.tsx`의 `prefetchAll`이 **정확히 3개 spec만** 호출 (`statsOverviewSpec`, `statsTimeseriesSpec`, `dismissalsSpec`)
- [ ] 제거된 7개 import (alerts, recommendations, security, audit-logs, models, forecast, anomalies) 삭제됨
- [ ] `DashboardClient`의 `useStatsModels` 등 7개 훅이 `staleTime: 60_000` 이상 명시
- [ ] 모든 below-fold 컴포넌트가 `isLoading` 상태에서 Skeleton 렌더링:
  - [ ] `ModelBreakdown` (`useStatsModels`)
  - [ ] `SpendForecastCard` (이미 dynamic loading)
  - [ ] `RequestChart` (이미 dynamic loading)
  - [ ] `AnomalyCards`
  - [ ] `AlertList`
  - [ ] `RecommendationsList`
  - [ ] `SecuritySummary`
  - [ ] `RecentActivity` (audit logs)
- [ ] TypeScript / Lint 통과

**동작 검증 (Behavior)**
- [ ] `/dashboard` 진입 시 KPI 4개 + 메인 차트가 **first paint에 즉시** 표시 (skeleton 아님)
- [ ] Below-fold 7개 카드가 skeleton → 데이터로 전환되는 게 시각적으로 확인됨
- [ ] 네트워크 throttling Fast 3G에서 above-fold가 1초 이내 표시
- [ ] Below-fold 데이터가 1.5초 이내 모두 채워짐
- [ ] React Query Devtools에서 7개 client query가 mount 시점에 fetch 발생 확인

**회귀 가드 (No Regression)**
- [ ] Console에 `Hydration mismatch` / React error #418, #425, #422 없음
- [ ] Hard reload 5회 반복 후에도 동일 — flaky 아님
- [ ] 다른 페이지(`/requests`, `/traces`)에서 `/dashboard`로 다시 navigation해도 정상
- [ ] 다른 시간 윈도우(7d, 30d) 선택 시 below-fold 데이터 정상 갱신
- [ ] Topbar의 TimeRangeSelector 변경이 모든 카드에 반영됨
- [ ] Welcome banner / Quota banner 정상 표시

**성능 (Performance)**
- [ ] **Above-fold FCP < 1.2s** (Fast 3G)
- [ ] **Above-fold 데이터 완성 < 1.5s**
- [ ] **전체 데이터 완성 < 2.5s**
- [ ] TTFB가 변경 전보다 **-500ms 이상** (서버 prefetch 단축 효과)
- [ ] Playwright e2e 시각 회귀 테스트 통과 (skeleton 단계 스크린샷 포함)

---

### 11.3. Step #4 — SWR 캐시 성공조건

**구현 (Code)**
- [ ] `apps/server/src/lib/stats-cache.ts` 신규 생성
  - [ ] `withStatsCache(key, opts, loader)` export
  - [ ] `STATS_SWR` 상수 (fresh: 10, stale: 60) export
  - [ ] `_inflight` Map으로 백그라운드 refresh dedup
  - [ ] Redis 미설정 시 fail-open (loader 직접 실행)
  - [ ] Redis 에러 시 fail-open + console.warn
- [ ] `apps/server/src/api/stats.ts`의 핸들러 4개 적용:
  - [ ] `/overview`
  - [ ] `/timeseries`
  - [ ] `/models`
  - [ ] `/spend-forecast` (TTL 길게 `{ freshSeconds: 60, staleSeconds: 300 }`)
- [ ] 모든 캐시 키에 `orgId` 포함 (코드 리뷰 시 확인)
- [ ] (선택 PR) `X-Cache-Bypass` 헤더 처리 추가
- [ ] TypeScript / Lint / 단위 테스트 통과

**동작 검증 (Behavior)** — 4개 시나리오 모두 통과 필수

**시나리오 A: Fresh path**
- [ ] 첫 요청: ClickHouse 쿼리 실행, 응답 시간 200~400ms
- [ ] 5초 후 같은 캐시 키로 요청: 응답 5~15ms (cache hit)
- [ ] 서버 로그에 백그라운드 refresh **발생 안 함**

**시나리오 B: Stale-while-revalidate path**
- [ ] 15초 후 같은 캐시 키 요청: 응답 5~15ms (옛 데이터 반환)
- [ ] 서버 로그에 `[stats-cache] background refresh` 발생
- [ ] 직후 같은 키 재요청: 응답에 갱신된 `cachedAt` (Redis MONITOR로 확인 가능)

**시나리오 C: Thundering herd 방지**
- [ ] stale 상태에서 동시 10개 요청 동시 발사 (e.g., `ab -n 10 -c 10`)
- [ ] 서버 로그의 `background refresh` 발생 횟수가 **1회** (10회 아님)
- [ ] ClickHouse 쿼리 로그도 1회만 발생

**시나리오 D: Tenant 격리**
- [ ] org A 사용자 요청 → 캐시 키 `org:A:stats:overview:...`
- [ ] org B 사용자 요청 → 캐시 키 `org:B:stats:overview:...` (다른 키)
- [ ] org A의 데이터가 org B 응답에 절대 등장하지 않음 (응답 body diff 검증)
- [ ] Redis CLI `KEYS org:*:stats:*` 결과에 두 org 키가 분리되어 보임

**Failsafe**
- [ ] Redis 환경변수 미설정 상태로 dev 서버 부팅 → 캐시 없이 정상 동작
- [ ] Redis URL을 일부러 잘못 설정 → 에러 한 번 로그 후 ClickHouse 직접 호출로 동작

**회귀 가드 (No Regression)**
- [ ] `/api/v1/stats/*` 응답 envelope 구조 변경 없음 (`{ success, data }`)
- [ ] `Cache-Control` 헤더 그대로 응답에 포함
- [ ] 비스트리밍 클라이언트가 받는 JSON 동일 (필드 추가/누락 없음)
- [ ] 응답 시간 회귀 없음 — cold cache에서도 기존 성능 ≤ 350ms 유지

**성능 (Performance)**
- [ ] 같은 org 두 번째 요청 응답 시간 **5~15ms** (이전 200~400ms)
- [ ] ClickHouse 쿼리 QPS가 측정 기간 평균 **-40% 이상** 감소
- [ ] Vercel KV 무료 한도 (30K commands/일) 내 사용

**보안**
- [ ] 코드 리뷰: 모든 캐시 키 생성 위치에 `orgId` 포함 확인 (grep `withStatsCache` 호출 4곳)
- [ ] 수동 테스트: 다른 org의 토큰으로 같은 URL 요청해도 다른 org 데이터 안 나옴
- [ ] (선택) `withStatsCache` 시그니처에 `orgId`를 별도 인자로 받게 강제 — TypeScript로 누락 방지

---

### 11.4. Step #5 — 사이드바 prefetch 부담 완화 성공조건 ✅ **완료 (PR #101, 2026-05-19)**

> 1차 PR에서 sidebar만 처리 → Vercel preview 검증에서 4개 heavy 페이지(`/requests`, `/traces`, `/anomalies`, `/savings`)가 여전히 prefetch되는 게 발견됨. 원인: KpiCard.linkHref + dashboard-client.tsx 인라인 Link가 별도 entry point였음. 같은 PR에 후속 커밋으로 `lib/heavy-pages.ts` 헬퍼 도입하고 모든 entry point에 일괄 적용 → 완전 해결.

**구현 (Code)**
- [x] `apps/web/lib/heavy-pages.ts` 신규 — `HEAVY_PAGES` Set + `linkPrefetchFor(href)` 헬퍼
- [x] 무거운 페이지 **8개**: `/dashboard`, `/requests`, `/traces`, `/users`, `/anomalies`, `/security`, `/savings`, `/alerts`
- [x] `sidebar.tsx` `<Link>` — `prefetch={linkPrefetchFor(href)}` 적용
- [x] `components/dashboard/kpi-card.tsx` — `linkHref` 기반 prefetch 자동 설정
- [x] `dashboard-client.tsx` 인라인 3개 Link (`/requests`, `/alerts`, `/savings`) — 동일 적용
- [x] TypeScript / Lint 통과

**동작 검증 (Behavior)** — Vercel preview `claude-perf-step5-sid-5eb13f` 검증 완료
- [x] `/dashboard` 진입 → Network `?_rsc=` 필터: **18개 (9 light × 2 wave)**
- [x] 8개 heavy 페이지 prefetch **모두 차단** (`/dashboard`/`/requests`/`/traces`/`/users`/`/anomalies`/`/security`/`/savings`/`/alerts` 0건)
- [x] 9개 light 페이지 정상 prefetch (`/prompts`, `/evals`, `/datasets`, `/experiments`, `/annotation`, `/projects`, `/settings`, `/docs`, `/`)
- [x] heavy 페이지(`/requests`) 클릭 → 정상 navigation
- [x] **알게 된 사실**: Next.js 14+ `prefetch={false}`는 hover prefetch도 비활성화 — 의도된 trade-off (idle bandwidth ↓, first-click +200~500ms)
- [x] 회귀 0 — Vercel runtime 로그 에러 없음

**회귀 가드 (No Regression)**
- [x] 사이드바 active state 정상 (`/requests` 진입 시 사이드바에서 강조)
- [ ] 키보드 navigation (Tab + Enter) — 수동 검증 권장
- [ ] 모바일 viewport — 수동 검증 권장
- [x] 터치 디바이스 시뮬레이션 — `prefetch={false}` 동작은 환경 independent

**성능 (Performance)**
- [x] 대시보드 초기 진입 sidebar prefetch 요청 수: **22 → 18 (-18%)** 1차 commit 기준
- [x] 2차 commit 후 추가 측정 필요 (4개 누락 heavy 페이지 차단으로 추가 감소 예상)
- [ ] 대시보드 자체의 TTFB **추가 -50ms 이상** — production 머지 후 Speed Insights 추적

---

### 11.5. Step #7 — List 페이지 쿼리 최적화 성공조건

**구현 (Code) — 7.1 count 옵션화**
- [ ] `apps/server/src/api/traces.ts`의 `count: 'exact'` → `count: 'estimated'` 또는 `?withCount=false` 분기
- [ ] `apps/server/src/api/requests.ts`의 `countRequests` 호출이 조건부 (필터 없을 때만 또는 옵션 시)
- [ ] 클라이언트 컴포넌트가 추정값 표시 OK (예: "약 1.2k" 또는 "1,200+")
- [ ] TypeScript / lint / 단위 테스트 통과

**구현 (Code) — 7.2 무필터 첫 페이지 캐시**
- [ ] `withStatsCache` (Step #4 헬퍼) import
- [ ] `isFirstUnfilteredPage` 분기 명확 (모든 필터 부재 + page=1 + 기본 limit)
- [ ] 캐시 키에 `orgId` 포함 (`org:${orgId}:requests:first-page`, `org:${orgId}:traces:first-page`)
- [ ] 필터가 하나라도 있으면 캐시 우회

**구현 (Code) — 7.3 컬럼 축소 (선택)**
- [ ] list 컴포넌트가 실제 사용하는 필드 목록화
- [ ] `LIST_COLUMNS` 조정
- [ ] detail 페이지 전환 시 회귀 없는지 확인

**동작 검증 (Behavior)**
- [ ] `/api/v1/traces?page=1&limit=50` 첫 호출: Supabase COUNT 안 함 (DB 로그 확인) 또는 estimated 사용
- [ ] 응답 시간 측정: count 변경 전후 비교 — **-200~500ms 감소**
- [ ] 무필터 첫 페이지 동시 진입: 캐시 hit으로 5~10ms 응답 (Step #4와 동일 패턴)
- [ ] 필터 추가 후 진입: 캐시 우회, 정상 query 실행 (응답 시간 cold 수준)
- [ ] 페이지네이션 UI: 추정값 또는 "1,200+" 형식 정상 표시

**회귀 가드 (No Regression)**
- [ ] list 응답 envelope 구조 변경 없음 (`{ success, data, meta: { total, page, limit } }`)
- [ ] detail 페이지 진입 정상 (list → detail 흐름 e2e)
- [ ] 필터 조합 5가지 이상 (date range, status, projectId 등) 모두 정상 동작
- [ ] 클라이언트 페이지네이션 → 2페이지, 3페이지 정상 작동

**성능 (Performance)**
- [ ] `/requests` cold 진입 응답 시간: **-300~500ms** (count 제거)
- [ ] `/traces` cold 진입 응답 시간: **-300~500ms**
- [ ] 같은 org 무필터 두 번째 진입: **5~15ms**
- [ ] Supabase / ClickHouse 쿼리 QPS: 측정 기간 평균 **-30% 이상**

**보안**
- [ ] 캐시 키에 `orgId` 포함 검증 (Step #4와 동일 패턴)
- [ ] 다른 org 토큰으로 같은 URL 요청 시 데이터 격리 확인

---

### 11.6. Step #1 — 보류 결정 검증

이 항목은 "**적용 안 하기로 결정한 것이 옳다**"를 재확인하는 체크리스트.

- [ ] `apiGetServer`의 `cache: 'no-store'` 유지
- [ ] 클라이언트 측 `Cache-Control` 헤더 효과는 **브라우저 → web** 구간에서만 작동 — 이걸로 충분한지 측정
- [ ] Step #4 적용 후 서버 부담이 충분히 줄었다면 Step #1 추가 작업 불필요로 close
- [ ] 만약 추후 도입 검토 시: Authorization 헤더가 캐시 키에 포함되지 않는 Next.js 기본 동작을 해결할 별도 메커니즘 설계 필요

---

### 11.7. Step #6 — 보류 결정 검증

- [ ] Step #1~#5 적용 후 cold 진입 < 2초 달성 → Step #6 불필요
- [ ] 만약 > 2초인 경우만 Option A (Route Handler 통합) 설계 착수
- [ ] Proxy의 streaming 동작 (P2.2 stream-deadline, gotcha #8/#11) 재검증 비용을 고려한 ROI 계산서 별도 작성 후 결정

---

### 11.8. 전체 프로젝트 완료 조건 (DoD)

모든 Step PR 머지 후 다음 조건 만족 시 "Dashboard Load Perf 2026-05" 작업 종료:

- [ ] **`/dashboard` 체감 5~6초 → 1.5~2초** (cold, Fast 3G + Korean RTT)
- [ ] **`/requests`·`/traces` 체감 5초 → 2~2.5초** (cold)
- [ ] **warm 진입 < 500ms** (모든 페이지)
- [ ] Vercel Speed Insights의 `/dashboard` LCP **p75 < 2.5s**, FCP **p75 < 1.5s**
- [ ] Vercel Speed Insights의 `/requests`·`/traces` LCP **p75 < 3s**
- [ ] Sentry 또는 console error 모니터링에서 **신규 hydration error 0건** (7일 관찰)
- [ ] 멀티유저 시나리오에서 **tenant 격리 위반 0건** (수동 + 자동 테스트)
- [ ] 작업 전후 측정 데이터를 `docs/plans/dashboard-load-perf-2026-05-results.md`에 기록
- [ ] CLAUDE.md의 gotcha 섹션에 SWR 캐시 관련 주의사항 추가 (`orgId` 키 포함 의무, fresh/stale 의미)

---

## 12. 참고 자료

- [16d83e6 revert commit](https://github.com/spanlens/spanlens/commit/16d83e6) — Suspense streaming revert 사유
- [performance_optimization.md](performance_optimization.md) — 마케팅 페이지/번들 최적화 트랙
- [infrastructure-region-survey.md](infrastructure-region-survey.md) — 리전 / 데이터 흐름
- [CLAUDE.md gotcha #11](../../CLAUDE.md) — proxy streaming + Node runtime 제약
- React `cache()` — https://react.dev/reference/react/cache
- TanStack Query v5 hydration — https://tanstack.com/query/v5/docs/framework/react/guides/ssr

---

## 부록 A — Step #2 PR 템플릿

```
perf(web): dedupe getSession() across prefetchAll with React cache()

Wraps the Supabase getSession() call in apiGetServer with React's cache()
so a single page render only triggers one auth roundtrip, regardless of
how many queries prefetchAll fans out.

Before: /dashboard prefetchAll([10 queries]) → 10× getSession() → 10×
Supabase auth roundtrips (~300-600ms total for Korean clients).

After:  same dashboard load → 1× getSession() → 1× auth roundtrip.

Verified locally with a temporary console.log in the cached function:
log line appears exactly once per request.

No behavior change for warm sessions (token already cached). No security
implications — cache() is per-render and per-request, never cross-user.
```

---

## 부록 B — 각 Step의 Pull Request 분리 권장

작은 PR로 나누는 이유:
1. 각각 측정 가능
2. 회귀 시 어떤 변경이 원인인지 식별 쉬움
3. 리뷰 속도

| PR | Step | 파일 수 | 줄 수 |
|----|------|---------|-------|
| #1 | Step #2 | 1 (api.ts) | ~10 |
| #2 | Step #5 | 1 (sidebar.tsx) | ~15 |
| #3 | Step #3 — page.tsx | 1 | ~10 |
| #4 | Step #3 — skeleton 추가 | 5~7 | ~50 |
| #5 | Step #4 — stats-cache.ts SWR 헬퍼 | 1 (신규) | ~100 |
| #6 | Step #4 — stats.ts 4개 핸들러 적용 | 1 | ~30 |
| #7 (선택) | Step #4 — `X-Cache-Bypass` + 새로고침 버튼 | 2 | ~30 |

---

## 부록 C — 향후 옵션: Version Key 패턴 (이벤트 기반 invalidation)

SWR로 99%의 케이스가 해결되지만, 만약 미래에 **"이벤트 발생 즉시 캐시 무효화"** 가 필요해지면 (예: 큰 고객이 "방금 보낸 요청이 즉시 카운터에 반영돼야 한다" 요구), 다음 패턴으로 확장 가능:

### 동작 원리

```ts
// 1. 캐시 키에 version 포함
const v = await redis.get<number>(`org:${orgId}:stats:version`) ?? 0
const cacheKey = `org:${orgId}:stats:overview:v${v}:${from}`

// 2. 새 LLM 요청이 logger를 통해 ClickHouse에 INSERT될 때
//    (lib/logger.ts의 fireAndForget 안에서)
await redis.incr(`org:${orgId}:stats:version`)
// → 다음 캐시 lookup은 새 키(`v1`)로 가서 자동 miss → fresh fetch
```

### 장단점

**장점:**
- pattern delete(`KEYS *`) 회피 → production 안전
- atomic — `INCR`은 race condition 없음
- 옛 키는 Redis TTL로 자연 만료 → 청소 불필요

**단점:**
- 매 LLM 요청마다 Redis INCR 1회 추가 → 트래픽 큰 org는 Redis 부담
- 모든 stats 종류 동시 무효화 — 너무 광범위할 수 있음 (필요 시 `stats:overview:version` / `stats:models:version` 분리)
- SWR의 "백그라운드 갱신" 효과를 잃음 (매번 동기 fetch)

### 도입 트리거

다음 중 하나 발생 시:
1. 고객이 "방금 보낸 요청 즉시 반영" 명시 요구
2. SWR로 stale 윈도우 진입한 사용자 비율이 측정 결과 의외로 높음 (>30%)
3. Realtime 트레이스 push와 일관성 맞춰야 하는 새 기능 도입

**현 단계에서는 도입 안 함.** SWR + `X-Cache-Bypass` 헤더로 충분.
