'use client'
import { useState } from 'react'
import { Section, FormRow } from '@/components/ui/primitives'
import { useOrganization, useUpdateSecuritySettings } from '@/lib/queries/use-organization'
import { NativeInput, Toggle, TabHeader } from '../_shared/ui'

// ─── SECURITY tab ─────────────────────────────────────────────────────────────

export function SecurityTab() {
  const { data: org } = useOrganization()
  // Remount inner panel when org's threshold value changes so the local input
  // state initialises from the new server value — avoids setState-in-effect.
  return <SecurityTabInner key={String(org?.stale_key_threshold_days ?? '__loading__')} />
}

function SecurityTabInner() {
  const { data: org } = useOrganization()
  const updateSecurity = useUpdateSecuritySettings()
  const [thresholdDays, setThresholdDays] = useState<string>(
    org ? String(org.stale_key_threshold_days) : '90',
  )
  const [error, setError] = useState<string | null>(null)
  const staleAlertsEnabled = org?.stale_key_alerts_enabled ?? true
  const leakDetectionEnabled = org?.leak_detection_enabled ?? false

  async function commitThreshold() {
    const n = Number(thresholdDays)
    if (!Number.isInteger(n) || n < 30 || n > 365) {
      if (org) setThresholdDays(String(org.stale_key_threshold_days))
      return
    }
    if (org && n === org.stale_key_threshold_days) return
    setError(null)
    try {
      await updateSecurity.mutateAsync({ stale_key_threshold_days: n })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function toggleStaleAlerts() {
    setError(null)
    try {
      await updateSecurity.mutateAsync({ stale_key_alerts_enabled: !staleAlertsEnabled })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function toggleLeakDetection() {
    setError(null)
    try {
      await updateSecurity.mutateAsync({ leak_detection_enabled: !leakDetectionEnabled })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Security"
        description="Notification settings for key health monitoring. Neither setting auto-revokes keys."
      />
      <Section title="Key monitoring" className="mb-5">
        <FormRow label="Stale key reminders" hint="Email admins a weekly digest of keys idle this long.">
          <div className="flex items-center gap-3">
            <NativeInput
              type="number"
              min={30}
              max={365}
              value={thresholdDays}
              onChange={(e) => setThresholdDays(e.target.value)}
              onBlur={() => void commitThreshold()}
              disabled={!staleAlertsEnabled || updateSecurity.isPending}
              className="w-20 font-mono text-[12.5px]"
            />
            <span className="font-mono text-[11px] text-text-faint">days (30–365)</span>
            <Toggle
              on={staleAlertsEnabled}
              disabled={updateSecurity.isPending}
              onToggle={() => void toggleStaleAlerts()}
            />
          </div>
        </FormRow>
        <FormRow label="Leaked-key detection" hint="Daily GitGuardian scan against public sources. Email-only, admins decide whether to revoke.">
          <Toggle
            on={leakDetectionEnabled}
            disabled={updateSecurity.isPending}
            onToggle={() => void toggleLeakDetection()}
          />
        </FormRow>
        {error && (
          <div className="px-6 pb-4 -mt-2 font-mono text-[11.5px] text-status-error">
            {error}
          </div>
        )}
      </Section>
    </div>
  )
}
