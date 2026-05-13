# Spanlens 사이드바 확장 로드맵 — Evals · Datasets · Experiments · Annotation

**작성일**: 2026-05-13
**상태**: 확정 (Phase 1 착수 예정)
**관련 영역**: `apps/web/app/(dashboard)/`, `apps/server/src/api/`, `supabase/migrations/`

---

## 1. 최종 사이드바 구조

```
📁 [상단 그룹]
  ├── Dashboard            ✅ 기존
  ├── Requests             🔧 user/session 필터 추가
  └── Traces               ✅ 기존

📁 OBSERVE
  ├── Anomalies            ✅ 기존
  ├── Security             ✅ 기존
  └── Savings              ✅ 기존

📁 BUILD                   (이름 변경 검토 — "IMPROVE" 후보)
  ├── Prompts              ✅ 기존 (Playground 서브탭 포함)
  ├── Evals                🆕 신규
  ├── Datasets             🆕 신규
  ├── Experiments          🆕 신규
  └── Alerts               ✅ 기존

📁 REVIEW                  🆕 신규 섹션
  └── Annotation           🆕 신규
```

### 변경점 요약
- BUILD 섹션에 3개 탭 추가 (Evals / Datasets / Experiments)
- REVIEW 섹션 신규 + Annotation 1개 탭
- **Playground 독립 탭 추가 안 함** — 이미 `Prompts → [name] → Playground` 서브탭으로 구현됨, 분리 가치 없음
- Requests 탭은 신규 탭 아님 — 기존 탭에 user/session 필터만 추가

---

## 2. 사전 확인 사항 (완료)

### 2-1. response_body 저장 여부 ✅

```sql
-- 지난 30일 데이터
total                93
has_response_body    67  (72%)
non_empty_response   67  (72%)
```

→ Evals MVP가 production 데이터로 동작 가능함이 확인됨.
28%가 비어있는 이유는 스트리밍 파서 실패·옛 데이터·에러 응답 등 추정. 신규 데이터는 정상 저장 중.

### 2-2. Playground 기능 확인 ✅

- 위치: `apps/web/app/(dashboard)/prompts/[name]/tabs/playground-tab.tsx`
- 서버: `POST /api/v1/prompts/playground/run` (rate limit 20/min/user)
- 기능: 버전·provider key·model·temperature·max_tokens·variables 설정 → 즉시 실행 → 응답·비용·토큰·레이턴시 표시
- **`requests` 테이블에 저장 안 됨** (production 로깅 대상 아님)

---

## 3. 각 탭의 책임 및 기능 정의

### 3-1. Evals (가장 시급)

**목적**: LLM 응답의 *품질*을 수치화. 비용/레이턴시(이미 측정 중)에 더해 "잘 답했나"를 답한다.

**MVP 범위**:
- Evaluator 타입: **LLM-as-judge 1개만** (다른 LLM이 응답을 0–1점으로 채점)
- 샘플 소스: **production data** (`requests` 테이블의 response_body, prompt_version_id 기준)
- 결과: 점수 분포 히스토그램 + 낮은 점수 응답 드릴다운

**제외 (Phase 2+)**:
- Heuristic evaluator (regex / JSON schema / length)
- Multi-evaluator 동시 실행
- Dataset 기반 평가 (Datasets 탭 안착 후)

**워크플로우**:
```
Evals 탭 진입
→ "+ New evaluator"
  - Prompt: [support_reply ▼]
  - Name: "친절도 평가"
  - Criterion: "응답이 친절하고 명확한가?"
  - Judge model: gpt-4o-mini
→ Run on:
  - Version: [v2 ▼]
  - Sample: Last 7 days, random 50
→ [Run] (예상 비용 $0.02, 30s)
→ 결과: 평균 0.78, 분포 차트, 낮은 점수 5개 클릭 → request 상세
```

**Calls 탭 통합**: Evals 실행 결과가 `prompt_versions`에 묶이므로, 기존 Calls 탭의 비어있던 "QUALITY" 컬럼이 자동으로 의미를 가짐.

---

### 3-2. Datasets

**목적**: 반복 평가를 위한 *입력 세트* 관리. production data가 부족하거나 민감할 때 사용.

**MVP 범위**:
- Dataset 생성: 이름, 설명
- Item 추가: (input, expected_output?) 쌍
  - input: prompt에 들어갈 변수값 또는 메시지
  - expected_output: 정답 (선택, accuracy 평가 시 필요)
- Item 가져오기:
  - 수동 입력 (form)
  - Production request에서 import ("이 호출을 dataset에 추가")
  - CSV 업로드 (Phase 2.5)

**Evals와의 연결**:
- Evals 실행 시 샘플 소스를 "production" 대신 "dataset" 선택 가능
- → "v2를 내가 정의한 50개 케이스에 대해 평가"

**워크플로우**:
```
Datasets 탭 진입
→ "+ New dataset"
  - Name: "Customer support golden set"
  - Description: "실패했던 30개 케이스 + 정상 20개"
→ Items 추가:
  - "[Import from requests]" → Requests 탭 다중 선택
  - 또는 "[Add item]" → input·expected output 직접 입력
→ Evals 탭에서 이 dataset 선택 가능해짐
```

---

### 3-3. Experiments

**목적**: 여러 prompt version을 *동일 입력*으로 실행해서 결과를 side-by-side 비교.

**A/B와의 차이점 (중요)**:

| | A/B (Prompts 내) | Experiments (신규) |
|---|---|---|
| 데이터 | production 트래픽 | dataset 또는 production 샘플 |
| 시점 | 실시간, 실제 사용자 노출 | 오프라인, 사용자 노출 없음 |
| 비교 단위 | 통계적 유의성 (welch test) | 출력 텍스트 직접 비교 + 점수 |
| 위험 | 나쁜 버전이 사용자에게 감 | 없음 |
| 순서 | 마지막 검증 | A/B 전에 사전 검증 |

**MVP 범위**:
- 비교 가능 버전: 2개 (v_a vs v_b)
- 입력 소스: dataset 또는 production sample
- 결과 뷰:
  - Side-by-side 텍스트 비교 (한 줄에 input | v_a output | v_b output)
  - 평균 점수 비교 (Evals evaluator 적용 시)
  - 비용·레이턴시 비교
- Diff 하이라이트 (v_a output vs v_b output에서 달라진 단어)

**Phase 2 확장**:
- 3개 이상 버전 동시 비교
- Cross-prompt 비교 (다른 prompt 간 비교 — 드물지만 가능)

---

### 3-4. Annotation (REVIEW 섹션)

**목적**: 사람이 직접 응답을 채점. LLM judge가 못 잡는 미묘한 품질 이슈 포착.

**MVP 범위**:
- Review queue: 채점 대기 응답 목록
  - 필터: 프롬프트, 버전, 기간, "낮은 LLM judge 점수만"
- 채점 UI:
  - 응답 본문 표시
  - 별점 1–5 또는 thumbs up/down
  - 자유 입력 코멘트
  - 단축키 (j/k 다음/이전, 1–5 점수)
- 결과 저장: `human_evals` 테이블에 prompt_version_id, request_id, score, comment, reviewer_id

**Evals와의 연결**:
- LLM judge 점수와 human 점수 *간의 상관관계* 표시 → "내 LLM judge가 사람 평가와 얼마나 일치하는가" 검증
- 불일치 케이스 강조

**MVP 제외**:
- 다중 reviewer 평균 / 일치도 계산
- Reviewer 권한 관리 (다 admin 가정)
- Annotation 결과를 Evals fine-tuning에 활용

---

### 3-5. Requests user/session 필터

**현재**: provider, model, status, providerKey, prompt_version (방금 추가) 필터만 지원
**추가 필터**:
- `user_id`: 어떤 최종 사용자의 호출인가
- `session_id`: 어떤 세션 흐름의 호출인가

**전제 조건**:
- `requests` 테이블에 `user_id`, `session_id` 컬럼이 있어야 함 → 확인 필요
- SDK / 헤더로 user_id를 전달하는 메커니즘 필요 (`x-spanlens-user`, `x-spanlens-session`)

**Dashboard 위젯**: "Top users by cost", "Top sessions by request count" 추가

---

### 3-6. BUILD → IMPROVE 섹션명 변경

**결정 필요**. 현재 입장:
- BUILD: 직관적, 익숙 (Langfuse도 BUILD 사용)
- IMPROVE: Evals/Annotation이 "개선" 의미에 더 가까움. Prompts 만들기보다는 *기존을 더 좋게 만드는* 도구들.

→ **권장: 일단 BUILD 유지**, Phase 1·2 끝난 후 사용자 인터뷰에서 다시 검토.

---

## 4. DB 스키마

### 4-1. Evals

```sql
-- 평가 기준 정의 (재사용 가능)
CREATE TABLE evaluators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prompt_name text NOT NULL,
  name text NOT NULL,                  -- "친절도 평가"
  type text NOT NULL DEFAULT 'llm_judge',
  config jsonb NOT NULL,               -- {judge_model, criterion, scale, ...}
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX evaluators_org_prompt_idx ON evaluators(organization_id, prompt_name);
ALTER TABLE evaluators ENABLE ROW LEVEL SECURITY;

-- 평가 실행 (한 번의 Run = 여러 eval_results)
CREATE TABLE eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
  prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id),
  source text NOT NULL,                -- 'production' | 'dataset'
  dataset_id uuid REFERENCES datasets(id),
  sample_size int NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  avg_score numeric,
  total_cost_usd numeric DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error text
);
ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;

-- 개별 응답 채점 결과
CREATE TABLE eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_run_id uuid NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  request_id uuid REFERENCES requests(id),       -- production 소스인 경우
  dataset_item_id uuid REFERENCES dataset_items(id),  -- dataset 소스인 경우
  score numeric NOT NULL,
  reasoning text,
  judge_cost_usd numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;
```

### 4-2. Datasets

```sql
CREATE TABLE datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, name)
);
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;

CREATE TABLE dataset_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  input jsonb NOT NULL,                -- {variables: {...}, messages: [...]}
  expected_output text,                 -- nullable
  source_request_id uuid REFERENCES requests(id),  -- import에서 왔으면 추적
  created_at timestamptz DEFAULT now()
);
CREATE INDEX dataset_items_dataset_idx ON dataset_items(dataset_id);
ALTER TABLE dataset_items ENABLE ROW LEVEL SECURITY;
```

### 4-3. Experiments

```sql
CREATE TABLE experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt_name text NOT NULL,
  version_a_id uuid NOT NULL REFERENCES prompt_versions(id),
  version_b_id uuid NOT NULL REFERENCES prompt_versions(id),
  source text NOT NULL,                -- 'production' | 'dataset'
  dataset_id uuid REFERENCES datasets(id),
  evaluator_id uuid REFERENCES evaluators(id),  -- 선택, 점수 비교 시
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  CHECK (version_a_id != version_b_id)
);
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

CREATE TABLE experiment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  arm text NOT NULL,                   -- 'a' | 'b'
  input jsonb NOT NULL,
  output text NOT NULL,
  cost_usd numeric,
  latency_ms int,
  score numeric,                       -- evaluator 적용 시
  created_at timestamptz DEFAULT now()
);
ALTER TABLE experiment_results ENABLE ROW LEVEL SECURITY;
```

### 4-4. Annotation

```sql
CREATE TABLE human_evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id uuid REFERENCES requests(id),
  experiment_result_id uuid REFERENCES experiment_results(id),
  prompt_version_id uuid REFERENCES prompt_versions(id),
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  score numeric NOT NULL,              -- 1–5 또는 0/1
  comment text,
  created_at timestamptz DEFAULT now(),
  CHECK (
    (request_id IS NOT NULL)::int +
    (experiment_result_id IS NOT NULL)::int >= 1
  )
);
ALTER TABLE human_evals ENABLE ROW LEVEL SECURITY;
```

### 4-5. Requests (user/session 필터용)

```sql
ALTER TABLE requests ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS session_id text;
CREATE INDEX IF NOT EXISTS requests_user_idx ON requests(organization_id, user_id);
CREATE INDEX IF NOT EXISTS requests_session_idx ON requests(organization_id, session_id);
```

→ 헤더 `x-spanlens-user`, `x-spanlens-session` 처리도 proxy 미들웨어에 추가 필요.

---

## 5. 구현 의존성 그래프

```
                   [Evals MVP]
                    │     │
              ┌─────┘     └─────┐
              ▼                 ▼
         [Datasets]      [Annotation]
              │
              ▼
         [Experiments]


[Requests user/session 필터]  ← 독립 (병렬 진행 가능)
```

**Evals가 모든 것의 출발점**. 평가 인프라가 없으면 Datasets는 단순 저장소, Experiments는 텍스트 비교만 가능, Annotation은 LLM 점수와 비교할 게 없음.

---

## 6. 구현 순서 (Phase별)

### Phase 1 (지금 — 2주 예상)
**목표**: Evals 사이드바 탭 신규 + production data 기반 LLM-judge MVP

- [ ] DB 마이그레이션: `evaluators`, `eval_runs`, `eval_results` 테이블
- [ ] 서버 API: `apps/server/src/api/evals.ts`
  - `POST /api/v1/evaluators`
  - `GET /api/v1/evaluators?promptName=...`
  - `POST /api/v1/eval-runs` (실행 트리거)
  - `GET /api/v1/eval-runs/:id` (결과 폴링)
- [ ] LLM judge worker: `apps/server/src/lib/eval-runner.ts`
  - `requests` SELECT → judge 호출 (사용자 provider key) → 점수 저장
  - 배치 N개씩 (cost·rate limit 고려)
- [ ] 사이드바 추가: BUILD 섹션에 Evals 항목
- [ ] 페이지: `apps/web/app/(dashboard)/evals/`
  - List view (evaluator 목록)
  - Detail view (실행 결과, 점수 분포, 드릴다운)
- [ ] Calls 탭의 QUALITY 컬럼이 `eval_results` 평균 표시하도록 연결

### Phase 2 (Phase 1 안착 후 — 2주)
**목표**: Datasets 탭 + Evals/Experiments에서 dataset 입력 지원

- [ ] DB: `datasets`, `dataset_items` 테이블
- [ ] 서버 API: `apps/server/src/api/datasets.ts`
- [ ] 사이드바 추가: BUILD 섹션에 Datasets 항목
- [ ] 페이지: `apps/web/app/(dashboard)/datasets/`
- [ ] Import from requests 통합 (Requests 탭에서 "Add to dataset" 액션)
- [ ] Evals UI에서 sample source 옵션에 dataset 추가

### Phase 3 (Phase 2 안착 후 — 2주)
**목표**: Experiments 탭 + side-by-side 비교

- [ ] DB: `experiments`, `experiment_results`
- [ ] 서버 API: `apps/server/src/api/experiments.ts`
- [ ] Experiment runner: 양쪽 버전을 dataset에 대해 실행
- [ ] 사이드바 추가: BUILD 섹션에 Experiments
- [ ] 페이지: `apps/web/app/(dashboard)/experiments/`
  - Side-by-side 텍스트 diff
  - 점수 비교 차트
  - Evaluator 연결 (선택)

### Phase 4 (Phase 3 안착 후 — 2주)
**목표**: Annotation 탭 + LLM-vs-human 일치도

- [ ] DB: `human_evals`
- [ ] 서버 API: `apps/server/src/api/human-evals.ts`
- [ ] 사이드바: REVIEW 섹션 + Annotation 항목
- [ ] 페이지: `apps/web/app/(dashboard)/annotation/`
  - Queue UI (필터, 단축키 j/k/1-5)
  - 채점 결과 → Evals 페이지에 "LLM-judge vs Human" 상관도 표시

### Phase 5 (병렬 가능 — 언제든)
**Requests user/session 필터**

- [ ] DB 마이그레이션: `user_id`, `session_id` 컬럼
- [ ] Proxy 미들웨어: `x-spanlens-user`, `x-spanlens-session` 헤더 → 컬럼 저장
- [ ] SDK: 헤더 자동 주입 헬퍼 (`withUser(userId)`, `withSession(sessionId)`)
- [ ] Requests UI: 필터 드롭다운 + URL param 지원
- [ ] Dashboard: "Top users by cost" 위젯

---

## 7. 핵심 비목표 (만들지 않을 것)

- **Playground 독립 탭** — `Prompts → [name] → Playground` 서브탭으로 충분
- **별도 Costs 탭** — Dashboard + Savings로 커버 (Helicone과 차별)
- **다중 evaluator 동시 실행 (MVP)** — Phase 2 이후
- **Annotation 다중 reviewer 일치도 (MVP)** — Phase 4 이후 별도 검토
- **Cross-organization eval 공유** — 권한·법적 복잡도 큼, 영구 보류

---

## 8. 위험 요소

1. **LLM judge 비용 폭주** — 50건 × $0.0005 = $0.025지만, 사용자가 1000건 × 매일이면 $0.50/일. 안전장치 필요:
   - 평가당 max sample size 제한 (예: 1000)
   - Org당 일일 judge 호출 한도 설정
2. **response_body 없는 28% 처리** — null인 row는 자동 스킵, 사용자에게 "47/50 채점됨" 표시
3. **Evals 결과의 신뢰도** — LLM judge 자체가 부정확할 수 있음. Phase 4 Annotation으로 검증.
4. **prompt_versions 간 비교 시 다른 변수** — 같은 version에 다른 변수값이 들어간 호출들의 점수를 평균낼지, 그룹핑할지 결정 필요. MVP는 그냥 평균.

---

## 9. 다음 즉시 액션

1. 이 문서 검토·승인
2. BUILD → IMPROVE 결정 (안 바꿔도 됨, 한 줄 결정)
3. Phase 1 착수:
   - DB 마이그레이션 작성: `supabase/migrations/{YYYYMMDDHHMMSS}_evals.sql`
   - 서버 API 스켈레톤
   - UI 라우트 추가

---

## 10. 변경 이력

| 날짜 | 변경 | 사유 |
|---|---|---|
| 2026-05-13 | 초안 작성 | 사용자 검증 우선 원칙으로 로드맵 재정렬 |
| 2026-05-13 | **재작성** | 사용자 결정: 검증 스킵, 전 기능 사이드바 독립 탭으로 구현 (Playground 제외). Phase 별 의존성 그래프 추가. |
