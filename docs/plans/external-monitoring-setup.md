# External Monitoring Setup — Better Stack (or equivalent)

> 작성: 2026-07-19 · 근거: `.github/workflows/cron-server.yml` 헤더 진단 + `docs/STATE-OF-REPO.md` §4
> 배경: Vercel 스케줄러가 `*/5` cron을 ~96% 무음 드랍 (2026-06-15 실측, `cron_job_runs` 24h 기준 10/288 = 3.5% 발화).
> GH Actions 안전망도 short-cadence에서 스로틀됨. **둘 다 무음 실패** — 외부 pinger가 최종 방어선.
> `spanlens-remaining-work.md` "사용자 액션: Better Stack 모니터"의 실행 문서.

## 진행 상태 (2026-07-19 갱신)

- ✅ Better Stack 가입 + 연결 완료. 공개 status 페이지: https://status.spanlens.io/
- ✅ HTTP uptime 모니터 3개 라이브: Proxy Liveness (99.985%) · Proxy Deep (98.451%) · Website (100%) — 아래 §A 커버됨
- ✅ **heartbeat 코드 구현 완료** — `lib/cron-heartbeat.ts` + `logCronRun` 성공 경로에서 자동 발신.
  모든 cron이 `logCronRun`을 통과하므로 핸들러 수정 0개. env `HEARTBEAT_<JOB>` 미설정이면 no-op.
- ⬜ **남은 유저 작업 딱 하나**: Better Stack에서 heartbeat 모니터 4개 생성 → 발급 URL 4개를 Vercel env에 붙여넣기 (§B 표)
- ⚠️ 참고: Proxy Deep 98.451% = 6월~7월 초 반복 다운 이력. `/health/deep`은 PG+CH+Upstash 의존성 뷰라 — 다운 로그를 한번 훑어볼 가치 있음.

## 사람이 해야 하는 것

1. Better Stack → Heartbeats → 아래 §B 표의 4개 생성 (기대 주기 + grace 그대로)
2. 발급된 heartbeat URL 4개를 Vercel 서버 환경변수로 추가:
   - `HEARTBEAT_REPLAY_FALLBACK`
   - `HEARTBEAT_SELF_MONITOR`
   - `HEARTBEAT_EXECUTE_PENDING_DELETIONS`
   - `HEARTBEAT_EVALUATE_ALERTS`
3. 재배포 → 다음 발화부터 heartbeat 도착 시작
4. 알림 채널: 이메일 + (가능하면) Slack webhook 연결

## 모니터 구성표

### A. Uptime 모니터 (HTTP check — 응답 코드 감시)

| # | URL | 주기 | 기대 | 실패 정책 | 왜 |
|---|---|---|---|---|---|
| 1 | `https://api.spanlens.io/health` | 1분 | 200 | 2회 연속 실패 시 알림 | liveness. 프로세스 죽음 감지 |
| 2 | `https://api.spanlens.io/health/ready` | 3분 | 200 | 2회 연속 실패 시 알림 | readiness. **Postgres + ClickHouse + Upstash 각각 ping** — 의존성 장애를 API 죽기 전에 감지 |
| 3 | `https://www.spanlens.io` | 3분 | 200 | 3회 연속 실패 시 알림 | 마케팅/대시보드 프론트 |

### B. Heartbeat 모니터 (cron이 "나 살아있음" 신호를 보내는 방식 — 역방향)

> Better Stack heartbeat는 "N분 안에 신호가 안 오면 알림". cron 드랍 감지에는 이 방식이 정답 —
> HTTP check는 endpoint가 살아있는지만 보고, **스케줄러가 실제로 발화했는지**는 heartbeat만 잡음.

| # | 대상 cron | 기대 주기 | grace | 왜 (cron-server.yml 헤더의 우선순위 그대로) |
|---|---|---|---|---|
| 4 | `/cron/replay-fallback` | 5분 | 15분 | **최고 레버리지.** CH 장애 시 fallback 큐 드레인. 무음 = 7일 TTL 지나면 영구 데이터 손실 |
| 5 | `/cron/self-monitor` | 1시간 | 2시간 | 메타 모니터링. 이게 죽으면 "cron 죽음을 감지하는 놈"이 죽은 것 |
| 6 | `/cron/execute-pending-deletions` | 6시간 | 12시간 | GDPR 삭제 처리. 무음 = 컴플라이언스 위반 |
| 7 | `/cron/evaluate-alerts` | 15분 | 45분 | 고객 대면 알림 파이프라인 |

**연동 방법 — 구현 완료 (2026-07-19)**: `apps/server/src/lib/cron-heartbeat.ts`의
`pingHeartbeat(jobName)`이 `lib/cron-logger.ts` `logCronRun` 성공 경로에서 자동 호출됨.
모든 cron이 logCronRun을 통과하므로 **핸들러 개별 수정 불필요** — 단일 초크포인트.
env 키 규칙: job 이름 `-`→`_` 대문자화 + `HEARTBEAT_` prefix (예: `replay-fallback` → `HEARTBEAT_REPLAY_FALLBACK`).
미설정 시 no-op. fetch 5초 타임아웃 + never-throw — pinger 장애가 cron을 못 건드림.
테스트: `src/__tests__/cron-heartbeat.test.ts` 4건.

4개 외 cron에도 확장하려면 코드 변경 없이 Better Stack에서 heartbeat 추가 + 대응 env만 세팅.

### C. 계정 없이도 되는 대안 (급하면)

cron-job.org (무료, heartbeat 없음 — HTTP 재발화 방식): `/cron/replay-fallback`을 5분마다
`Authorization: Bearer $CRON_SECRET` 헤더로 직접 호출. GH Actions와 같은 역할의 3번째 스케줄러.
heartbeat 방식보다 열등 (발화 확인이 아니라 또 하나의 발화 시도)이지만 즉시 적용 가능.

## 완료 기준

- [ ] 모니터 7개 생성, 알림 채널 연결
- [ ] heartbeat 4개가 실제 cron 발화와 연동 (핸들러에 ping 추가 + env 4개)
- [ ] 테스트: `/cron/self-monitor`를 일부러 2시간 막고 알림 오는지 확인
- [ ] `spanlens-remaining-work.md` "Better Stack 모니터" 항목 ✅ 처리
