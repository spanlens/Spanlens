-- Expand the CHECK constraints that gate evaluator + experiment provider
-- choices so Mistral, OpenRouter (and Azure / Gemini for experiments) become
-- selectable from the Evals / Experiments UI.
--
-- Today the dashboard only offers OpenAI / Anthropic / Gemini in the "Judge
-- provider" and "Run provider" dropdowns, even though model_prices has 19
-- Mistral and 170 OpenRouter rows. The UI is hardcoded because the DB
-- CHECK would reject anything else on INSERT.
--
-- Constraint we're widening:
--   evaluator_templates.recommended_judge_provider:
--     'openai' | 'anthropic' | 'gemini'
--     → + 'azure' | 'mistral' | 'openrouter'
--   experiments.run_provider:
--     'openai' | 'anthropic'
--     → + 'gemini' | 'azure' | 'mistral' | 'openrouter'
--
-- The server endpoint + judge runner switch are widened in the same PR.

ALTER TABLE evaluator_templates
  DROP CONSTRAINT IF EXISTS evaluator_templates_recommended_judge_provider_check;

ALTER TABLE evaluator_templates
  ADD CONSTRAINT evaluator_templates_recommended_judge_provider_check
  CHECK (recommended_judge_provider IN (
    'openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter'
  ));

ALTER TABLE experiments
  DROP CONSTRAINT IF EXISTS experiments_run_provider_check;

ALTER TABLE experiments
  ADD CONSTRAINT experiments_run_provider_check
  CHECK (run_provider IN (
    'openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter'
  ));
