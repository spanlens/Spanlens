-- Mark OpenAI models that cannot be used via /v1/chat/completions as chat_capable = FALSE.
--
-- Reasons:
--   deprecated   — OpenAI returns "model has been deprecated" (model_not_found)
--   not_found    — OpenAI returns "does not exist or you do not have access"
--   responses_api — "only supported in v1/responses and not in v1/chat/completions"
--   not_chat     — "This is not a chat model" / not supported in chat completions
--   access       — requires org verification; fails for most accounts

UPDATE model_prices
   SET chat_capable = FALSE
 WHERE provider = 'openai'
   AND model IN (
     -- deprecated
     'gpt-3.5-turbo-0613',
     'gpt-3.5-turbo-16k-0613',
     'gpt-4-0314',
     'gpt-4-1106-vision-preview',
     -- not found / no access
     'gpt-4-0125-preview',
     'gpt-4-1106-preview',
     'gpt-4-32k',
     'o1-mini',
     -- responses API only (not /v1/chat/completions)
     'gpt-5-pro',
     'o1-pro',
     -- not a chat model
     'gpt-5.2-pro',
     'gpt-5.3-codex',
     'gpt-5.4-pro',
     -- requires verified org; fails for most accounts
     'o3-pro'
   );
