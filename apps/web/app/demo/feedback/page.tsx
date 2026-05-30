'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Lightbulb, Bug, MessageSquarePlus } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

const MAX_LEN = 4000

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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Demo' }, { label: 'Feedback' }]} />
        <h1 className="sr-only">Feedback</h1>
      </div>

      <div className="flex flex-col gap-6 px-[22px] py-[22px] max-w-2xl w-full">
        <div>
          <h2 className="font-medium text-[20px] tracking-[-0.3px] text-text">Feedback</h2>
          <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
            Tell us what would make Spanlens better. Feature ideas, bugs, anything. It goes straight to the team.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {/* Category */}
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Category
            </label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCategory(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border font-mono text-[11.5px] transition-colors',
                    category === value
                      ? 'border-accent text-accent bg-accent-bg'
                      : 'border-border text-text-muted hover:text-text hover:border-border-strong',
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
            <label htmlFor="feedback-message" className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Your message
            </label>
            <textarea
              id="feedback-message"
              disabled
              readOnly
              rows={8}
              placeholder="I'd love it if Spanlens could…"
              className="w-full resize-y rounded-[6px] border border-border bg-bg px-3 py-2.5 font-mono text-[12.5px] text-text-muted placeholder:text-text-faint focus:outline-none cursor-not-allowed leading-relaxed"
            />
            <div className="flex items-center justify-end">
              <span className="font-mono text-[10.5px] text-text-faint">0 / {MAX_LEN}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="font-mono text-[12px] px-4 py-2 rounded-[6px] bg-text text-bg hover:opacity-90 transition-opacity"
            >
              Sign up to send feedback →
            </Link>
            <span className="font-mono text-[10.5px] text-text-faint">
              Feedback is submitted as your account, so we can follow up.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
