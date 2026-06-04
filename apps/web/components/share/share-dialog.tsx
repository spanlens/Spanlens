'use client'

import { useState } from 'react'
import { Share2, Check, Copy } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { apiPost } from '@/lib/api'

type Scope = 'trace' | 'request'
type Ttl = '7d' | '30d' | 'never'

interface ShareDialogProps {
  scope: Scope
  targetId: string
  /** UI variant — trace gets the prominent CTA, request gets a small icon. */
  variant?: 'primary' | 'secondary'
}

interface ShareCreatedResponse {
  success: boolean
  data: {
    token: string
    expires_at: string | null
    redact_pii: boolean
    redact_cost: boolean
    redact_tokens: boolean
  }
}

/**
 * Share dialog for trace + request detail pages (PLG Loop ①).
 *
 * Defaults are fail-safe: pii + cost masking on, tokens visible (debugging
 * value), noindex. TTL preset to 30 days.
 */
export function ShareDialog({ scope, targetId, variant = 'primary' }: ShareDialogProps) {
  const [open, setOpen] = useState(false)
  const [ttl, setTtl] = useState<Ttl>('30d')
  const [redactPii, setRedactPii] = useState(true)
  const [redactCost, setRedactCost] = useState(true)
  const [redactTokens, setRedactTokens] = useState(false)
  const [indexable, setIndexable] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [creating, setCreating] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const res = await apiPost<ShareCreatedResponse>('/api/v1/shares', {
        scope,
        targetId,
        ttl,
        redactPii,
        redactCost,
        redactTokens,
        indexable,
      })
      const origin = typeof window === 'undefined' ? '' : window.location.origin
      setShareUrl(`${origin}/share/${res.data.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share')
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail in some embedded contexts — fall back to manual.
    }
  }

  function reset() {
    setShareUrl(null)
    setError(null)
    setCopied(false)
  }

  const trigger =
    variant === 'primary' ? (
      <Button size="sm" variant="outline" className="gap-1.5">
        <Share2 className="h-3.5 w-3.5" />
        Share {scope}
      </Button>
    ) : (
      <Button size="icon" variant="ghost" aria-label={`Share ${scope}`}>
        <Share2 className="h-3.5 w-3.5" />
      </Button>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this {scope}</DialogTitle>
          <DialogDescription>
            Anyone with the link can view a read-only render. Sensitive fields are masked by default.
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Share link</Label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 border border-border rounded-md bg-bg-elevated font-mono text-[11.5px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <p className="text-[12px] text-text-muted">
              You can revoke this link any time from Settings → Shares.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Link expires in</Label>
              <div className="flex gap-2">
                {(['7d', '30d', 'never'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTtl(value)}
                    className={
                      'flex-1 px-3 py-2 border rounded-md font-mono text-[12px] transition-colors ' +
                      (ttl === value
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border hover:border-border-strong')
                    }
                  >
                    {value === 'never' ? 'Never' : value === '7d' ? '7 days' : '30 days'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <ToggleRow
                checked={redactPii}
                onChange={setRedactPii}
                label="Mask API keys in bodies"
                hint="Strips sk-*, sk-ant-*, AIza*, sl_live_* patterns."
              />
              <ToggleRow
                checked={redactCost}
                onChange={setRedactCost}
                label="Hide cost"
                hint="Costs are workload intel — hidden by default."
              />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11.5px] font-mono text-text-muted hover:text-text"
            >
              {showAdvanced ? '− Advanced' : '+ Advanced'}
            </button>
            {showAdvanced && (
              <div className="space-y-2 border-l-2 border-border pl-3">
                <ToggleRow
                  checked={redactTokens}
                  onChange={setRedactTokens}
                  label="Hide token counts"
                  hint="Removes prompt/completion/total counts. Debugging signal lost."
                />
                <ToggleRow
                  checked={indexable}
                  onChange={setIndexable}
                  label="Allow search engines to index"
                  hint="Off by default. Turn on for blog posts / public docs."
                />
              </div>
            )}

            {error && (
              <div className="text-[12px] text-status-error">{error}</div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {shareUrl ? (
            <Button variant="outline" onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create share link'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ToggleRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <div className="flex-1">
        <div className="text-[12.5px]">{label}</div>
        {hint && (
          <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>
        )}
      </div>
    </label>
  )
}
