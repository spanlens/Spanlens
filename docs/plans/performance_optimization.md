# Web Performance Optimization · 첫 로드 속도 개선 계획

Spanlens 웹 앱의 첫 페이지 로드(캐시 없는 상태) 속도를 단계적으로 개선하기 위한 실행 계획.

---

## 0. 현재 기준점 (Baseline)

Chrome 측정값 (https://www.spanlens.io/, 2026-05-06):

| 지표 | 측정값 | 평가 | Good 기준 |
|------|--------|------|-----------|
| **TTFB** | 8ms | ✅ 완벽 | < 200ms |
| **FCP** | **7.4초** | ❌ 심각 | < 1.8초 |
| DOMContentLoaded | 3.1초 | △ | - |
| Load Complete | 3.4초 | △ | - |

### 진단

서버는 8ms 안에 HTML을 내려보내지만(Vercel CDN 정상 동작), 그 이후 **JS 다운로드/파싱/실행**이 7초를 차지함. 즉 서버는 빠른데 브라우저가 느린 상태. 원인은 다음 두 가지:

1. **번들 크기** — 마케팅 페이지에도 대시보드용 JS(cmdk, recharts 등)가 포함됨
2. **모든 대시보드가 `'use client'`** — 21개 페이지 전부 클라이언트 컴포넌트라 JS 도착 전까지 빈 화면

### 코드 현황 (조사 완료)

- `apps/web/app/(dashboard)/` 하위 페이지 **15개** 전부 `'use client'`
- `loading.tsx` 파일 **0개**
- `Suspense` 사용 **0건**
- `lucide-react` import **29개 파일** (barrel import)
- `recharts` import **2개 파일**, 대시보드 메인에서 즉시 로드
- 폰트 `.woff` 파일 (`.woff2` 아님)
- raw `<img>` 사용 **12개 파일** (전부 `/icon.png` 로고)
- `CommandPaletteProvider` 가 root layout에 위치 (마케팅 + auth 페이지에도 cmdk 로드됨)
- ReactQueryDevtools가 prod 번들에 포함될 위험 (`process.env.NODE_ENV` 체크는 import 자체를 막지 못함)

---

## 1. 단계 구성

| 단계 | 내용 | 공수 | 리스크 |
|------|------|------|--------|
| Stage 1 | 퀵윈 ①~⑤ (번들 최적화 + 폰트/이미지 정리) | 반나절 | 낮음 |
| Stage 2 | `loading.tsx` 추가 (체감 속도 개선) | 반나절 | 매우 낮음 |
| Stage 3 | RSC + Suspense 점진 전환 (15개 페이지) | 며칠~1주 | 중간 |

각 단계 종료 시점에 measurement 섹션의 측정 방식대로 실측해서 효과 검증.

---

## 2. Stage 1 — 퀵윈 ①~⑤

### ① `optimizePackageImports` 설정 (10분)

**파일:** `apps/web/next.config.mjs`

`nextConfig` 객체에 다음 추가:

```js
experimental: {
  optimizePackageImports: [
    'lucide-react',
    'recharts',
    '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-select',
    '@radix-ui/react-tabs',
    '@radix-ui/react-tooltip',
    '@radix-ui/react-toast',
    'cmdk',
  ],
},
```

**검증:**
- `pnpm --filter web build` 실행해서 빌드 성공 확인
- 빌드 출력의 First Load JS 크기 변화 기록 (변경 전후 비교)

**예상 효과:**
- `lucide-react` 29개 파일이 사용하는 아이콘만 번들에 포함 → 80~150KB JS 감소
- Radix barrel imports 최적화

**리스크:** 거의 없음. Next.js 공식 지원 기능. 만약 특정 lib가 호환 안 되면 해당 항목만 빼면 됨.

---

### ② `CommandPaletteProvider` 위치 이동 (30분)

**현재 문제:**
`apps/web/app/layout.tsx:6,42`에서 root layout이 `CommandPaletteProvider`로 감싸고 있어, `/`(랜딩), `/login`, `/signup`, `/docs/*` 등 비대시보드 경로에도 cmdk 라이브러리 + 네비 데이터가 포함됨.

**작업:**

1. `apps/web/app/layout.tsx` 에서 import + 사용 제거:
   ```diff
   - import { CommandPaletteProvider } from '@/components/command-palette'
   ...
     <ThemeProvider>
   -   <CommandPaletteProvider>
        {children}
   -   </CommandPaletteProvider>
     </ThemeProvider>
   ```

2. `apps/web/app/(dashboard)/layout.tsx` 에 추가:
   ```tsx
   import { CommandPaletteProvider } from '@/components/command-palette'
   ...
   <ProjectProvider>
     <SidebarProvider>
       <CommandPaletteProvider>
         <div className="flex h-screen overflow-hidden bg-bg">
           ...
         </div>
       </CommandPaletteProvider>
     </SidebarProvider>
   </ProjectProvider>
   ```

**검증:**
- 대시보드 모든 페이지에서 `Cmd+K`(또는 `Ctrl+K`) 단축키로 팔레트 열림 확인
- 네비게이션 항목 클릭 시 정상 라우팅
- 검색 기능 정상 동작
- 마케팅 페이지(`/`)에서 단축키가 동작하지 않는지 확인 (의도된 변경)
- `useCommandPalette()` 훅을 호출하는 곳이 dashboard 외부에 있는지 grep:
  ```
  Grep "useCommandPalette" apps/web --glob "*.tsx"
  ```
  결과가 dashboard 내부 + components/command-palette.tsx 자기 자신만 나와야 함

**예상 효과:**
- 마케팅/auth/docs 경로 JS 번들 30~50KB 감소
- 랜딩 페이지 FCP -0.3~0.5초

**리스크:** 낮음. 만약 dashboard 외부에서 `useCommandPalette()`를 쓰는 곳이 있으면 해당 코드 위치 재검토.

---

### ③ `recharts` + `ReactQueryDevtools` dynamic import (1시간)

#### 3-A. recharts dynamic import

**현재:** `apps/web/components/dashboard/request-chart.tsx:3-12`, `apps/web/components/dashboard/spend-forecast.tsx` 가 `recharts`를 정적 import.

**작업:**

대시보드 페이지에서 차트 컴포넌트 자체를 dynamic import로 전환.

`apps/web/app/(dashboard)/dashboard/page.tsx`:

```diff
- import { RequestChart } from '@/components/dashboard/request-chart'
- import { SpendForecastCard } from '@/components/dashboard/spend-forecast'
+ import dynamic from 'next/dynamic'
+
+ const RequestChart = dynamic(
+   () => import('@/components/dashboard/request-chart').then(m => ({ default: m.RequestChart })),
+   {
+     ssr: false,
+     loading: () => <div className="h-[280px] bg-bg-elev rounded animate-pulse" />,
+   }
+ )
+ const SpendForecastCard = dynamic(
+   () => import('@/components/dashboard/spend-forecast').then(m => ({ default: m.SpendForecastCard })),
+   {
+     ssr: false,
+     loading: () => <div className="h-[200px] bg-bg-elev rounded animate-pulse" />,
+   }
+ )
```

**같은 작업을 demo 페이지에도 적용:** `apps/web/app/demo/dashboard/page.tsx` 에서 `RequestChart`, `SpendForecastCard` import 동일하게 변경.

**검증:**
- 대시보드 진입 시 카드/KPI/타임바는 즉시 표시되고, 차트 영역만 짧은 스켈레톤 후 로드되는지 확인
- 차트 hover/tooltip 정상 동작
- `pnpm --filter web build` 성공
- 빌드 출력에서 dashboard 페이지 First Load JS 감소 확인

#### 3-B. ReactQueryDevtools dynamic import (개발 모드만 로드)

**파일:** `apps/web/components/providers/query-provider.tsx`

```diff
'use client'

import { QueryClientProvider } from '@tanstack/react-query'
- import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
+ import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { getQueryClient } from '@/lib/query-client'

+ const ReactQueryDevtools =
+   process.env.NODE_ENV === 'development'
+     ? dynamic(
+         () => import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools })),
+         { ssr: false }
+       )
+     : () => null

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      {children}
-     {process.env.NODE_ENV === 'development' && (
-       <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
-     )}
+     <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  )
}
```

**검증:**
- `pnpm --filter web dev` 실행 후 우측 하단 devtools 아이콘 표시되는지 확인 (개발 모드)
- `pnpm --filter web build` 후 prod 번들에서 `react-query-devtools` 청크가 빠졌는지 확인
- 빌드 결과 `.next/server/chunks` 또는 `.next/static/chunks` 에 devtools 관련 청크 없는지 grep

**예상 효과 (3-A + 3-B 합쳐):**
- 대시보드 첫 로드 JS 약 95KB(recharts) + 30~50KB(devtools 잔존분) 감소
- 대시보드 FCP -0.8~1.2초

**리스크:**
- 차트 영역의 layout shift 가능. `loading: () => <div className="h-[280px]" />` 처럼 동일 높이 컨테이너로 대체해서 CLS(Cumulative Layout Shift) 0 유지.
- demo 페이지도 같이 바꿔야 함 (놓치기 쉬움).

---

### ④ 폰트 `.woff` → `geist` 패키지 전환 (30분)

**현재:** `apps/web/app/fonts/GeistVF.woff` + `GeistMonoVF.woff` 를 `next/font/local` 로 직접 로드. `.woff2`(약 30% 작음)가 아닌 `.woff` 사용.

**작업:**

1. 패키지 설치:
   ```bash
   pnpm --filter web add geist
   ```

2. `apps/web/app/layout.tsx` 수정:
   ```diff
   - import localFont from 'next/font/local'
   + import { GeistSans } from 'geist/font/sans'
   + import { GeistMono } from 'geist/font/mono'
   ...
   - const geistSans = localFont({
   -   src: './fonts/GeistVF.woff',
   -   variable: '--font-geist-sans',
   -   weight: '100 900',
   -   display: 'swap',
   - })
   - const geistMono = localFont({
   -   src: './fonts/GeistMonoVF.woff',
   -   variable: '--font-geist-mono',
   -   weight: '100 900',
   -   display: 'swap',
   - })
   ...
   - <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
   + <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
   ```

3. CSS 변수명 확인 — `geist` 패키지의 기본 변수명도 `--font-geist-sans` / `--font-geist-mono` 라 Tailwind config 변경 불필요. (다르면 `tailwind.config.ts` 의 `fontFamily` 매핑도 같이 수정.)

4. 정적 파일 정리 (선택):
   ```
   apps/web/app/fonts/GeistVF.woff
   apps/web/app/fonts/GeistMonoVF.woff
   ```
   삭제. **단, 다른 곳에서 import하지 않는지 grep 먼저:**
   ```
   Grep "GeistVF\.woff\|GeistMonoVF\.woff" apps/web
   ```

**검증:**
- 모든 페이지에서 텍스트 폰트가 동일하게 보이는지 시각 검토
- DevTools Network 탭에서 `.woff2` 파일이 로드되는지 확인
- `pnpm --filter web typecheck && lint && build` 성공

**예상 효과:**
- 폰트 파일 크기 ~30% 감소 (woff → woff2)
- `font-display: swap` 은 `geist` 패키지가 기본 지원

**리스크:** 매우 낮음. CSS 변수명만 동일하면 시각적 변화 없음.

---

### ⑤ `<img>` → `next/image` 전환 (2~3시간)

**대상 파일 (12개, 전부 `/icon.png` 로고):**

| 파일 | 줄 |
|------|-----|
| `apps/web/components/layout/sidebar.tsx` | 29 |
| `apps/web/components/layout/marketing-nav.tsx` | 23 |
| `apps/web/components/layout/demo-sidebar.tsx` | 12 |
| `apps/web/app/login/page.tsx` | 10 |
| `apps/web/app/signup/page.tsx` | 10 |
| `apps/web/app/onboarding/page.tsx` | 167 |
| `apps/web/app/verify-email/page.tsx` | 11 |
| `apps/web/app/waitlist/page.tsx` | 11 |
| `apps/web/app/auth/mfa/page.tsx` | 11 |
| `apps/web/app/auth/locked/page.tsx` | 11 |
| `apps/web/app/auth/device/page.tsx` | 9 |
| `apps/web/app/invite/page.tsx` | 184 |

**모든 위치 동일한 패턴:**
```tsx
<img src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" />
```

**작업 (각 파일 동일):**
```diff
+ import Image from 'next/image'
...
- <img src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" />
+ <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" priority />
```

**중요:**
- 위 fold(첫 화면) 로고는 `priority` 속성 추가 → 자동 lazy load 무력화하고 prefetch
- `width`/`height` 이미 명시되어 있으므로 그대로 유지
- `<img>` 마이그레이션 자동화는 안 함. 12곳 직접 검토 (priority 필요한 곳 vs 아닌 곳 구분 필요할 수 있음)

**검증:**
- `pnpm --filter web lint` 실행하여 `@next/next/no-img-element` 경고가 12개에서 0개로 줄었는지 확인
- 시각적으로 모든 로고 위치 동일하게 표시되는지 확인
- DevTools Network 탭에서 `/_next/image?url=%2Ficon.png&...` WebP/AVIF 응답 확인

**`next.config.mjs` 확인:**
- 외부 도메인 이미지가 없으므로 `images.remotePatterns` 추가 불필요
- 필요시 `images.formats: ['image/avif', 'image/webp']` 명시 (Next 14 기본값이 이미 그러함)

**예상 효과:**
- PNG 20x20 → WebP/AVIF 자동 변환으로 30~50% 감소
- 12곳 × 작은 절약이지만, sidebar/nav는 LCP 후보라 LCP 측정값 직접 영향

**리스크:** 낮음. `<img>` 와 `<Image>` API 호환성 높음.

---

### Stage 1 종료 후 검증 (필수)

1. `pnpm --filter web typecheck` ✅
2. `pnpm --filter web lint` ✅ (img 경고 0개)
3. `pnpm --filter web build` ✅ + First Load JS 측정값 기록
4. 로컬 dev에서 다음 경로 시각/기능 회귀 테스트:
   - `/` (랜딩) — 헤더, hero, 데모 카드
   - `/login`, `/signup` — 로고 표시, 로그인 동작
   - `/dashboard` — KPI, 차트 로드, 커맨드 팔레트 (Cmd+K)
   - `/savings` — 추천 목록, Simulate 다이얼로그
   - `/demo/dashboard` — 차트 표시
5. 프로덕션 배포 후 Chrome DevTools 또는 PageSpeed Insights에서 FCP 재측정

**예상 누적 효과 (Stage 1 종료 시점):**

| 지표 | Before | After | 개선 |
|------|--------|-------|------|
| FCP (랜딩) | 7.4s | 3.0~4.0s | -45~60% |
| FCP (대시보드) | 추정 5~7s | 2.5~3.5s | -50~60% |
| First Load JS (랜딩) | (build 출력으로 확인) | -150~250KB | - |
| 폰트 페이로드 | woff | woff2 (-30%) | - |

---

## 3. Stage 2 — `loading.tsx` 추가 (반나절)

### 목적

체감 속도 개선. 데이터 fetch 중에도 사용자에게 즉시 페이지 골격을 보여줘서, "클릭 → 빈 화면" 상태를 없앤다. 실제 로드 시간은 동일하지만 사용자 입장에선 매우 다르게 느낌.

### 작업

15개 대시보드 라우트 각각에 `loading.tsx` 파일 추가:

```
apps/web/app/(dashboard)/dashboard/loading.tsx
apps/web/app/(dashboard)/requests/loading.tsx
apps/web/app/(dashboard)/requests/[id]/loading.tsx
apps/web/app/(dashboard)/traces/loading.tsx
apps/web/app/(dashboard)/traces/[id]/loading.tsx
apps/web/app/(dashboard)/anomalies/loading.tsx
apps/web/app/(dashboard)/security/loading.tsx
apps/web/app/(dashboard)/savings/loading.tsx
apps/web/app/(dashboard)/prompts/loading.tsx
apps/web/app/(dashboard)/prompts/[name]/loading.tsx
apps/web/app/(dashboard)/alerts/loading.tsx
apps/web/app/(dashboard)/alerts/[id]/loading.tsx
apps/web/app/(dashboard)/settings/loading.tsx
apps/web/app/(dashboard)/projects/loading.tsx
apps/web/app/(dashboard)/billing/loading.tsx
```

### 공통 스켈레톤 컴포넌트

먼저 재사용 가능한 스켈레톤을 만든다:

`apps/web/components/layout/page-skeleton.tsx`:

```tsx
import { cn } from '@/lib/utils'

/**
 * Generic skeleton for dashboard pages — Topbar shape + 3 stat tiles + table.
 * Matches the visual rhythm of most dashboard pages so the transition into
 * the real content feels seamless.
 */
export function PageSkeleton() {
  return (
    <div className="flex flex-col h-full -mx-4 -my-4 md:-mx-8 md:-my-7">
      {/* Topbar */}
      <div className="h-[44px] border-b border-border px-[22px] flex items-center gap-3">
        <div className="h-3 w-20 bg-bg-elev rounded animate-pulse" />
        <div className="h-3 w-2 bg-bg-elev rounded" />
        <div className="h-3 w-24 bg-bg-elev rounded animate-pulse" />
      </div>
      {/* Hero strip */}
      <div className="grid grid-cols-4 border-b border-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn('px-[16px] py-[16px]', i < 3 && 'border-r border-border')}>
            <div className="h-2.5 w-16 bg-bg-elev rounded animate-pulse mb-3" />
            <div className="h-7 w-20 bg-bg-elev rounded animate-pulse mb-2" />
            <div className="h-2 w-24 bg-bg-elev rounded animate-pulse" />
          </div>
        ))}
      </div>
      {/* Body */}
      <div className="flex-1 p-6 space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-12 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}
```

### 각 `loading.tsx` 파일 내용

대부분 페이지는 동일한 PageSkeleton 사용:

```tsx
// apps/web/app/(dashboard)/savings/loading.tsx
import { PageSkeleton } from '@/components/layout/page-skeleton'
export default function Loading() {
  return <PageSkeleton />
}
```

**예외 처리가 필요한 페이지:**
- `dashboard/loading.tsx` — KPI 카드 + 차트 영역까지 포함하는 전용 스켈레톤
- `requests/[id]/loading.tsx`, `traces/[id]/loading.tsx` — 단일 항목 상세 페이지라 sidebar + body 레이아웃
- `prompts/[name]/loading.tsx` — 탭 UI 포함

상세 페이지용 변형 1~2개 더 만들어서 사용 (`PageDetailSkeleton`).

### 검증

1. 각 페이지로 navigate 시 즉시 스켈레톤이 표시되고, 데이터 fetch 후 실제 컨텐츠로 교체되는지 확인
2. 스켈레톤 → 실제 컨텐츠 전환 시 layout shift(CLS) 발생 안 하는지 확인 — DevTools Performance 탭의 "Layout Shift" 마커
3. 네트워크 throttling "Slow 3G"로 실제 체감 확인

### 리스크

- 매우 낮음. 순수 추가 작업이라 기존 동작 영향 없음.
- 스켈레톤이 실제 페이지와 너무 다르면 오히려 깜빡임 효과로 어색할 수 있음 → 디자인은 단순/뉴트럴하게.

### 예상 효과

- 클릭 → 화면 표시까지 **체감 0초** (실제 0~100ms)
- 진짜 데이터 도착까진 동일하게 1~3초 걸리지만, 사용자는 "느린 앱" 이라 느끼지 않음

---

## 4. Stage 3 — RSC + Suspense 점진 전환 (며칠~1주)

### 전략

15개 페이지를 한꺼번에 바꾸지 않는다. 트래픽이 많고 복잡도가 적당한 페이지부터 하나씩.

### 우선순위

| 순서 | 페이지 | 이유 |
|------|--------|------|
| 1 | `/savings` | 최근 작업해서 구조 친숙. Server fetch 패턴 검증용 |
| 2 | `/dashboard` | 트래픽 1위. 가장 큰 임팩트 |
| 3 | `/requests` | 트래픽 2위. 페이지네이션 + 필터 패턴 학습 |
| 4 | `/traces`, `/anomalies`, `/security` | 비슷한 리스트 패턴 |
| 5 | `/prompts`, `/alerts` | 리스트 + 상세 탭 |
| 6 | `/settings`, `/projects`, `/billing` | 트래픽 낮음. 마지막 |
| 7 | 상세 페이지 `[id]`, `[name]` | 동적 라우트, 마지막 |

### 변환 패턴 (TanStack Query + RSC)

#### 4-A. 의존성: `@tanstack/react-query` v5 hydration 패턴

`@tanstack/react-query` 5.99 이미 사용 중이라 별도 설치 불필요.

#### 4-B. 표준 변환 절차 (페이지당)

**Before (현재):**
```tsx
// app/(dashboard)/savings/page.tsx
'use client'
export default function SavingsPage() {
  const { data, isLoading } = useRecommendations()
  if (isLoading) return <Skeleton />
  return <RecList data={data} />
}
```

**After (RSC + Hydration):**

1. **서버 컴포넌트 부분** (`page.tsx`):
   ```tsx
   import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
   import { fetchRecommendations } from '@/lib/server/fetch-recommendations'
   import { SavingsClient } from './savings-client'
   
   export default async function SavingsPage() {
     const queryClient = new QueryClient()
     await queryClient.prefetchQuery({
       queryKey: ['recommendations'],
       queryFn: fetchRecommendations,
     })
     return (
       <HydrationBoundary state={dehydrate(queryClient)}>
         <SavingsClient />
       </HydrationBoundary>
     )
   }
   ```

2. **클라이언트 컴포넌트 부분** (`savings-client.tsx`):
   ```tsx
   'use client'
   import { useRecommendations } from '@/lib/queries/use-recommendations'
   export function SavingsClient() {
     const { data } = useRecommendations()  // 서버에서 prefetch한 데이터 즉시 반환
     return <RecList data={data} />
   }
   ```

3. **서버 fetch 함수** (`apps/web/lib/server/fetch-recommendations.ts`):
   ```tsx
   import { headers } from 'next/headers'
   
   export async function fetchRecommendations() {
     const h = await headers()
     const cookie = h.get('cookie') ?? ''  // 인증 쿠키 전달
     const res = await fetch(`${process.env.API_URL}/api/v1/recommendations`, {
       headers: { cookie },
       cache: 'no-store',
     })
     if (!res.ok) throw new Error('Failed to fetch')
     return (await res.json()).data ?? []
   }
   ```

#### 4-C. 인증 처리

서버 컴포넌트의 fetch는 클라이언트 fetch와 달리 **자동으로 쿠키가 포함되지 않음**. 명시적으로 `headers()` 에서 `cookie`를 읽어 forward.

대시보드 layout에서 이미 `x-spanlens-user-id` 등을 읽고 있으므로, server fetch에서도 동일하게 사용 가능.

#### 4-D. 페이지별 작업 단위

각 페이지마다 다음 4가지 산출물:

1. `apps/web/lib/server/fetch-{name}.ts` — 서버 fetch 함수
2. `apps/web/app/(dashboard)/{path}/page.tsx` — RSC + HydrationBoundary
3. `apps/web/app/(dashboard)/{path}/{name}-client.tsx` — 기존 클라이언트 로직 분리
4. 회귀 테스트 (시각/기능)

### 페이지당 예상 공수

- 단순 페이지 (savings, anomalies, security): 30~45분
- 중간 (requests, traces, prompts): 60~90분
- 복잡 (dashboard, [id] 상세): 90~120분

15개 합계: **약 12~18시간** (실 작업) + 테스트/디버깅 = 2~3 작업일.

### 검증 (페이지마다)

1. `pnpm --filter web typecheck` ✅
2. `pnpm --filter web lint` ✅
3. 시각: 페이지 진입 시 데이터가 즉시 채워진 상태로 보임 (loading skeleton 거의 안 보임)
4. 네트워크: 서버 사이드에서 `/api/v1/...` 호출 + 클라이언트는 추가 fetch 안 일어남 (TanStack Query staleTime 내)
5. 인터랙션: useState 기반 정렬/필터/모달 정상 동작
6. 새로고침: hydration 에러 없음

### 리스크

- **TanStack Query staleTime 미스매치** — 서버에서 prefetch 직후 클라이언트가 invalidate 하면 즉시 refetch 일어남. `staleTime` 적절히 설정 (현재 5~10분)
- **인증 토큰 처리** — 서버 fetch에 cookie forward 안 하면 401. 검증 시점에 자주 누락되는 부분
- **사용자별 데이터 캐싱** — 서버 fetch는 user별로 다르므로 `cache: 'no-store'` 필수
- **Hydration mismatch** — 서버 렌더 vs 클라이언트 첫 렌더가 달라지면 React 경고. `useState` 초기값을 SSR-safe하게 (예: `loadDismissed()` 같은 localStorage 접근은 mount 후로 미루기 — savings 페이지는 이미 그렇게 되어 있음)

### 롤백 전략

페이지 단위로 점진 전환이라 문제 발생 시 해당 페이지만 git revert 가능. 전체 회귀 위험 없음.

---

## 5. 측정 방법론

### 정량 측정 도구

#### 5-A. PageSpeed Insights (외부 측정, 권장)

```
https://pagespeed.web.dev/analysis?url=https://www.spanlens.io
```

각 단계 종료 시 모바일/데스크톱 양쪽 측정. 핵심 지표:
- FCP (First Contentful Paint)
- LCP (Largest Contentful Paint)
- TBT (Total Blocking Time)
- CLS (Cumulative Layout Shift)
- Speed Index

#### 5-B. Chrome DevTools Performance 탭 (로컬 측정)

1. DevTools 열기 → Network 탭에서 "Disable cache" 체크
2. Performance 탭 → "Reload" 클릭 → 자동 측정 후 페이지 로드 완료까지 기록
3. 상단의 "Web Vitals" 트랙에서 FCP, LCP 마커 확인

#### 5-C. `pnpm --filter web build` 출력

빌드 후 콘솔에 표시되는 페이지별 First Load JS 사이즈 기록:

```
Route (app)                              Size     First Load JS
┌ ○ /                                    1.2 kB   95 kB
├ ○ /dashboard                           5.4 kB   180 kB
└ ...
```

각 단계 전후 비교.

### 측정 프로토콜

각 단계 종료 후 동일 환경에서:

1. 시크릿 창 열기 (캐시 없음 보장)
2. DevTools 열고 Network 탭 "Disable cache" 체크
3. URL 입력 후 페이지 완전 로드까지 대기
4. Performance metrics 캡처
5. 결과를 본 문서 끝의 측정 로그에 기록

### 비교 기준점

- **외부 비교 대상:** Helicone (https://helicone.ai), Langfuse (https://langfuse.com), PostHog (https://posthog.com)
- 같은 PageSpeed Insights로 측정해서 우리 위치 확인
- "FCP < 1.8초, LCP < 2.5초" 가 Good, 이게 최소 목표

---

## 6. 타임라인 & 마일스톤

| 시점 | 이벤트 | 측정 |
|------|--------|------|
| Day 0 | Baseline 확정 (현재 측정값 본 문서에 박제) | FCP 7.4s |
| Day 1 (오전) | Stage 1 ①~③ 완료 | - |
| Day 1 (오후) | Stage 1 ④~⑤ 완료 + 배포 + 측정 | FCP 3~4s 목표 |
| Day 2 | Stage 2 (loading.tsx) 완료 + 배포 | 체감 즉시 |
| Day 3~5 | Stage 3 우선순위 1~3 페이지 (savings, dashboard, requests) | 페이지별 측정 |
| Day 6~8 | Stage 3 나머지 페이지 | - |
| Day 9 | 전체 측정 + 본 문서 측정 로그 마감 | FCP 0.8~1.5s 목표 |

각 단계마다 별도 PR 권장:
- PR1: Stage 1
- PR2: Stage 2
- PR3~N: Stage 3 (페이지별 PR)

---

## 7. 측정 로그 (실측값 기록용)

### Baseline (2026-05-06)

| 지표 | spanlens.io (랜딩) | dashboard (로그인 후) |
|------|---------------------|------------------------|
| TTFB | 8ms | 미측정 |
| FCP | 7.4s | 미측정 |
| LCP | 미측정 | 미측정 |
| First Load JS | (build 출력 첨부 예정) | - |

### Stage 1 종료 후 (TBD)

| 지표 | Before | After | 변화 |
|------|--------|-------|------|
| | | | |

### Stage 2 종료 후 (TBD)

| 지표 | Before | After | 변화 |
|------|--------|-------|------|
| | | | |

### Stage 3 종료 후 (TBD)

| 지표 | Before | After | 변화 |
|------|--------|-------|------|
| | | | |

---

## 8. 부록 — 안 하는 것 & 그 이유

### 캐싱 기반 최적화 제외

- Service Worker / PWA — 첫 로드 효과 없음
- Next.js ISR/`revalidate` — 첫 로드 효과 없음 (재방문에만)
- HTTP cache header 튜닝 — 마찬가지

본 계획은 **첫 로드 속도** 개선이 목표. 캐싱 전략은 별도 작업으로 분리.

### Bundle Analyzer 도입

`@next/bundle-analyzer`로 정확한 청크 분석을 할 수도 있지만, 위 5가지 작업은 도구 없이도 작업 가능한 수준의 명확한 개선이라 우선 처리. Stage 3 이후 추가 최적화 여지를 찾을 때 도입 검토.

### React 19 / Next 15 업그레이드

현재 React 18 + Next 14. 업그레이드는 별도 의사결정 필요. 본 계획에 포함하지 않음 (RSC는 Next 14에서도 충분히 동작).

### Edge Runtime 전환

현재 Node runtime. Edge가 일부 시나리오에서 빠르지만, `@supabase/realtime-js` 호환 이슈로 일부 회피 코드 이미 존재 (`next.config.mjs:42-65`). 변경 시 리스크 큼. 본 계획에 포함하지 않음.

---

## 9. 책임 분담 (선택)

- **계획자/리뷰어:** -
- **구현자:** -
- **측정자:** -

(혼자 작업 시 모두 동일인.)

---

## 10. 변경 이력

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-05-06 | 초안 작성 (이 문서) |
