-- Add chat_capable flag to model_prices.
--
-- Rows default to TRUE. Known non-chat models (legacy completions or
-- Responses-API-only) are set to FALSE so they are excluded from the
-- Playground / Compare model picker while remaining billable for cost tracking.

ALTER TABLE model_prices
  ADD COLUMN IF NOT EXISTS chat_capable BOOLEAN NOT NULL DEFAULT TRUE;

-- Legacy OpenAI /v1/completions models (not /v1/chat/completions)
UPDATE model_prices
   SET chat_capable = FALSE
 WHERE provider = 'openai'
   AND model IN (
     'davinci-002',
     'babbage-002',
     'gpt-3.5-turbo-instruct',
     'gpt-5.5-pro'   -- returns "not a chat model" from OpenAI API
   );
