-- Mark additional non-chat models discovered during playground testing.
-- gpt-3.5-0301: wrong model name (correct is gpt-3.5-turbo-0301); returns 404.

UPDATE model_prices
   SET chat_capable = FALSE
 WHERE provider = 'openai'
   AND model IN ('gpt-3.5-0301');
