-- Enable Supabase Realtime for the requests table.
-- REPLICA IDENTITY FULL is required so Realtime can evaluate RLS policies
-- on INSERT events (the new row's columns must be available for filtering).
ALTER TABLE requests REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE requests;
