-- Update Gemini recommendation rules to point to currently available models.
-- gemini-1.5-flash and gemini-2.0-flash are deprecated; use gemini-2.5-flash.

UPDATE model_recommendations
   SET suggested_model           = 'gemini-2.5-flash',
       cost_ratio                = 0.24,
       reason                    = 'Gemini 2.5 Flash is ~4x cheaper than 1.5 Pro and significantly faster on short requests.',
       updated_at                = now()
 WHERE current_provider = 'gemini' AND current_model = 'gemini-1.5-pro';

UPDATE model_recommendations
   SET suggested_model           = 'gemini-2.5-flash',
       cost_ratio                = 0.15,
       reason                    = 'Gemini 2.5 Flash delivers better output quality at lower cost for short-context tasks.',
       updated_at                = now()
 WHERE current_provider = 'gemini' AND current_model = 'gemini-2.0-pro';
