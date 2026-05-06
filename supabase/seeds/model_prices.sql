-- Seed: Model pricing table (USD per 1M tokens, verified against provider pricing 2026-05)
INSERT INTO model_prices (provider, model, prompt_price_per_1m, completion_price_per_1m) VALUES
  -- OpenAI
  ('openai', 'gpt-4o',           2.50,  10.00),
  ('openai', 'gpt-4o-mini',      0.15,   0.60),
  ('openai', 'gpt-4.1',          2.00,   8.00),
  ('openai', 'gpt-4.1-mini',     0.40,   1.60),
  ('openai', 'gpt-4.1-nano',     0.10,   0.40),
  ('openai', 'gpt-4-turbo',     10.00,  30.00),
  ('openai', 'gpt-4',           30.00,  60.00),
  ('openai', 'gpt-3.5-turbo',    0.50,   1.50),
  -- Anthropic
  ('anthropic', 'claude-opus-4-7',              5.00,  25.00),
  ('anthropic', 'claude-sonnet-4-6',            3.00,  15.00),
  ('anthropic', 'claude-haiku-4-5',             1.00,   5.00),
  ('anthropic', 'claude-haiku-4-5-20251001',    1.00,   5.00),
  ('anthropic', 'claude-3-5-sonnet-20241022',   3.00,  15.00),
  ('anthropic', 'claude-3-5-haiku-20241022',    0.80,   4.00),
  ('anthropic', 'claude-3-opus-20240229',      15.00,  75.00),
  -- Gemini
  ('gemini', 'gemini-2.5-pro',        1.25, 10.00),
  ('gemini', 'gemini-2.5-flash',      0.30,  2.50),
  ('gemini', 'gemini-2.5-flash-lite', 0.10,  0.40),
  ('gemini', 'gemini-2.0-flash',      0.10,  0.40), -- deprecated 2026-06-01, kept for historical data
  ('gemini', 'gemini-1.5-pro',        1.25,  5.00),
  ('gemini', 'gemini-1.5-flash',      0.075, 0.30)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m     = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m = EXCLUDED.completion_price_per_1m,
      updated_at              = now();
