# P3-26: Annual toggle UI

**Depends on**: P3-25 (Paddle Price IDs + backend env vars must exist first).

## Implementation sketch

File: `apps/web/app/pricing/page.tsx`

### 1. Convert page to client component or hoist toggle state

Option A: pass toggle state via URL search param (preserves SSR + share-friendly):
```tsx
// app/pricing/page.tsx
import { Suspense } from 'react'
import { PricingToggle } from './_toggle'
// ... existing server component code

// Render the toggle as a client component sub-component
<Suspense fallback={null}>
  <PricingToggle />
</Suspense>
```

Option B: convert whole page to client component (simpler but loses SSR benefits — not recommended for SEO).

### 2. Create `_toggle.tsx` client component

```tsx
'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function PricingToggle() {
  const router = useRouter()
  const params = useSearchParams()
  const interval = params.get('interval') === 'year' ? 'year' : 'month'

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-border bg-bg-elev">
      <button
        onClick={() => router.replace('/pricing?interval=month')}
        className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
          interval === 'month' ? 'bg-accent text-bg' : 'text-text-muted hover:text-text'
        }`}
      >
        Monthly
      </button>
      <button
        onClick={() => router.replace('/pricing?interval=year')}
        className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
          interval === 'year' ? 'bg-accent text-bg' : 'text-text-muted hover:text-text'
        }`}
      >
        Yearly <span className="ml-1 text-[10px] opacity-80">Save 20%</span>
      </button>
    </div>
  )
}
```

### 3. Read the search param in PLANS rendering

Make `PLANS` a function that takes the interval:

```tsx
function getPlans(interval: 'month' | 'year') {
  return [
    {
      name: 'Free', price: '$0', /* ... */
    },
    {
      name: 'Pro',
      price: interval === 'month' ? '$29' : '$279',
      unit: interval === 'month' ? '/mo' : '/yr',
      monthlyEquivalent: interval === 'year' ? '$23.25/mo billed annually' : null,
      bullets: [/* unchanged */],
      cta: 'Start Pro',
      href: `/signup?plan=pro&interval=${interval}`,
      highlight: true,
    },
    {
      name: 'Team',
      price: interval === 'month' ? '$149' : '$1,431',
      unit: interval === 'month' ? '/mo' : '/yr',
      monthlyEquivalent: interval === 'year' ? '$119.25/mo billed annually' : null,
      bullets: [/* unchanged */],
      cta: 'Start Team',
      href: `/signup?plan=team&interval=${interval}`,
      highlight: false,
    },
    {
      name: 'Enterprise', /* unchanged */
    },
  ]
}
```

Then in the page component:
```tsx
const sp = await searchParams // or read from server component params
const interval = sp.interval === 'year' ? 'year' : 'month'
const plans = getPlans(interval)
```

### 4. JSON-LD update

Update `pricingJsonLd` to include both intervals (so search engines see both prices):

```tsx
const pricingJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Spanlens',
  offers: [
    { '@type': 'Offer', name: 'Pro Monthly', price: '29', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro Annual', price: '279', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Team Monthly', price: '149', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Team Annual', price: '1431', priceCurrency: 'USD' },
    // ...
  ],
}
```

### 5. Place toggle above the plan grid

After the H1 subtitle, before the "Every plan includes" box:

```tsx
<div className="text-center mb-10">
  <PricingToggle />
</div>
```

## Estimated effort
- 2 hours including testing

## Acceptance criteria
- Toggle persists via URL param (`?interval=year` shows yearly prices)
- All three signup CTAs route to `/signup?plan=X&interval=Y`
- JSON-LD includes both monthly and yearly offers
- "Save 20%" badge visible on year option
- Default (no param) is monthly
