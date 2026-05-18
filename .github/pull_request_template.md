## 설명

<!-- 변경 사항과 그 이유를 간략히 설명해 주세요 -->

## 체크리스트

### 코드 안전성
- [ ] ClickHouse 쿼리: `getClickhouse()` 직접 호출 없음 (`src/lib/` 내부 파일 제외)
- [ ] 새 ClickHouse 쿼리: `organization_id` 필터 포함 확인
- [ ] 새 Supabase 테이블: `ALTER TABLE t ENABLE ROW LEVEL SECURITY` 포함
- [ ] 새 `/proxy/*` 엔드포인트: `authApiKey` 미들웨어 사용
- [ ] 새 `/api/*` 엔드포인트: `authJwt` 미들웨어 사용
- [ ] 새 ClickHouse INSERT: `toClickhouseTimestamp()` 사용 (`.toISOString()` 직접 사용 금지)
- [ ] 새 `lib/crypto.ts` 호출: `await` 빠뜨리지 않음 확인
- [ ] Vercel Edge fire-and-forget: `fireAndForget()` 사용 (`.catch(console.error)` 패턴 금지)
- [ ] 새 환경변수: `.env.example` 업데이트
- [ ] 타입 검사 및 린트 통과: `pnpm typecheck && pnpm lint`

### 보안 (해당 시)
- [ ] 비밀값 노출 없음 — 로그·에러 메시지·테스트 fixture에 실 API 키/토큰/비밀번호 미포함
- [ ] Provider Key 처리: 평문은 `Authorization` 헤더로만 즉시 사용, 변수/로그 저장 금지
- [ ] 사용자 입력 검증: API 경계에서 schema 검증(`zod` 등) 또는 명시적 타입 가드
- [ ] 인증 우회 가능성 검토: 새 경로가 `authApiKey` / `authJwt` 어느 쪽에도 안 걸리는 경우는 의도된 공개 엔드포인트인지 확인
- [ ] SQL/NoSQL injection: ClickHouse `query_params` / Supabase 빌더 사용, 문자열 concat으로 식별자 주입 금지
- [ ] 외부 fetch: URL이 사용자 입력에서 유도되면 호스트 allowlist (SSRF 방지)
- [ ] `console.log` 로 key/secret/token 직렬화 안 함
- [ ] 새 의존성: 라이선스(MIT/Apache/BSD) 확인 + 천만 다운로드 이상 또는 직접 audit
- [ ] CodeQL / Dependabot 알림 0건 (또는 명시적으로 dismissed 사유 기록)
