# Org Members · Multi-user Organization Plan

팀 단위 멀티유저 지원 + per-user Needs-attention dismiss 구현 계획.

## 범위

- 역할(role): `admin` / `editor` / `viewer` 3단계
- 이메일 초대 (만료 7일)
- "마지막 admin 보호" 룰 (조직 lockout 방지)
- 권한별 UI 분기 (viewer는 편집 버튼 전부 숨김)
- Needs-attention 카드 dismiss를 유저별 DB 저장으로 전환

## 권한 매트릭스

| 작업 | admin | editor | viewer |
|---|:---:|:---:|:---:|
| 데이터 조회 (requests/traces/stats 등) | ✓ | ✓ | ✓ |
| 프롬프트 · 알림 · API 키 · provider key 생성/수정/삭제 | ✓ | ✓ | ✗ |
| 조직 설정 (이름 변경, 삭제) | ✓ | ✗ | ✗ |
| 멤버 초대 · 제거 · 역할 변경 | ✓ | ✗ | ✗ |
| 결제(Billing) · Plan 변경 | ✓ | ✗ | ✗ |

## 마지막 admin 보호 룰

조직에 admin이 0명이 되면 조직이 잠김. 예외 없이:

- 마지막 admin은 editor/viewer로 **강등 불가** (Server에서 거부)
- 마지막 admin은 **삭제 불가**
- 본인이 마지막 admin일 때 본인 탈퇴/강등 **불가**
- 조직 생성자는 자동으로 admin. 이후 admin끼리 자유롭게 승격/강등 가능 → ownership 이전 별도 API 불필요

---

# Phase 1 · DB 스키마 + RLS

**신규 마이그레이션**: `supabase/migrations/20260425000000_org_members.sql`

1. `org_role` enum 생성
2. `org_members` 테이블 생성 (PK: organization_id + user_id)
3. 기존 `organizations.owner_id` → `org_members` 로 백필 (role='admin')
4. `is_org_member()` 함수를 `org_members` 기준으로 재작성
5. `org_invitations` 테이블 생성
6. `attn_dismissals` 테이블 생성
7. RLS enable + 정책 3종 (같은 조직 멤버만 읽기, admin만 쓰기)

### 성공 기준

- [x] `supabase db push` 에러 없이 성공
- [x] `supabase gen types --local` 재생성 후 `org_role` 타입 노출됨
- [x] 기존 organization 수만큼 `org_members` 로우 존재 (role='admin')
- [x] RLS: 다른 조직 멤버로 다른 조직 members 조회 → 빈 배열 *(정책 정의만 확인)*
- [x] `anon` 키로 members INSERT 시도 → 403 *(42501 검증)*
- [ ] 프로덕션 DB에도 동일하게 적용 완료 *(전체 Phase 완료 후 배포)*
- [x] `pnpm typecheck` 통과

---

# Phase 2 · Role 미들웨어

**수정**: `apps/server/src/middleware/authJwt.ts`

- JWT 검증 후 `org_members` 에서 role 조회해서 `c.set('role', ...)`
- orgId 해석도 이 테이블 기준으로 통일 (app_metadata fallback 제거)

**신규**: `apps/server/src/middleware/requireRole.ts`

- `requireRole('admin')`, `requireRole('admin', 'editor')` 형태
- 권한 없으면 `403 { error: 'Insufficient permission' }`

### 성공 기준

- [x] 기존 GET 엔드포인트들 모두 통과 (viewer 포함 모든 role 허용)
- [x] 기존 stats/anomalies/security 테스트 모두 green *(121/121 passed)*
- [x] `c.get('role')` 타입 추론됨 (`JwtContext` 확장)
- [x] `pnpm --filter server typecheck && lint && test` 통과

---

# Phase 3 · 기존 write API 권한 반영

**대상 파일** (`apps/server/src/api/`):

- `prompts.ts` — POST/PATCH/DELETE → `requireRole('admin', 'editor')`
- `alerts.ts` — 동일
- `api-keys.ts` — 동일 (rotate/revoke 포함)
- `provider-keys.ts` — 동일
- `saved-filters.ts` — 동일
- `projects.ts` — POST → `requireRole('admin', 'editor')`, DELETE → `requireRole('admin')`
- `organizations.ts` — PATCH/DELETE → `requireRole('admin')`
- `audit-logs.ts` — GET는 전체 허용

### 성공 기준

- [x] viewer 토큰으로 POST 엔드포인트 → 403 *(`require-role.test.ts` 검증)*
- [x] editor 토큰으로 edit 엔드포인트 → 통과 *(`require-role.test.ts` 검증)*
- [x] admin 토큰으로 admin-only 엔드포인트 → 통과
- [x] editor 토큰으로 admin-only 엔드포인트 → 403
- [x] `requireRole` 단위 테스트 5종 추가 (role × endpoint 매트릭스 커버)
- [x] `POST /organizations` 가 신규 유저를 `org_members`에 admin으로 자동 추가하도록 수정
- [x] admin 브라우저 세션으로 기존 대시보드 전체 기능 정상 작동 (회귀 없음)
- [x] `pnpm --filter server typecheck && lint && test` 통과 *(126/126)*

---

# Phase 4 · 멤버 관리 API

**신규**: `apps/server/src/api/members.ts`

```
GET    /api/v1/organizations/:orgId/members
PATCH  /api/v1/organizations/:orgId/members/:userId   body: { role }
DELETE /api/v1/organizations/:orgId/members/:userId
```

- GET: viewer+ 전원 허용 (팀원 목록은 누구나 봄)
- PATCH/DELETE: admin만
- 마지막 admin 보호 로직: PATCH(강등)/DELETE 모두 DB 쿼리 전 선검사
  ```ts
  if (currentRole === 'admin' && newRole !== 'admin') {
    const adminCount = await supabaseAdmin
      .from('org_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'admin')
    if (adminCount.count === 1) return c.json({ error: 'Cannot demote last admin' }, 400)
  }
  ```

### 성공 기준

- [x] GET members 응답에 email, role, createdAt, invitedBy 포함
- [x] 마지막 admin 강등 시도 → 400 `Cannot demote the last admin` *(e2e 검증)*
- [x] 마지막 admin 삭제 시도 → 400 `Cannot remove the last admin` *(e2e 검증)*
- [x] 유효하지 않은 role 값 → 400 *(e2e 검증)*
- [x] 라우터 등록: `/api/v1/organizations/:orgId/members` + `orgMismatch` 가드
- [x] 단위 테스트 7종 추가 (`members-last-admin.test.ts`)
- [x] `pnpm --filter server typecheck && lint && test` 통과 *(133/133)*

---

# Phase 5 · 초대 API + 이메일

**신규**: `apps/server/src/api/invitations.ts`

```
POST   /api/v1/organizations/:orgId/invitations   body: { email, role }
GET    /api/v1/organizations/:orgId/invitations   (pending 목록)
DELETE /api/v1/invitations/:id                    (pending 취소)
GET    /api/v1/invitations/accept?token=xxx       (public, 토큰 검증)
POST   /api/v1/invitations/accept                 body: { token }
```

**토큰 처리**:
- 생성: `crypto.randomBytes(32).toString('base64url')` (43자 base64url)
- DB 저장: `sha256(token)` 해시만. 원본은 이메일에만
- 검증: 해시 비교 + `expires_at > now()` + `accepted_at IS NULL`
- 수락 flow:
  - 토큰 유효성 체크 → 초대 email vs 현재 유저 email 일치 확인 → `org_members` INSERT + `invitations.accepted_at` SET
  - 둘 다 같은 트랜잭션 (supabase RPC로 감싸기)

**이메일**: `apps/server/src/lib/resend.ts`
- `sendInvitationEmail({ to, orgName, inviterName, role, acceptUrl })`
- React Email 템플릿: `apps/server/src/emails/invitation.tsx`
- `RESEND_API_KEY` 없으면 개발 환경에선 콘솔에 링크만 출력 (local dev 편의)

### 성공 기준

- [x] admin이 초대 생성 → 201 + dev URL 반환 *(Resend 연결 시 실제 발송)*
- [x] `requireRole('admin')` 으로 editor·viewer는 초대 생성 불가 *(미들웨어로 자동)*
- [x] 초대 생성 후 pending 목록에 노출 (`count: 1`)
- [x] 유효하지 않은 role → 400 `role must be admin | editor | viewer`
- [x] 같은 email 중복 pending → 409 `A pending invitation for this email already exists`
- [x] 이미 수락된 토큰 재사용 시도 → 400 `Invitation already accepted`
- [x] 다른 email로 로그인 후 accept 시도 → 400 `This invitation was sent to a different email`
- [x] 수락 성공 시 `org_members` INSERT + `accepted_at` SET (members 목록에 신규 멤버 확인)
- [x] local dev(`RESEND_API_KEY` 없음)에서 응답에 `devAcceptUrl` 포함 + 서버 stdout에 로그
- [x] 토큰은 sha256 해시로만 저장 (원본은 이메일에만)
- [x] `pnpm --filter server typecheck && lint && test` 통과

---

# Phase 6 · 초대 수락 페이지 + 가입 연동

**신규 페이지**: `apps/web/app/invite/page.tsx` (public route)

- `?token=xxx` 쿼리스트링 읽기
- GET `/api/v1/invitations/accept?token=xxx` 로 초대 메타 조회 (orgName, inviterName, role, email)
- 상태별 UI:
  - 비로그인 → "이 초대를 받으려면 {email}로 로그인하거나 가입해야 합니다" + [Sign up] [Sign in] 버튼
    - [Sign up] → `/signup?invite=xxx&email={email}` (이메일 prefill)
    - [Sign in] → `/login?next=/invite?token=xxx`
  - 로그인 + email 일치 → "{orgName}에 {role}로 참여" + [Accept] 버튼
    - [Accept] → POST accept → 성공 시 `/dashboard` redirect
  - 로그인 + email 불일치 → 에러 안내 + [Sign out] 버튼
  - 만료 → "초대가 만료되었습니다" + 어드민 재초대 안내

**수정**: `/signup` 페이지
- `?invite=xxx` 있으면 가입 직후 자동으로 accept API 호출
- 신규 유저는 조직 생성 플로우 대신 invitation 기반으로 멤버 추가됨

### 성공 기준

- [x] 비로그인 상태에서 `/invite?token=xxx` 접근 → Sign up / Sign in 버튼 노출
- [x] `/invite` 를 middleware PUBLIC_PATHS에 추가
- [x] Signup 페이지에서 `?invite=xxx&email=...` 쿼리 파라미터로 email prefill
- [x] 신규 가입 → 자동 수락 → 대시보드 진입 (DB: newbie@test.dev=editor 추가 확인)
- [x] 이미 로그인한 상태에서 email 일치 → Accept 버튼 1 클릭 완료
- [x] 다른 email 계정으로 accept 시도 → "Wrong account" 명확 안내 + Sign out 버튼
- [x] 만료/잘못된 토큰 → Invalid 상태 화면 (코드상 처리)
- [x] 초대로 가입한 유저(`app_metadata.org_id` 없음) 도 middleware `org_members` fallback 으로 `/dashboard` 접근 가능
- [x] `pnpm --filter web typecheck && lint` 통과

---

# Phase 7 · Settings > Members UI

**수정**: `apps/web/app/(dashboard)/settings/members/page.tsx` (기존 mock을 실데이터로)

- 멤버 테이블: email · role · joined_at · [actions]
  - role 컬럼: dropdown (admin/editor/viewer) — admin만 인터랙션
  - actions: remove (admin만)
  - 마지막 admin 표시에 lock 아이콘 + 툴팁 "마지막 admin은 제거할 수 없습니다"
- 상단 "Invite member" 버튼 (admin만) → 모달
  - 입력: email, role select
  - submit → POST invitations → 성공 시 pending 섹션에 추가
- Pending invitations 섹션: email · role · expires_in · [resend] [cancel]

### 성공 기준

- [x] viewer 로그인 시 Members 탭 진입 가능, 목록 보임, 편집 버튼 전부 숨김 *(screenshot 검증)*
- [x] admin 로그인 시 초대/역할변경/제거 UI 전부 노출 + Invite 모달
- [x] 마지막 admin 행에 `🔒 last admin` 표시 + role dropdown/remove 버튼 숨김
- [x] Invite 모달: email + role select + devAcceptUrl 응답 시 링크 표시
- [x] Pending invitations 섹션 자동 표시 (초대 있을 때만)
- [x] `use-members.ts` 훅 7개 추가 (list/invite/update/remove/cancel/current member/current role)
- [x] `GET /organizations/me` 를 `org_members` 기반으로 수정 (owner_id → orgId)
- [x] `pnpm --filter web typecheck && lint` 통과

---

# Phase 8 · 프론트 권한 분기

**신규 훅**: `apps/web/lib/queries/use-current-role.ts`
```ts
export function useCurrentRole(): 'admin' | 'editor' | 'viewer' | null
```
- `/api/v1/members/me` 또는 `/api/v1/auth/me` 호출 → cached
- 또는 기존 `useOrganization()` 확장

**공통 컴포넌트 수정**:
- 편집 버튼 (Create prompt, New alert, Rotate key 등) 전역 감지
- `<PermissionGate need="edit">...</PermissionGate>` 래퍼 컴포넌트
- viewer → null 렌더 (완전히 숨김), editor → 그대로

**대상 페이지** (버튼 찾아서 래핑):
- `/prompts` — "New prompt" 버튼
- `/alerts` — "Create alert" 버튼, Edit/Delete, Pause/Resume
- `/projects` — "Create key" 등
- `/settings/*` — 각 탭의 저장/변경 버튼
- 공통 컴포넌트 내 수정/삭제 아이콘

### 성공 기준

- [x] `useCurrentRole` / `useCanEdit` / `useIsAdmin` 훅 추가
- [x] `<PermissionGate need="edit" | "admin">` 컴포넌트 추가
- [x] viewer 계정으로 로그인 → 편집 버튼 전부 사라짐 (screenshot 검증)
  - Prompts: `+ register prompt` 숨김
  - Alerts: `+ Add channel / + New alert / Edit / Pause / Delete / 채널 휴지통` 숨김
  - Alerts/[id]: 상단 Edit·Pause·Delete 숨김
  - Projects: `New project / New API key / Revoke / Override / Add default` 숨김
  - Anomalies: `Ack / Unack` 숨김
  - Sidebar: `Upgrade →` 위젯 숨김 (admin 전용)
- [x] admin 전용 숨김 — 플랜 전환 버튼은 `Admin only` disabled, overage 설정 disabled + 안내문
- [x] General 탭 Workspace name input: admin만 편집 가능
- [x] Settings > Provider keys: viewer/editor 구분 — editor는 가능, viewer만 Rotate/Revoke 숨김
- [x] 서버 `requireRole` 미들웨어가 최종 방어선 (Phase 3 검증)
- [x] `pnpm --filter web typecheck && lint` 통과

---

# Phase 9 · Needs-attention Dismiss DB 전환

**신규 API**: `apps/server/src/api/dismissals.ts`
```
GET    /api/v1/dismissals              # 내 dismissed card_keys[]
POST   /api/v1/dismissals              body: { cardKey }
DELETE /api/v1/dismissals/:cardKey
```

**card_key 규칙** (결정론적):
- `pii_leak` — PII 카드는 모든 PII 통합 1개
- `anomaly:{provider}:{model}:{kind}` — 같은 이상치는 한 번 닫으면 재발생 전까지 숨김
- `alert:{alertId}` — alert별 독립
- `savings:{recommendationId}` — 추천별 독립

**수정**: `apps/web/app/(dashboard)/dashboard/page.tsx`
- 기존 `loadDismissed/saveDismissed` (localStorage) 삭제
- `useDismissals()` TanStack query로 대체
- dismiss 클릭 시 `useMutation` + optimistic update
- 각 카드 생성 시 deterministic `cardKey` 계산 (현재 `title` 문자열 대신)

### 성공 기준

- [x] 서버 `/api/v1/dismissals` GET/POST/DELETE 엔드포인트 추가
- [x] `attn_dismissals` 테이블에 dismiss row 실제 저장 확인
- [x] dismiss 후 새로고침 → 카드 유지 (DB persistence)
- [x] 다른 유저(newbie@test.dev)로 로그인 → 동일 카드 다시 보임 (유저 독립)
- [x] localStorage 기반 코드 완전 제거 (`loadDismissed`/`saveDismissed` 삭제)
- [x] deterministic cardKey 체계:
  - `pii_leak`
  - `anomaly:{provider}:{model}:{kind}`
  - `alert:{alertId}`
  - `savings:{rec.id ?? current->suggested}`
- [x] TanStack Query optimistic update + onError 롤백 구현
- [x] `useDismissCard` / `useRestoreCard` 훅 (복원은 미래 UI 확장용)
- [x] `pnpm --filter web typecheck && lint` + `--filter server typecheck` 통과

---

# 전체 의존 순서

```
Phase 1 (DB)
 └─ Phase 2 (role 미들웨어)
     ├─ Phase 3 (기존 write API 권한)
     ├─ Phase 4 (멤버 API)
     │   └─ Phase 5 (초대 API + 이메일)
     │       └─ Phase 6 (초대 수락 페이지)
     │           └─ Phase 7 (Members UI)
     ├─ Phase 8 (UI 권한 분기) — Phase 3 이후 언제든 가능
     └─ Phase 9 (Dismiss DB) — Phase 2 이후 독립 가능
```

Phase 8, 9는 독립적이라 병렬 가능.

# 전체 완료 기준

- [ ] 신규 유저 2명을 admin이 초대 → 양쪽 모두 로그인 성공, Members 목록에 3명 표시
- [ ] editor 계정이 프롬프트 생성/수정 가능, 조직 설정 버튼 전부 숨김
- [ ] viewer 계정이 대시보드 조회 가능, 편집 버튼 0개
- [ ] admin 2명 중 한 명이 다른 admin을 editor로 강등 → 본인 혼자 남은 admin이 본인을 강등 시도 → 차단
- [ ] 멤버 A가 PII 카드 dismiss → 멤버 B는 여전히 보임, A는 다른 기기에서도 안 보임
- [ ] RLS: 조직 외부 유저가 members/invitations 직접 쿼리 시도 → 403 or 빈 배열
- [ ] 모든 phase의 `pnpm typecheck && lint && test` green
- [ ] 프로덕션 DB에 마이그레이션 적용 + 배포 + smoke test 통과

# Out of Scope (지금 안 함)

- SSO (Google/GitHub OAuth) — 추후
- SCIM provisioning — enterprise 후순위
- Ownership 이전 API — 마지막 admin 보호 룰로 대체됨
- Audit log에 role 변경 이벤트 기록 — 추후 (Phase 4에 hook만 남기고 실제 기록은 생략 가능)
- per-project 권한 (조직 레벨 권한만) — 필요시 후속
