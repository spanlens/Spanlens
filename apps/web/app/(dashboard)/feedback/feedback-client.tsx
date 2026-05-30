'use client'

import { useState } from 'react'
import { Check, Lightbulb, Bug, MessageSquarePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { useSubmitFeedback, type FeedbackCategory } from '@/lib/queries/use-feedback'

const MAX_LEN = 4000

const CATEGORIES: { value: FeedbackCategory; label: string; icon: typeof Lightbulb }[] = [
  { value: 'feature', label: 'Feature idea', icon: Lightbulb },
  { value: 'bug', label: 'Bug report', icon: Bug },
  { value: 'other', label: 'Other', icon: MessageSquarePlus },
]

export function FeedbackClient() {
  const [category, setCategory] = useState<FeedbackCategory>('feature')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = useSubmitFeedback()
  const trimmed = message.trim()
  const canSubmit = trimmed.length >= 3 && trimmed.length <= MAX_LEN && !submit.isPending

  function handleSubmit() {
    if (!canSubmit) return
    submit.mutate(
      { message: trimmed, category },
      {
        onSuccess: () => {
          setSubmitted(true)
          setMessage('')
        },
      },
    )
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Feedback' }]} />
        <h1 className="sr-only">Feedback</h1>
      </div>

      <div className="flex flex-col gap-6 px-[22px] py-[22px] max-w-2xl w-full">
        <div>
          <h2 className="font-medium text-[20px] tracking-[-0.3px] text-text">Feedback</h2>
          <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
            Tell us what would make Spanlens better. Feature ideas, bugs, anything. It goes straight to the team.
          </p>
        </div>

        {submitted ? (
          <div className="border border-border rounded-[8px] bg-bg-elev px-6 py-10 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-good/10">
              <Check className="h-5 w-5 text-good" />
            </div>
            <p className="font-medium text-[15px] text-text mb-1.5">Thanks for the feedback</p>
            <p className="font-mono text-[11.5px] text-text-faint max-w-sm mx-auto mb-5">
              We read every submission. If it shapes the roadmap, you might see it ship.
            </p>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="font-mono text-[11px] px-3 py-1.5 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              Send another
            </button>
          </div>
        ) : (
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
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                rows={8}
                placeholder="I'd love it if Spanlens could…"
                className="w-full resize-y rounded-[6px] border border-border bg-bg-elev px-3 py-2.5 font-mono text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent leading-relaxed"
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-text-faint">
                  {trimmed.length < 3 ? 'A few words minimum' : ' '}
                </span>
                <span className="font-mono text-[10.5px] text-text-faint">
                  {message.length} / {MAX_LEN}
                </span>
              </div>
            </div>

            {submit.isError && (
              <p className="font-mono text-[11.5px] text-bad">
                Something went wrong. Please try again.
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="font-mono text-[12px] px-4 py-2 rounded-[6px] bg-text text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {submit.isPending ? 'Sending…' : 'Send feedback'}
              </button>
              <span className="font-mono text-[10.5px] text-text-faint">
                Submitted as your account, so we can follow up.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
