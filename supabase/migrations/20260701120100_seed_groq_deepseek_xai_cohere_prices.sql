-- Seed pricing rows for the four new OpenAI-compatible providers:
-- Groq, DeepSeek, xAI (Grok), and Cohere.
--
-- All four expose an OpenAI-compatible chat surface (same request shape, SSE
-- chunk format, and `usage` field), so the proxy reuses the OpenAI parser,
-- stream logger, and cost path. The only provider-specific data is pricing.
-- Provider tag flows into requests.provider so the dashboard groups by it.
--
-- Prices are standard on-demand USD per 1M tokens, verified against the
-- providers' official pricing + model docs (2026-07). Notes:
--   • Groq: prompt caching / Batch API cut rates ~50% (not modelled here —
--     cache_read seeded where a published cached-input rate exists).
--   • DeepSeek: cache_read is the published cache-HIT input rate; deepseek-chat
--     and deepseek-reasoner are compatibility aliases scheduled to fold into
--     deepseek-v4-flash — all three seeded so cost matches either id.
--   • xAI: no cached-input rate published for these model ids → cache NULL.
--   • Cohere: only the dated Command ids have public per-token prices; the
--     command-a-plus / specialized command-a-* models are sales-quoted and are
--     intentionally NOT seeded (those rows log cost_usd = NULL, gotcha #2).

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── Groq (GroqCloud, api.groq.com/openai/v1) ─────────────────────────────
  ('groq', 'llama-3.3-70b-versatile',                    0.59,  0.79,    NULL,     NULL),
  ('groq', 'llama-3.1-8b-instant',                       0.05,  0.08,    NULL,     NULL),
  ('groq', 'openai/gpt-oss-120b',                        0.15,  0.60,    0.075,    NULL),
  ('groq', 'openai/gpt-oss-20b',                         0.075, 0.30,    0.0375,   NULL),
  ('groq', 'meta-llama/llama-4-scout-17b-16e-instruct',  0.11,  0.34,    NULL,     NULL),
  ('groq', 'qwen/qwen3-32b',                             0.29,  0.59,    NULL,     NULL),
  ('groq', 'moonshotai/kimi-k2-instruct-0905',           1.00,  3.00,    0.50,     NULL),
  -- ── DeepSeek (api.deepseek.com/v1) ───────────────────────────────────────
  ('deepseek', 'deepseek-chat',                          0.14,  0.28,    0.0028,   NULL),
  ('deepseek', 'deepseek-reasoner',                      0.14,  0.28,    0.0028,   NULL),
  ('deepseek', 'deepseek-v4-flash',                      0.14,  0.28,    0.0028,   NULL),
  ('deepseek', 'deepseek-v4-pro',                        0.435, 0.87,    0.003625, NULL),
  -- ── xAI / Grok (api.x.ai/v1) ─────────────────────────────────────────────
  ('xai', 'grok-4.3',                                    1.25,  2.50,    NULL,     NULL),
  ('xai', 'grok-4.20-0309-reasoning',                    1.25,  2.50,    NULL,     NULL),
  ('xai', 'grok-4.20-0309-non-reasoning',                1.25,  2.50,    NULL,     NULL),
  ('xai', 'grok-4.20-multi-agent-0309',                  1.25,  2.50,    NULL,     NULL),
  ('xai', 'grok-build-0.1',                              1.00,  2.00,    NULL,     NULL),
  -- ── Cohere (api.cohere.ai/compatibility/v1) ──────────────────────────────
  ('cohere', 'command-a-03-2025',                        2.50,  10.00,   NULL,     NULL),
  ('cohere', 'command-r-plus-08-2024',                   2.50,  10.00,   NULL,     NULL),
  ('cohere', 'command-r-08-2024',                        0.15,  0.60,    NULL,     NULL),
  ('cohere', 'command-r7b-12-2024',                      0.0375, 0.15,   NULL,     NULL)
ON CONFLICT (provider, model) DO NOTHING;
