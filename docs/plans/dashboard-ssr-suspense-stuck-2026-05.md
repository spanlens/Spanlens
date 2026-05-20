# Dashboard `/requests` + `/dashboard` Pages — Server Component Stuck on Suspense Fallback

**발견 일자**: 2026-05-20
**환경**: production (www.spanlens.io), Chrome 데스크탑, 로그인 세션 활성
**관련 PR/배포**: PR #128 직후 (azure filter dropdown 한 줄 + smoke docs)
**Severity**: P1 — 핵심 대시보드 페이지 사용 불가

---

## 증상

`/requests` 와 `/dashboard` 두 페이지의 main content 영역이 React Server Component Suspense fallback (`<template id="B:0">` + `animate-pulse` skeleton bars)에서 **무기한 멈춤**. 다음 모두에서 회복 안 됨:

- 첫 진입 후 6~10초 대기
- `window.location.reload()` 두 차례
- 다른 페이지 (예: `/projects`) 갔다가 다시 진입

같은 세션에서 사이드바·헤더는 정상 렌더 (`oceancode` workspace, `Plan · Free 6 / 50k requests` 카운터 표시) — 즉 root layout 자체는 살아있고, **`(dashboard)/requests/page.tsx` 의 server component 만 stream을 끝내지 못함**.

## 재현

1. 로그인 상태로 `https://www.spanlens.io/requests` 또는 `/dashboard` 진입
2. 즉시 또는 잠시 후 main content가 skeleton 로 표시됨
3. 무기한 대기

확인된 HTML 패턴 (`main > div` innerHTML):
```html
<template id="B:0"></template>
<div class="flex flex-col h-full -mx-4 -my-4 ...">
  <div class="h-[52px] border-b border-border ...">
    <div class="h-2.5 w-20 bg-bg-elev rounded animate-pulse"></div>
    ...
  </div>
  ...
</div>
```

`<template id="B:0">` 는 Next.js 13+ App Router 의 streaming Suspense boundary 식별자. 컨텐츠가 도착하지 않아 hydration 단계로 못 넘어감.

## 격리된 사실

| 항목 | 상태 | 비고 |
|---|---|---|
| 사이드바 navigation | 정상 | username, plan, requests counter 모두 표시 |
| `/projects` 페이지 | 동일 stuck? (재확인 필요) | smoke 도중 확인 안 함 |
| `/api/v1/requests` (브라우저에서 fetch) | 401 | "Missing or invalid Authorization header" — JWT 가 자동 forward 안 됨 |
| 브라우저 console 에러 | 없음 | extension 메시지만 |
| 서버 logs (Vercel function logs) | **미확인** | 다음 조사 단계 |
| ClickHouse 데이터 자체 | 정상 가능성 큼 | proxy curl 들은 200 성공, fire-and-forget 로깅 정상 작동했을 가능성 — 단 별도 검증 필요 |

## 가능성 (높은 → 낮은)

1. **Vercel SSR 함수가 ClickHouse 또는 Supabase 호출에서 timeout** — `apps/web/lib/server/queries/*.ts` 류 server-side data fetch 가 5초 이상 hang → Next.js streaming 이 client 로 flush 못 함. `apps/server` Vercel function 의 `maxDuration: 300s` 처럼 web 측에도 길어진 timeout 있다면 5분까지 매달릴 수 있음. **가장 유력**.
2. **PR #128 머지 후 Vercel build/배포 일시 불안정** — production 배포가 propagation 단계라 specific revalidate window 에 SSR 깨질 수 있음. 시간 지나면 자가 회복. 진위 확인을 위해 `gh run list --workflow=...` 의 deployment 결과 확인.
3. **인증 cookie 만료 / refresh 실패** — Supabase JWT refresh 가 server 측에서 발생할 때 Suspense 중첩 안에서 무기한 wait 가능. browser 의 client component 들은 다른 store 에서 username 을 가져왔기 때문에 사이드바는 정상.
4. **ClickHouse Cloud Development tier slow start** — Spanlens 가 사용 중인 ClickHouse 가 idle 후 cold start 중일 때 첫 query 가 30s+ 걸릴 수 있음. CLAUDE.md gotcha 와 docs/plans/clickhouse-migration.md 참고.

## 다음 조사 단계 (우선순위)

- [ ] **Vercel function logs 확인** — `gh api repos/spanlens/Spanlens/actions/...` 또는 Vercel dashboard 에서 최근 `/requests` SSR 실행의 stderr/stdout 확인. `[clickhouse]` 또는 `[supabase]` timeout 로그 있는지.
- [ ] **`/health/deep` 호출** — server API 의 ClickHouse 헬스체크. degraded 상태이면 가설 #4 확정.
- [ ] **localhost 재현 시도** — `pnpm dev` 후 동일 페이지 hit. 재현되면 server-side issue 확정. 안 되면 production-specific (Vercel 캐시/배포 이슈).
- [ ] **Page-level instrumentation** — `apps/web/app/(dashboard)/requests/page.tsx` server component 에 `console.time('queries')` / `console.timeEnd` 임시 추가, 어느 query 가 hang 인지 분리.
- [ ] **PR #128 revert로 binary search** — 마지막 OK 알려진 시점 (PR #128 이전)에서 재현되는지 확인. PR #128 자체는 한 줄 + docs 추가라 SSR 영향 없을 것 같지만, Next.js 빌드 캐시가 깨졌을 가능성 있음. revert 검증은 마지막 수단.

## 임시 우회 (사용자용)

조사 끝날 때까지 사용자가 데이터 확인하려면:
- ClickHouse 데이터 자체는 멀쩡할 가능성 큼 (proxy 200 + fire-and-forget log 성공). server 의 `/api/v1/requests` 를 sl_live key 가 아닌 JWT 로 호출하면 데이터 보임 (CLI 또는 직접 fetch 도구 필요).
- 또는 ClickHouse Cloud console 직접 접속.

## 책임자 (proposed)

- 첫 조사: 본 cycle 운영자 (필요시 클로드 driving)
- Vercel logs 접근: 사용자 본인 (Vercel 계정 owner)
- 30분 안에 root cause 잡히지 않으면 → Vercel support 티켓 + PR #128 revert 고려
