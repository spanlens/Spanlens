-- Results of live API testing (2026-05-26).
-- Models marked FALSE either return not_found, are deprecated, require
-- special tooling, or are unavailable to new accounts.

UPDATE model_prices SET chat_capable = FALSE
 WHERE (provider, model) IN (
   -- Anthropic: not_found_error (model no longer available)
   ('anthropic', 'claude-opus-4'),
   ('anthropic', 'claude-sonnet-4'),
   ('anthropic', 'claude-3-5-sonnet-20241022'),
   ('anthropic', 'claude-3-5-haiku-20241022'),
   ('anthropic', 'claude-3-opus-20240229'),
   ('anthropic', 'claude-3-haiku-20240307'),
   -- Gemini: deprecated / not found
   ('gemini', 'gemini-3.1-flash-lite-preview'),
   ('gemini', 'gemini-2.5-flash-lite-preview-09-2025'),
   ('gemini', 'gemini-2.0-flash'),
   ('gemini', 'gemini-2.0-flash-lite'),
   ('gemini', 'gemini-1.5-pro'),
   ('gemini', 'gemini-1.5-flash'),
   -- Gemini: requires Computer Use tool (not standard chat)
   ('gemini', 'gemini-2.5-computer-use-preview-10-2025')
 );
