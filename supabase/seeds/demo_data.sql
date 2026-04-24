-- Demo/test data seed
-- Populates enough synthetic data to exercise every dashboard card + page.
-- Idempotent-ish: re-running just adds more rows (duplicates are harmless).
--
-- Run in Supabase SQL Editor (local or prod).
-- Cleanup: see bottom of file for reset script.

DO $$
DECLARE
  v_org_id   UUID;
  v_proj_id  UUID;
  v_key_id   UUID;
  v_prov_key_id UUID;
  v_user_id  UUID;
  v_prompt_v1 UUID;
  v_prompt_v2 UUID;
  v_trace_id UUID := gen_random_uuid();
  v_parent_span UUID := gen_random_uuid();
  v_child_span  UUID := gen_random_uuid();
  v_alert_id UUID;
  v_channel_id UUID;
  v_ingest_row_id UUID;
  i INTEGER;
BEGIN
  -- Pick the first org/project/key in the DB (whoever runs this)
  SELECT id INTO v_org_id FROM organizations ORDER BY created_at LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found. Sign up once first, then re-run this seed.';
  END IF;

  SELECT id INTO v_proj_id FROM projects WHERE organization_id = v_org_id ORDER BY created_at LIMIT 1;
  IF v_proj_id IS NULL THEN
    RAISE EXCEPTION 'No project in org %. Create a project first.', v_org_id;
  END IF;

  SELECT id INTO v_key_id FROM api_keys WHERE project_id = v_proj_id AND is_active = TRUE ORDER BY created_at LIMIT 1;
  IF v_key_id IS NULL THEN
    RAISE EXCEPTION 'No active API key. Create one on /projects first.';
  END IF;

  SELECT id INTO v_prov_key_id FROM provider_keys
    WHERE organization_id = v_org_id AND is_active = TRUE ORDER BY created_at LIMIT 1;
  SELECT owner_id INTO v_user_id FROM organizations WHERE id = v_org_id;

  -- ─────────────────────────────────────────────────────────────────────
  -- 1. Two prompt versions (for prompts page aggregates + tagged requests)
  -- ─────────────────────────────────────────────────────────────────────
  INSERT INTO prompt_versions (organization_id, project_id, name, version, content, variables, metadata, created_by)
  VALUES (v_org_id, v_proj_id, 'support_reply', 1,
          'You are a helpful support agent. Reply to: {{message}}', '[]', '{}', v_user_id)
  RETURNING id INTO v_prompt_v1;

  INSERT INTO prompt_versions (organization_id, project_id, name, version, content, variables, metadata, created_by)
  VALUES (v_org_id, v_proj_id, 'summarize_tickets', 1,
          'Summarize the following support tickets in 3 bullet points: {{tickets}}', '[]', '{}', v_user_id)
  RETURNING id INTO v_prompt_v2;

  -- ─────────────────────────────────────────────────────────────────────
  -- 2. Baseline requests (7 days of normal traffic — for anomaly baseline
  --    and Top prompts / Models in use / Spend cards)
  -- ─────────────────────────────────────────────────────────────────────
  FOR i IN 1..200 LOOP
    INSERT INTO requests (
      organization_id, project_id, api_key_id, provider_key_id, provider, model,
      prompt_tokens, completion_tokens, total_tokens, cost_usd,
      latency_ms, status_code, request_body, response_body,
      error_message, trace_id, span_id, flags, prompt_version_id,
      created_at
    ) VALUES (
      v_org_id, v_proj_id, v_key_id, v_prov_key_id,
      CASE WHEN i % 3 = 0 THEN 'anthropic' ELSE 'openai' END,
      CASE
        WHEN i % 3 = 0 THEN 'claude-sonnet-4-6'
        WHEN i % 4 = 0 THEN 'gpt-4o'
        ELSE 'gpt-4o-mini'
      END,
      800, 200, 1000,
      0.0015 + (random() * 0.002),
      (300 + (random() * 400))::int, -- normal: 300-700ms
      200, NULL, NULL, NULL, NULL, NULL, '[]'::jsonb,
      CASE WHEN i % 5 = 0 THEN v_prompt_v1 WHEN i % 5 = 1 THEN v_prompt_v2 ELSE NULL END,
      now() - (random() * interval '7 days')
    );
  END LOOP;

  -- ─────────────────────────────────────────────────────────────────────
  -- 3. Recent latency spike on openai/gpt-4o-mini (triggers anomaly card)
  -- ─────────────────────────────────────────────────────────────────────
  FOR i IN 1..50 LOOP
    INSERT INTO requests (
      organization_id, project_id, api_key_id, provider_key_id, provider, model,
      prompt_tokens, completion_tokens, total_tokens, cost_usd,
      latency_ms, status_code, flags, prompt_version_id,
      created_at
    ) VALUES (
      v_org_id, v_proj_id, v_key_id, v_prov_key_id,
      'openai', 'gpt-4o-mini',
      800, 200, 1000, 0.0015,
      (2500 + (random() * 1500))::int, -- spike: 2500-4000ms (way above baseline)
      CASE WHEN i % 10 = 0 THEN 500 ELSE 200 END,
      '[]'::jsonb,
      v_prompt_v1,
      now() - (random() * interval '55 minutes') -- within last hour
    );
  END LOOP;

  -- ─────────────────────────────────────────────────────────────────────
  -- 4. PII-flagged request (triggers CRITICAL PII card + Security page)
  -- ─────────────────────────────────────────────────────────────────────
  INSERT INTO requests (
    organization_id, project_id, api_key_id, provider_key_id, provider, model,
    prompt_tokens, completion_tokens, total_tokens, cost_usd,
    latency_ms, status_code, flags, created_at
  ) VALUES (
    v_org_id, v_proj_id, v_key_id, v_prov_key_id,
    'openai', 'gpt-4o-mini',
    120, 80, 200, 0.0001,
    420, 200,
    '[{"type":"pii","pattern":"email","sample":"te*****@e*****.com"},
      {"type":"pii","pattern":"phone","sample":"+82-10-***-1234"}]'::jsonb,
    now() - interval '15 minutes'
  ),
  (
    v_org_id, v_proj_id, v_key_id, v_prov_key_id,
    'openai', 'gpt-4o',
    90, 40, 130, 0.0008,
    550, 200,
    '[{"type":"injection","pattern":"ignore-previous","sample":"***ignore all previous instructions***"}]'::jsonb,
    now() - interval '3 hours'
  );

  -- ─────────────────────────────────────────────────────────────────────
  -- 5. Trace + spans (for /traces + RequestDrawer Trace tab preview)
  -- ─────────────────────────────────────────────────────────────────────
  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status,
                      started_at, ended_at, duration_ms, span_count, total_tokens, total_cost_usd)
  VALUES (v_trace_id, v_org_id, v_proj_id, v_key_id, 'support_triage_agent', 'completed',
          now() - interval '5 minutes', now() - interval '4 minutes 57 seconds',
          3120, 4, 1800, 0.0042);

  INSERT INTO spans (id, trace_id, organization_id, parent_span_id, name, span_type, status,
                     started_at, ended_at, duration_ms, total_tokens, cost_usd)
  VALUES
    (v_parent_span, v_trace_id, v_org_id, NULL, 'plan_reply', 'llm', 'completed',
     now() - interval '5 minutes', now() - interval '4 minutes 58 seconds', 2100, 1200, 0.003),
    (v_child_span, v_trace_id, v_org_id, v_parent_span, 'fetch_kb_articles', 'tool', 'completed',
     now() - interval '4 minutes 59 seconds', now() - interval '4 minutes 58.3 seconds', 700, 0, 0),
    (gen_random_uuid(), v_trace_id, v_org_id, v_parent_span, 'draft_response', 'llm', 'completed',
     now() - interval '4 minutes 58 seconds', now() - interval '4 minutes 57 seconds', 900, 600, 0.0012),
    (gen_random_uuid(), v_trace_id, v_org_id, v_parent_span, 'validate_tone', 'tool', 'completed',
     now() - interval '4 minutes 57 seconds', now() - interval '4 minutes 57 seconds', 120, 0, 0);

  -- Link one recent request to this trace (Trace tab preview shows something)
  UPDATE requests
    SET trace_id = v_trace_id, span_id = v_parent_span
    WHERE id = (
      SELECT id FROM requests
      WHERE organization_id = v_org_id
      ORDER BY created_at DESC LIMIT 1
    );

  -- ─────────────────────────────────────────────────────────────────────
  -- 6. Notification channel + alert that's "firing" (lit up recently)
  -- ─────────────────────────────────────────────────────────────────────
  -- Reuse existing email channel if present, otherwise create one
  SELECT id INTO v_channel_id FROM notification_channels
    WHERE organization_id = v_org_id AND kind = 'email' AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  IF v_channel_id IS NULL THEN
    INSERT INTO notification_channels (organization_id, kind, target, is_active)
    VALUES (v_org_id, 'email', 'demo@spanlens.local', TRUE)
    RETURNING id INTO v_channel_id;
  END IF;

  -- Alert rule that already fired within the last hour
  INSERT INTO alerts (
    organization_id, name, type, threshold, window_minutes,
    is_active, last_triggered_at, cooldown_minutes
  )
  VALUES (
    v_org_id, 'p95 latency spike · gpt-4o-mini', 'latency_p95', 2000, 60,
    TRUE, now() - interval '12 minutes', 60
  )
  RETURNING id INTO v_alert_id;

  -- Delivery records (shows on /alerts/:id detail page)
  IF v_channel_id IS NOT NULL THEN
    INSERT INTO alert_deliveries (organization_id, alert_id, channel_id, status, error_message, created_at)
    VALUES
      (v_org_id, v_alert_id, v_channel_id, 'sent',   NULL, now() - interval '12 minutes'),
      (v_org_id, v_alert_id, v_channel_id, 'sent',   NULL, now() - interval '1 hour 14 minutes'),
      (v_org_id, v_alert_id, v_channel_id, 'failed', 'smtp timeout: connection refused', now() - interval '2 hours 3 minutes');
  END IF;

  -- ─────────────────────────────────────────────────────────────────────
  -- 7. Audit log entries (for Settings > Audit log + Dashboard recent activity)
  -- ─────────────────────────────────────────────────────────────────────
  INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, metadata)
  VALUES
    (v_org_id, v_user_id, 'api_key.create',      'api_key',         v_key_id::text,     '{}'::jsonb),
    (v_org_id, v_user_id, 'prompt_version.create','prompt_version',  v_prompt_v1::text,  '{"name":"support_reply"}'::jsonb),
    (v_org_id, v_user_id, 'alert.create',        'alert',           v_alert_id::text,   '{"type":"latency_p95"}'::jsonb),
    (v_org_id, v_user_id, 'provider_key.add',    'provider_key',    v_prov_key_id::text,'{"provider":"openai"}'::jsonb);

  RAISE NOTICE '✔ Seed complete for org %', v_org_id;
  RAISE NOTICE '  - 250 requests (200 baseline + 50 latency spike)';
  RAISE NOTICE '  - 2 PII/injection flagged requests';
  RAISE NOTICE '  - 1 trace with 4 spans';
  RAISE NOTICE '  - 1 alert (firing) + 3 deliveries';
  RAISE NOTICE '  - 2 prompt versions';
  RAISE NOTICE '  - 4 audit log entries';
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- Reset (optional): uncomment and run to wipe the demo data
-- ═════════════════════════════════════════════════════════════════════════
-- DELETE FROM alert_deliveries WHERE alert_id IN (SELECT id FROM alerts WHERE name LIKE '%gpt-4o-mini%' OR name LIKE '%haeseong%');
-- DELETE FROM alerts WHERE name LIKE '%gpt-4o-mini%';
-- DELETE FROM notification_channels WHERE target = 'demo@spanlens.local';
-- DELETE FROM spans WHERE trace_id IN (SELECT id FROM traces WHERE name = 'support_triage_agent');
-- DELETE FROM traces WHERE name = 'support_triage_agent';
-- DELETE FROM requests WHERE created_at > now() - interval '7 days 1 hour' AND request_body IS NULL AND response_body IS NULL;
-- DELETE FROM prompt_versions WHERE name IN ('support_reply', 'summarize_tickets');
-- DELETE FROM audit_logs WHERE action IN ('api_key.create','prompt_version.create','alert.create','provider_key.add');
