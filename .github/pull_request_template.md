## 설명

<!-- 변경 사항과 그 이유를 간략히 설명해 주세요 -->

## 체크리스트

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
