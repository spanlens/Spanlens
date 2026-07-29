-- Dummy traces + spans seed for local dev (Smoke Test Org)
-- Run: docker exec -i supabase_db_Spanlens psql -U postgres -d postgres < supabase/seeds/dummy_traces.sql
-- Cleanup: DELETE FROM traces WHERE organization_id = '5abce023-05c8-4e99-9b37-ea81b7e3e9ff';

DO $$
DECLARE
  v_org_id   UUID := '5abce023-05c8-4e99-9b37-ea81b7e3e9ff';
  v_proj_id  UUID := 'bb857d39-5ebc-4521-aab9-b0d81b46f742';
  v_key_id   UUID := '8151e32c-2798-4761-bf7b-25fcfdf993f6';

  v_trace UUID;
  v_root  UUID;
  v_a UUID; v_b UUID; v_c UUID; v_d UUID; v_e UUID; v_f UUID; v_g UUID;
  v_start TIMESTAMPTZ;
BEGIN

  ------------------------------------------------------------------
  -- TRACE 1: customer-support-agent (the hero trace for span tree)
  -- 7 spans, parallel fan-out at step 3-4 (RAG + tool call)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '12 minutes';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'customer-support-agent', 'completed',
          v_start, v_start + interval '3247 ms', 3247,
          jsonb_build_object('user_id', 'u_42abc', 'session_id', 's_xyz', 'channel', 'in_app_chat'));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     input, output, prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'classify_intent', 'llm', 'completed',
          v_start, v_start + interval '412 ms', 412,
          '{"prompt":"Classify user intent","model":"gpt-4o-mini"}',
          '{"intent":"refund_request","confidence":0.94}',
          340, 22, 362, 0.000098);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_a, v_trace, v_root, v_org_id, 'retrieve_order_history', 'retrieval', 'completed',
          v_start + interval '420 ms', v_start + interval '688 ms', 268,
          0, 0, 0, NULL);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_b, v_trace, v_root, v_org_id, 'lookup_refund_policy', 'tool', 'completed',
          v_start + interval '420 ms', v_start + interval '590 ms', 170,
          0, 0, 0, NULL);

  v_c := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     input, output, prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_c, v_trace, v_root, v_org_id, 'draft_response', 'llm', 'completed',
          v_start + interval '700 ms', v_start + interval '2547 ms', 1847,
          '{"prompt":"Draft a refund response using retrieved context","model":"gpt-4o"}',
          '{"response":"Hi, I checked your order #4892..."}',
          1820, 340, 2160, 0.0042);

  v_d := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_d, v_trace, v_c, v_org_id, 'tone_check', 'llm', 'completed',
          v_start + interval '2560 ms', v_start + interval '2890 ms', 330,
          120, 18, 138, 0.000041);

  v_e := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_e, v_trace, v_root, v_org_id, 'send_message', 'tool', 'completed',
          v_start + interval '2900 ms', v_start + interval '3247 ms', 347,
          0, 0, 0, NULL);

  ------------------------------------------------------------------
  -- TRACE 2: rag-document-qa (deep chain, 6 spans)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '38 minutes';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'rag-document-qa', 'completed',
          v_start, v_start + interval '2104 ms', 2104,
          jsonb_build_object('user_id', 'u_research_team', 'collection', 'product_docs_v3'));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'embed_query', 'embedding', 'completed',
          v_start, v_start + interval '180 ms', 180,
          24, 0, 24, 0.000003);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms)
  VALUES (v_a, v_trace, v_root, v_org_id, 'vector_search', 'retrieval', 'completed',
          v_start + interval '185 ms', v_start + interval '405 ms', 220);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_b, v_trace, v_a, v_org_id, 'rerank_results', 'llm', 'completed',
          v_start + interval '410 ms', v_start + interval '720 ms', 310,
          540, 12, 552, 0.000148);

  v_c := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     input, output, prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_c, v_trace, v_b, v_org_id, 'synthesize_answer', 'llm', 'completed',
          v_start + interval '730 ms', v_start + interval '2104 ms', 1374,
          '{"model":"claude-sonnet-4-6","top_k":5}',
          '{"answer":"Based on the docs, the rate limit is..."}',
          2840, 410, 3250, 0.00891);

  ------------------------------------------------------------------
  -- TRACE 3: research-agent-deep (longer, with parallel branches)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '2 hours';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'research-agent-deep', 'completed',
          v_start, v_start + interval '8420 ms', 8420,
          jsonb_build_object('topic', 'competitor_analysis_q2'));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'plan_research', 'llm', 'completed',
          v_start, v_start + interval '890 ms', 890,
          480, 220, 700, 0.00136);

  -- 3 parallel branches
  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_a, v_trace, v_root, v_org_id, 'search_web', 'tool', 'completed',
          v_start + interval '900 ms', v_start + interval '4200 ms', 3300,
          0, 0, 0, NULL);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_b, v_trace, v_root, v_org_id, 'search_internal_docs', 'retrieval', 'completed',
          v_start + interval '900 ms', v_start + interval '2100 ms', 1200,
          0, 0, 0, NULL);

  v_c := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_c, v_trace, v_root, v_org_id, 'query_database', 'tool', 'completed',
          v_start + interval '900 ms', v_start + interval '1640 ms', 740,
          0, 0, 0, NULL);

  v_d := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_d, v_trace, v_root, v_org_id, 'synthesize_report', 'llm', 'completed',
          v_start + interval '4220 ms', v_start + interval '8420 ms', 4200,
          5840, 980, 6820, 0.0224);

  ------------------------------------------------------------------
  -- TRACE 4: code-generation-pipeline (with one error span)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '5 hours';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata, error_message)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'code-generation-pipeline', 'error',
          v_start, v_start + interval '4100 ms', 4100,
          jsonb_build_object('repo', 'spanlens/sdk', 'language', 'typescript'),
          'Lint check failed after generation');

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'parse_user_intent', 'llm', 'completed',
          v_start, v_start + interval '320 ms', 320,
          180, 40, 220, 0.000056);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_a, v_trace, v_root, v_org_id, 'generate_code', 'llm', 'completed',
          v_start + interval '330 ms', v_start + interval '3700 ms', 3370,
          2410, 1280, 3690, 0.0184);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     error_message)
  VALUES (v_b, v_trace, v_a, v_org_id, 'lint_check', 'tool', 'error',
          v_start + interval '3710 ms', v_start + interval '4100 ms', 390,
          'ESLint found 3 errors: prefer-const, no-unused-vars, no-explicit-any');

  ------------------------------------------------------------------
  -- TRACE 5: voice-assistant-pipeline (short, fast)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '8 hours';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'voice-assistant-pipeline', 'completed',
          v_start, v_start + interval '987 ms', 987,
          jsonb_build_object('device', 'mobile_ios', 'locale', 'en-US'));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'speech_to_text', 'tool', 'completed',
          v_start, v_start + interval '210 ms', 210,
          0, 0, 0, NULL);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_a, v_trace, v_root, v_org_id, 'reply_short', 'llm', 'completed',
          v_start + interval '220 ms', v_start + interval '720 ms', 500,
          240, 80, 320, 0.000088);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_b, v_trace, v_a, v_org_id, 'text_to_speech', 'tool', 'completed',
          v_start + interval '730 ms', v_start + interval '987 ms', 257,
          0, 0, 0, NULL);

  ------------------------------------------------------------------
  -- TRACE 6: email-triage (yesterday)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '1 day';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'email-triage', 'completed',
          v_start, v_start + interval '1840 ms', 1840,
          jsonb_build_object('batch_size', 12, 'priority_levels', 4));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'classify_batch', 'llm', 'completed',
          v_start, v_start + interval '980 ms', 980,
          1840, 180, 2020, 0.00033);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms)
  VALUES (v_a, v_trace, v_root, v_org_id, 'apply_labels', 'tool', 'completed',
          v_start + interval '990 ms', v_start + interval '1180 ms', 190);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_b, v_trace, v_root, v_org_id, 'draft_responses', 'llm', 'completed',
          v_start + interval '1190 ms', v_start + interval '1840 ms', 650,
          840, 320, 1160, 0.000232);

  ------------------------------------------------------------------
  -- TRACE 7: sql-query-agent (in progress / running)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '4 seconds';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'sql-query-agent', 'running',
          v_start,
          jsonb_build_object('database', 'analytics_replica'));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'understand_question', 'llm', 'completed',
          v_start, v_start + interval '420 ms', 420,
          280, 90, 370, 0.00007);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at)
  VALUES (v_a, v_trace, v_root, v_org_id, 'write_sql', 'llm', 'running',
          v_start + interval '430 ms');

  ------------------------------------------------------------------
  -- TRACE 8: doc-summarization (2 days ago)
  ------------------------------------------------------------------
  v_trace := gen_random_uuid();
  v_start := now() - interval '2 days';

  INSERT INTO traces (id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata)
  VALUES (v_trace, v_org_id, v_proj_id, v_key_id,
          'doc-summarization', 'completed',
          v_start, v_start + interval '5240 ms', 5240,
          jsonb_build_object('document_id', 'doc_8472', 'pages', 18));

  v_root := gen_random_uuid();
  INSERT INTO spans (id, trace_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_root, v_trace, v_org_id, 'extract_text', 'tool', 'completed',
          v_start, v_start + interval '720 ms', 720,
          0, 0, 0, NULL);

  v_a := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_a, v_trace, v_root, v_org_id, 'chunk_document', 'custom', 'completed',
          v_start + interval '730 ms', v_start + interval '890 ms', 160,
          0, 0, 0, NULL);

  v_b := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_b, v_trace, v_a, v_org_id, 'summarize_chunks_parallel', 'llm', 'completed',
          v_start + interval '900 ms', v_start + interval '3800 ms', 2900,
          7200, 1840, 9040, 0.0291);

  v_c := gen_random_uuid();
  INSERT INTO spans (id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms,
                     prompt_tokens, completion_tokens, total_tokens, cost_usd)
  VALUES (v_c, v_trace, v_b, v_org_id, 'combine_summaries', 'llm', 'completed',
          v_start + interval '3810 ms', v_start + interval '5240 ms', 1430,
          1840, 420, 2260, 0.00591);

  RAISE NOTICE 'Inserted 8 traces and their spans for org %', v_org_id;
END
$$;

-- Quick verification
SELECT COUNT(*) AS trace_count FROM traces WHERE organization_id = '5abce023-05c8-4e99-9b37-ea81b7e3e9ff';
SELECT COUNT(*) AS span_count FROM spans WHERE organization_id = '5abce023-05c8-4e99-9b37-ea81b7e3e9ff';
