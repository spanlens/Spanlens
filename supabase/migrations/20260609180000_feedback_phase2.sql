-- Migration: feedback_phase2
--
-- R-32 Phase A. PH-launch (2026-06-03) feedback infrastructure expansion.
-- Phase 1 (20260530120000_feedback.sql) was submit-only: client → server →
-- ops email. No public list, no voting, no admin response surface.
--
-- Phase 2 turns the submission box into a public roadmap:
--   - public /feedback page shows all submissions ranked by community votes
--   - logged-in users upvote / un-vote
--   - admins (requireSystemAdmin) move items through a 5-state lifecycle
--     and post a public response
--   - shipped items cross-link to the changelog
--
-- This migration is additive only — Phase 1's deny-all RLS stays, all writes
-- still go through the server with service_role. No backfill needed; existing
-- feedback rows keep status='new' (the existing default).

-- ─── feedback table extension ───────────────────────────────────────────────

-- Lifecycle state machine. The legacy `status` column existed but was
-- free-text — the CHECK constraint locks it down so a typo in the admin
-- handler can't produce a row the public page does not know how to render.
alter table feedback
  drop constraint if exists feedback_status_check;
alter table feedback
  add constraint feedback_status_check
    check (status in ('new', 'planned', 'in_progress', 'shipped', 'declined'));

-- Admin response shown publicly next to the original message. Null until
-- an admin posts one. Distinct from the future internal triage notes.
alter table feedback
  add column if not exists response_message text;

-- Cross-link target for status='shipped' rows. Admin pastes the changelog
-- entry URL when shipping the feature so /feedback can render
-- "Shipped → ${changelog_url}". Optional even when shipped (some fixes are
-- too small for a changelog entry).
alter table feedback
  add column if not exists changelog_url text;

-- Audit fields for the response. Tracks WHO responded WHEN so the public
-- page can attribute the answer to a specific admin (or just say
-- "Spanlens team" — UI decision, Phase C).
alter table feedback
  add column if not exists responded_at timestamptz;

alter table feedback
  add column if not exists responded_by uuid references auth.users(id)
    on delete set null;

-- Sort accelerator. The /feedback page hot path is "list by status filter,
-- sorted by vote count DESC". The vote count comes from feedback_votes
-- COUNT() which is fast on its own; this index is for the secondary sort
-- (newest first when votes tie).
create index if not exists feedback_status_created_at_idx
  on feedback (status, created_at desc);

-- ─── feedback_votes table (new) ─────────────────────────────────────────────

-- One-vote-per-user-per-feedback. UNIQUE constraint prevents double-vote
-- from a single user; the server's upvote endpoint relies on the
-- constraint (ON CONFLICT DO NOTHING) rather than checking first.
create table if not exists feedback_votes (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references feedback(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (feedback_id, user_id)
);

-- Same deny-all stance as the parent feedback table. Server uses
-- service_role (bypasses RLS) and validates user_id from the JWT before
-- writing. Public count queries also run server-side so the client never
-- needs direct access.
alter table feedback_votes enable row level security;

-- The most common query is "vote count per feedback for the public list".
-- Index on (feedback_id) accelerates the GROUP BY in the public list
-- endpoint.
create index if not exists feedback_votes_feedback_id_idx
  on feedback_votes (feedback_id);

-- "Has this user already voted on this feedback?" is the second query
-- pattern (so the UI can grey out the vote button). Composite index on
-- (user_id, feedback_id) covers both directions.
create index if not exists feedback_votes_user_id_feedback_id_idx
  on feedback_votes (user_id, feedback_id);

comment on table feedback_votes is
  'R-32 Phase 2: one row per (user, feedback) upvote. RLS deny-all, server inserts only after JWT validation.';
