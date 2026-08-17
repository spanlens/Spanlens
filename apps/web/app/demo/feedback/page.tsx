'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Lightbulb, Bug, MessageSquarePlus } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const MAX_LEN = 4000

const FIELD_LABEL = 'font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint'

const CATEGORIES: { value: string; label: string; icon: typeof Lightbulb }[] = [
  { value: 'feature', label: 'Feature idea', icon: Lightbulb },
  { value: 'bug', label: 'Bug report', icon: Bug },
  { value: 'other', label: 'Other', icon: MessageSquarePlus },
]

// Demo mockup of the real /feedback page. Read-only: there is no logged-in
// account to submit as, so the category picker reflects local state but the
// message box and submit button are disabled and point visitors to signup.
export default function DemoFeedbackPage() {
  const [category, setCategory] = useState('feature')

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding the
          demo layout applies so its hairline spans the whole main column. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar crumbs={[{ label: 'Demo' }, { label: 'Feedback' }]} />
      </div>
      <h1 className="sr-only">Feedback</h1>

      <div className="pt-4 md:pt-5">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Feedback</CardTitle>
            <CardDescription>
              Tell us what would make Spanlens better. Feature ideas, bugs, anything. It goes
              straight to the team.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-5">
            {/* Category */}
            <div className="flex flex-col gap-2">
              <label className={FIELD_LABEL}>Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-medium transition-colors',
                      category === value
                        ? 'border-accent-border bg-accent-bg text-accent'
                        : 'border-border bg-bg-elev text-text-muted hover:bg-bg-muted hover:text-text',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div className="flex flex-col gap-2">
              <label htmlFor="feedback-message" className={FIELD_LABEL}>
                Your message
              </label>
              <textarea
                id="feedback-message"
                disabled
                readOnly
                rows={8}
                placeholder="I'd love it if Spanlens could…"
                className="w-full cursor-not-allowed resize-y rounded-md border border-border bg-bg-sunk px-3 py-2.5 text-[12.5px] leading-relaxed text-text-muted placeholder:text-text-faint focus:outline-none"
              />
              <div className="flex items-center justify-end">
                <span className="font-mono text-[11px] text-text-faint">0 / {MAX_LEN}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg transition-opacity hover:opacity-90"
              >
                Sign up to send feedback →
              </Link>
              <span className="font-mono text-[11px] text-text-faint">
                Feedback is submitted as your account, so we can follow up.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
