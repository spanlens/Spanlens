# P3-25: Annual billing — Paddle setup

## Status
**Cannot execute from code alone.** Requires Paddle Dashboard access + new Price IDs + Spanlens backend changes.

## Why annual matters
- ARPU lift via prepaid commitment
- New keyword surface: "annual LLM observability plan"
- Anchor for monthly/annual toggle (visible psychology even if most pick monthly)

## Steps (in order)

### 1. Paddle Dashboard — create annual Price IDs

Login to https://vendors.paddle.com → Products → Spanlens Pro:
- Add Price: `Pro Annual`
  - Recurring: yearly
  - Price: $278.40 (= $29 × 12 × 0.80 → 20% annual discount). Round to $279.
  - Trial: same as monthly
- Note new `price_id` (`pri_xxx`)

Repeat for Team Annual:
- $149 × 12 × 0.80 = $1,430.40 → round to $1,431
- Note `price_id`

Same for Sandbox env (separate IDs).

### 2. Spanlens backend changes

File `apps/server/src/lib/paddle.ts` (or equivalent):
- Add `PADDLE_PRO_PRICE_ID_ANNUAL`, `PADDLE_TEAM_PRICE_ID_ANNUAL` env vars
- Add `interval: 'month' | 'year'` to checkout endpoint params
- Route to the right `price_id` based on `interval`

File `apps/server/src/api/paddleWebhook.ts`:
- No changes needed — `subscription.created` events carry the price_id; existing handler should map to plan/tier without caring about interval. But verify `current_period_start/end` is set correctly for annual.

Database (no migration needed if `plan` column stays the same — annual vs monthly is implicit in the Paddle subscription, not in our plan column):
- Optional: add `subscriptions.billing_interval` text column for reporting. Migration `YYYYMMDDHHMMSS_add_billing_interval.sql`.

### 3. Frontend toggle

File `apps/web/app/pricing/page.tsx`:
- Add `useState<'month' | 'year'>('month')` toggle
- For Pro/Team cards, switch displayed price + `?interval=` param in CTA href
- Add "Save 20%" badge on the year option

Example:
```tsx
const [interval, setInterval] = useState<'month' | 'year'>('month')

const proPrice = interval === 'month' ? '$29' : '$279'
const proPriceUnit = interval === 'month' ? '/mo' : '/yr'
const proHref = `/signup?plan=pro&interval=${interval}`
```

### 4. Self-serve plan switching

For existing monthly customers wanting to switch to annual:
- Settings page → "Switch to annual" button
- Calls `POST /api/v1/billing/switch-interval` with new `interval`
- Server calls Paddle's "Update subscription" API with new price_id
- Paddle prorates the existing balance toward the new period

### 5. Sandbox testing

- Verify checkout opens with annual price
- Verify webhook fires `subscription.created` with new price_id
- Verify dashboard correctly shows "Pro Annual" plan name and next renewal date

### 6. Production rollout

- Deploy backend changes first (additive, no breaking changes for existing customers)
- Deploy frontend toggle second
- Update Paddle production with same Price IDs as sandbox

## Estimated effort
- Paddle Dashboard: 30 min
- Backend changes: 2-4 hours
- Frontend toggle: 1-2 hours
- Self-serve switch: 2-4 hours (optional, can defer)
- Testing: 2-3 hours
- **Total: ~10 hours**

## Files this touches
- `apps/server/src/lib/paddle.ts` (or equivalent file with PADDLE_*_PRICE_ID env reads)
- `apps/server/src/api/paddleWebhook.ts` (verify, likely no edits)
- `apps/server/src/api/billing.ts` (add switch-interval endpoint, optional)
- `apps/web/app/pricing/page.tsx` (toggle UI + price routing)
- `apps/web/app/settings/billing/page.tsx` (switch interval button, optional)
- `supabase/migrations/YYYYMMDDHHMMSS_add_billing_interval.sql` (optional)
