-- Feature feedback / suggestion box.
-- Logged-in users submit free-text suggestions from the dashboard. Phase 1 is
-- submit-only: no public list, no voting. Server-only writes via service_role.
create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  -- Submitter. Kept even if the auth user is later deleted (set null) so the
  -- text survives for the roadmap. email is denormalized for quick triage.
  user_id         uuid,
  email           text,
  -- 'feature' | 'bug' | 'other'. Free-form but the UI offers these three.
  category        text not null default 'feature',
  message         text not null,
  -- Where it was submitted from (e.g. 'dashboard', 'requests-page') for context.
  source          text not null default 'dashboard',
  -- Triage state for when an admin reviews it. Not shown to submitters in P1.
  status          text not null default 'new',
  created_at      timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on feedback (created_at desc);
create index if not exists feedback_org_idx on feedback (organization_id);

-- RLS: deny all client access. Writes go through the server (service_role
-- bypasses RLS). Same model as the waitlist table — no anon/authenticated
-- policies means the table is unreachable from the browser's Supabase client.
alter table feedback enable row level security;

comment on table feedback is 'Dashboard feature suggestions. Server-only writes via service_role.';
