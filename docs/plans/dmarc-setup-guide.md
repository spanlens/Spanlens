# DMARC 설정 가이드 — spanlens.io

> **목적:** 메일 수신처 (Gmail, Outlook 등)가 spanlens.io 발송 메일을 스팸/사기로 거부하지 않도록 DMARC 정책 명시.
> **상태:** P1.6 잔여 항목 — 사용자가 직접 가비아 DNS에서 작업 필요.
> **소요시간:** 가비아 DNS 입력 ~5분 + 전파 대기 (보통 1시간 이내, 최대 48시간).

## 현재 상태

CLAUDE.md gotcha #17 메모:
> "spanlens.io 자체는 이미 Verified (2026-04-25). DMARC는 `_dmarc` TXT 레코드 별도 추가 필요 (가비아 DNS)."

- ✅ SPF + DKIM은 Resend 도메인 인증 시 자동 추가됨 (2026-04-25)
- ❌ DMARC 레코드 미설정 → 일부 수신처가 spanlens.io 메일을 "신원 미확인"으로 처리할 수 있음

## 권장 진행 — 3단계 phased rollout

신규 도메인에 처음부터 `p=reject` (강한 정책) 적용하면 정상 메일도 차단될 위험. **2주씩 단계적으로 조이는 게 표준**.

### Step 1 (즉시) — `p=none`: 모니터링 전용

가비아 DNS 관리 → spanlens.io → DNS 레코드 추가:

| 필드 | 값 |
|------|---|
| **타입** | TXT |
| **호스트명** | `_dmarc` |
| **값(TXT)** | `v=DMARC1; p=none; rua=mailto:support@spanlens.io; ruf=mailto:support@spanlens.io; fo=1; aspf=s; adkim=s` |
| **TTL** | `3600` (1시간) 또는 기본값 |

**저장 후 검증:**
```bash
# 셸에서 (Windows PowerShell도 동일)
dig +short TXT _dmarc.spanlens.io
# 또는
nslookup -type=TXT _dmarc.spanlens.io
```
출력에 위 TXT 값이 그대로 보이면 전파 완료.

**온라인 검증 도구:** [https://dmarcian.com/dmarc-inspector/](https://dmarcian.com/dmarc-inspector/)에서 `spanlens.io` 입력 → "DMARC record found, valid syntax" 떠야 정상.

### Step 2 (2주 후) — `p=quarantine`: 의심 메일을 스팸함으로

위 record 값에서 `p=none` → `p=quarantine`만 바꿔서 저장.

```
v=DMARC1; p=quarantine; rua=mailto:support@spanlens.io; ruf=mailto:support@spanlens.io; fo=1; aspf=s; adkim=s
```

효과: SPF/DKIM 정렬 실패 메일이 받는 사람의 스팸함으로 자동 분류. 차단은 아님.

### Step 3 (Step 2 후 2주 + aggregate report에 정상 메일 fail 0건 확인 후) — `p=reject`: 강제 차단

```
v=DMARC1; p=reject; rua=mailto:support@spanlens.io; ruf=mailto:support@spanlens.io; fo=1; aspf=s; adkim=s
```

효과: 정렬 실패 메일을 수신처가 아예 거부 (bounce 처리). 위장 도메인 공격 차단력 최대.

## 각 파라미터 의미

| 파라미터 | 값 | 의미 |
|---------|---|------|
| `v=DMARC1` | 고정 | DMARC 버전 (필수, 가장 먼저) |
| `p=` | `none` / `quarantine` / `reject` | **정책** — 단계적으로 강화 |
| `rua=mailto:...` | `support@spanlens.io` | **Aggregate reports** — 일일 XML 보고서. 보내는 양·정렬 비율 통계 |
| `ruf=mailto:...` | `support@spanlens.io` | **Forensic reports** — 실패한 개별 메일 상세 (덜 많은 ISP가 보냄) |
| `fo=1` | 고정 | SPF 또는 DKIM이 fail이면 forensic report 생성 (`0`은 둘 다 fail일 때만) |
| `aspf=s` | strict | SPF 정렬을 strict 모드로 (`r`은 relaxed) |
| `adkim=s` | strict | DKIM 정렬을 strict 모드로 |

**strict alignment 추천 이유:** Spanlens는 `notifications@mail.spanlens.io` 같은 서브도메인 발송이 아니라 root domain (`notifications@spanlens.io` 또는 동일 root에서 발송) 사용 예정 → strict가 더 안전.

## Aggregate report 해석

`rua=` 주소 (`support@spanlens.io`)로 매일 또는 매주 XML 보고서가 옵니다. 양식 예시:

```xml
<record>
  <row>
    <source_ip>149.72....</source_ip>     <!-- Resend의 발송 서버 IP -->
    <count>15</count>                       <!-- 이 IP에서 보낸 메일 수 -->
    <policy_evaluated>
      <disposition>none</disposition>       <!-- 적용된 정책 -->
      <dkim>pass</dkim>                     <!-- DKIM 검증 결과 -->
      <spf>pass</spf>                       <!-- SPF 검증 결과 -->
    </policy_evaluated>
  </row>
  ...
</record>
```

**해석 포인트:**
- `dkim=pass` + `spf=pass`인 row의 비율이 95%+ → 안전하게 `p=quarantine`으로 올려도 됨
- `pass` 비율이 낮으면 → SPF / DKIM 설정 점검 필요 (Resend Dashboard → Domains → spanlens.io 상태 확인)

XML 직접 읽기 부담스러우면 [postmarkapp.com/dmarc](https://dmarc.postmarkapp.com/) 또는 [dmarcian.com](https://dmarcian.com)에서 `rua=` 주소를 그쪽 무료 mailbox로 변경 → 웹 대시보드로 자동 파싱.

## 트러블슈팅

### 1. dmarcian inspector가 "Multiple DMARC records found" 에러

`_dmarc.spanlens.io`에 여러 TXT 레코드가 존재. RFC상 DMARC는 1개만 허용. 가비아 DNS에서 중복 레코드 삭제 → 단일 record로 통합.

### 2. Aggregate report가 1주일 지나도 안 옴

- `rua=` 주소가 spanlens.io 도메인이면 메일 발송과 같은 DKIM 정렬 필요 → 일부 ISP가 발송 거부. 임시로 외부 메일 주소 (Gmail 등) 사용 가능: `rua=mailto:haeseong050321@gmail.com`
- 또는 `mailto:` 외에 `https://` (HTTP POST) 지원하는 ISP는 거의 없음 — mailto만 사용

### 3. Resend가 보낸 메일이 받는 사람 spam함으로 감

- DMARC 자체 문제 아닐 수도 — Resend Dashboard에서 `notifications@spanlens.io` SPF/DKIM "Verified" 상태인지 먼저 확인
- DKIM record가 가비아에 정확히 들어있는지: `dig TXT resend._domainkey.spanlens.io` → Resend Dashboard 값과 일치해야 함

## 체크리스트

- [ ] **Step 1** — `_dmarc` TXT record (`p=none`) 추가 + dmarcian inspector "valid syntax" 확인
- [ ] 2주 동안 `rua=` 보고서 수신 + dkim/spf pass 비율 95%+ 확인
- [ ] **Step 2** — `p=quarantine`으로 변경
- [ ] 2주 동안 정상 메일 false-positive 0건 확인
- [ ] **Step 3** — `p=reject`로 변경
- [ ] dmarcian inspector "Excellent" 등급 확인
- [ ] CLAUDE.md gotcha #17 노트 업데이트 (DMARC 활성 완료 + 정책 표기)
- [ ] launch-readiness-master-plan.md P1.6 DMARC 체크박스 ✅

## 마스터 플랜 매핑

- P1.6 체크박스: "DMARC TXT 레코드 추가 + dmarcian 통과" — 위 Step 1 완료 시 충족 (단 phased rollout 완료 후 `p=reject`까지 가는 게 정석)

## 참고 링크

- [RFC 7489 — DMARC](https://datatracker.ietf.org/doc/html/rfc7489) — 공식 spec
- [Resend DMARC docs](https://resend.com/docs/send-with-domains/dmarc) — Resend 권장 설정
- [dmarcian.com inspector](https://dmarcian.com/dmarc-inspector/) — 무료 record 검증
- [postmarkapp DMARC monitoring](https://dmarc.postmarkapp.com/) — 무료 aggregate report 파싱
- [가비아 DNS 관리 매뉴얼](https://customer.gabia.com/manual/dns-domain) — TXT 레코드 추가 UI 가이드
