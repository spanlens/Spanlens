import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/landing/reveal'

/**
 * Plan ledger: one panel, one column per plan, ruled apart, with the
 * self-host line closing it off.
 *
 * Plans arrive as a prop because `page.tsx` owns the canonical list and also
 * derives the SoftwareApplication `offers` block from it. Keeping one source
 * means the pricing on screen and the pricing in the structured data cannot
 * drift apart.
 */

export interface LandingPlan {
  name: string
  price: string
  unit: string
  blurb: string
  bullets: string[]
  cta: string
  href: string
  primary?: boolean
  tag?: string
}

export function Plans({ plans }: { plans: LandingPlan[] }) {
  return (
    <section className="px-4 py-10 sm:px-6 lg:px-10 lg:pb-[120px] lg:pt-10">
      <div className="mx-auto max-w-[1200px]">
        <header className="mx-auto max-w-[700px] text-center">
          <h2 className="font-display track-h2 text-[30px] leading-[1.1] text-text lg:text-[44px]">
            Billed on requests, never on seats
          </h2>
          <p className="mt-4 text-[14.5px] leading-[1.58] text-text-muted lg:text-[16px]">
            Bring the whole team on any plan. The repo stays MIT, so self-hosting is always the free
            exit.
          </p>
        </header>

        <div className="card-surface mt-10 overflow-hidden rounded-tile lg:mt-[52px]">
          <Reveal className="grid sm:grid-cols-2 lg:grid-cols-4" stagger={80}>
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`
                  flex flex-col border-b border-border p-7 last:border-b-0
                  sm:[&:nth-last-child(2)]:border-b-0
                  sm:border-l sm:[&:nth-child(odd)]:border-l-0
                  lg:border-b-0 lg:[&:nth-child(3)]:border-l lg:p-9
                  ${plan.primary ? 'bg-accent-bg' : ''}
                `}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[16px] font-semibold text-text">{plan.name}</span>
                  {plan.tag && (
                    <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold leading-none text-accent-fg">
                      {plan.tag}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-display track-h2 text-[40px] leading-none text-text lg:text-[52px]">
                    {plan.price}
                  </span>
                  {plan.unit && <span className="text-[13.5px] text-text-faint">{plan.unit}</span>}
                </div>

                <p className="mt-2.5 text-[14px] leading-[1.55] text-text-muted">{plan.blurb}</p>

                <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                  {plan.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2.5 text-[14px] leading-[1.4] text-text"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full ${plan.primary ? 'bg-accent-bright' : 'bg-border-strong'}`}
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="hero"
                  variant={plan.primary ? 'signal' : 'outline'}
                  className="mt-7 h-[45px] w-full text-[14.5px]"
                >
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </Reveal>

          <div className="flex flex-col gap-2 border-t border-border bg-bg-sunk px-7 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-9">
            <p className="text-[14.5px] font-medium leading-[1.4] text-text">
              Self-hosted stays free. Unlimited requests, unlimited history, your own Docker image.
            </p>
            <code className="shrink-0 font-mono text-[12.5px] text-text-muted">
              docker run spanlens/server
            </code>
          </div>
        </div>
      </div>
    </section>
  )
}
