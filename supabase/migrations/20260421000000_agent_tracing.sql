-- Migration: agent_tracing
-- Tables: traces, spans
--
-- 에이전트 실행 트레이싱용. trace = 하나의 논리적 사용자 인터랙션
-- (예: "질문 → 에이전트 실행 → 응답"), spans = 그 안의 개별 단계
-- (LLM 호출 1회, 툴 호출 1회, retrieval 1회 등).
--
-- CLAUDE.md Known Gotcha #4에 따라 spans.parent_span_id는 FK 제약 없음
-- (의도적) — LangGraph 스타일 병렬 fan-out에서 span이 순서 없이 도착해도
-- INSERT가 실패하지 않아야 함.

-- ────────────────────────────────────────────────────────────
-- 9. traces
-- ────────────────────────────────────────────────────────────
CREATE TABLE traces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,

  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'error')),

  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  duration_ms    INT,

  metadata        JSONB,
  error_message   TEXT,

  -- Aggregate counters refreshed by a DB trigger when spans update
  span_count         INT NOT NULL DEFAULT 0,
  total_tokens       INT NOT NULL DEFAULT 0,
  total_cost_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX traces_project_created_idx
  ON traces (project_id, created_at DESC);
CREATE INDEX traces_org_started_idx
  ON traces (organization_id, started_at DESC);

ALTER TABLE traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "traces_select" ON traces
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "traces_insert" ON traces
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "traces_update" ON traces
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "traces_delete" ON traces
  FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER traces_updated_at
  BEFORE UPDATE ON traces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 10. spans
-- ────────────────────────────────────────────────────────────
-- parent_span_id에 FK 제약을 걸지 않음 — 병렬 fan-out 지원 (의도적).
-- organization_id는 denormalized — RLS 정책이 traces를 역참조하지 않도록.
CREATE TABLE spans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  parent_span_id  UUID,  -- NO FK (by design, Known Gotcha #4)
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  span_type       TEXT NOT NULL DEFAULT 'custom'
                    CHECK (span_type IN ('llm', 'tool', 'retrieval', 'embedding', 'custom')),
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'error')),

  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  duration_ms     INT,

  input           JSONB,
  output          JSONB,
  metadata        JSONB,
  error_message   TEXT,

  -- Optional link to a proxy request row — populated when span_type = 'llm'
  -- and the span was recorded via the Spanlens proxy (auto-instrumentation).
  request_id      UUID REFERENCES requests(id) ON DELETE SET NULL,

  -- Denormalized for quick span-level aggregation without joining requests
  prompt_tokens      INT NOT NULL DEFAULT 0,
  completion_tokens  INT NOT NULL DEFAULT 0,
  total_tokens       INT NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(12, 6),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spans_trace_started_idx
  ON spans (trace_id, started_at);
CREATE INDEX spans_parent_idx
  ON spans (parent_span_id);
CREATE INDEX spans_request_idx
  ON spans (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE spans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spans_select" ON spans
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "spans_insert" ON spans
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "spans_update" ON spans
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "spans_delete" ON spans
  FOR DELETE USING (is_org_member(organization_id));

-- ────────────────────────────────────────────────────────────
-- 11. refresh_trace_aggregates trigger
-- ────────────────────────────────────────────────────────────
-- spans가 INSERT/UPDATE/DELETE 될 때마다 부모 trace의 집계 컬럼
-- (span_count, total_tokens, total_cost_usd, duration_ms)을 갱신.
-- 대시보드가 traces 한 번만 SELECT하면 되도록 — spans를 매번 집계하지 않게.
CREATE OR REPLACE FUNCTION refresh_trace_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_trace_id UUID;
BEGIN
  target_trace_id := COALESCE(NEW.trace_id, OLD.trace_id);

  UPDATE traces t
  SET
    span_count       = (SELECT COUNT(*) FROM spans WHERE trace_id = target_trace_id),
    total_tokens     = (SELECT COALESCE(SUM(total_tokens), 0) FROM spans WHERE trace_id = target_trace_id),
    total_cost_usd   = (SELECT COALESCE(SUM(cost_usd), 0) FROM spans WHERE trace_id = target_trace_id),
    updated_at       = now()
  WHERE t.id = target_trace_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER spans_refresh_trace_aggregates
  AFTER INSERT OR UPDATE OR DELETE ON spans
  FOR EACH ROW EXECUTE FUNCTION refresh_trace_aggregates();
