// ─────────────────────────────────────────────────────────────────────────────
// Polling intervals for "live" dashboard pages (P3.9, 2026-05-19).
//
// Strategy
// --------
// Before P3.9 each hook hand-picked an interval (10_000 here, 60_000 there)
// with no shared rationale. After P3.9 these named constants make the
// trade-offs explicit:
//
//   • LIVE_REFETCH_MS_ACTIVE  — page is the user's current focus (`/requests`,
//                                 `/dashboard` overview). Tight enough that
//                                 new traffic shows up within ~30 seconds
//                                 without the user reaching for F5, loose
//                                 enough to keep ClickHouse query budget
//                                 sane for a tab left open all day.
//   • LIVE_REFETCH_MS_SECONDARY — pages that don't drive the immediate "is
//                                  it working?" question (`/anomalies`,
//                                  `/security`). 30s is enough; tighter
//                                  intervals waste ClickHouse query budget
//                                  on a tab the user isn't actively reading.
//   • LIVE_REFETCH_MS_HEALTH   — slow-moving status (system, billing).
//                                  60s — these update on the scale of
//                                  minutes, not seconds.
//
// Two TanStack defaults already do half the work for us, set in
// `lib/query-client.ts`:
//   • `refetchOnWindowFocus: true`  — instant refresh when the user comes
//                                       back to the tab, even mid-interval.
//   • `refetchIntervalInBackground: false` (TanStack default) — polling
//                                       pauses when the tab is hidden.
//
// So a hook that sets `refetchInterval: LIVE_REFETCH_MS_ACTIVE` automatically
// gets: poll every 5s while visible, pause when hidden, refresh on focus.
// No extra config needed.
// ─────────────────────────────────────────────────────────────────────────────

/** 30 seconds — primary dashboards (`/dashboard`, `/requests`). */
export const LIVE_REFETCH_MS_ACTIVE = 30_000

/** 30 seconds — secondary live pages (`/anomalies`, `/security`). */
export const LIVE_REFETCH_MS_SECONDARY = 30_000

/** 60 seconds — slow-moving status / health surfaces (`/health`, billing). */
export const LIVE_REFETCH_MS_HEALTH = 60_000
