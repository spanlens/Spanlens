'use client'
import { useState } from 'react'
import { Section, FormRow } from '@/components/ui/primitives'
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from '@/lib/queries/use-notification-prefs'
import { Toggle, TabHeader } from '../_shared/ui'

// ─── NOTIFICATIONS tab ────────────────────────────────────────────────────────

interface NotificationPrefDef {
  key: 'security_alert_emails' | 'marketing_emails' | 'product_update_emails' | 'weekly_digest_emails'
  label: string
  hint: string
}

const NOTIFICATION_PREFS: NotificationPrefDef[] = [
  {
    key: 'security_alert_emails',
    label: 'Security alerts',
    hint: 'Stale-key reminders and leaked-key detection alerts for workspaces you admin.',
  },
  {
    key: 'weekly_digest_emails',
    label: 'Weekly digest',
    hint: 'A Monday summary of last week’s requests, spend, and top models for workspaces you admin.',
  },
  {
    key: 'product_update_emails',
    label: 'Product updates',
    hint: 'Occasional changelog and new-feature emails. No more than monthly.',
  },
  {
    key: 'marketing_emails',
    label: 'Marketing',
    hint: 'Launch announcements and offers. You can opt out at any time.',
  },
]

export function NotificationsTab() {
  const { data: prefs, isLoading } = useNotificationPrefs()
  const update = useUpdateNotificationPrefs()
  const [error, setError] = useState<string | null>(null)

  async function togglePref(key: NotificationPrefDef['key']) {
    setError(null)
    try {
      await update.mutateAsync({ [key]: !(prefs?.[key] ?? true) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  return (
    <div>
      <TabHeader
        title="Notifications"
        description="Which emails Spanlens sends you. These are personal to your account."
      />

      <Section title="Email preferences" className="mb-4">
        {NOTIFICATION_PREFS.map((pref) => (
          <FormRow key={pref.key} label={pref.label} hint={pref.hint}>
            <Toggle
              on={prefs?.[pref.key] ?? true}
              disabled={isLoading || update.isPending}
              onToggle={() => void togglePref(pref.key)}
            />
          </FormRow>
        ))}
        {error && (
          <div className="px-6 pb-4 -mt-2 font-mono text-[11.5px] text-bad">
            {error}
          </div>
        )}
      </Section>

      <Section title="Alert routing" className="mb-4">
        <div className="px-6 py-4 text-[12.5px] text-text-muted leading-relaxed">
          Where alerts are delivered (Slack, Discord, or email channels) is a workspace-level
          setting. Manage destinations in{' '}
          <a href="/settings?tab=integrations" className="text-accent hover:opacity-80 transition-opacity">
            Integrations
          </a>{' '}
          and the rules that trigger them on the{' '}
          <a href="/alerts" className="text-accent hover:opacity-80 transition-opacity">Alerts page</a>.
        </div>
      </Section>
    </div>
  )
}
