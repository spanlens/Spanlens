'use client'
import { formatDate } from '@/lib/utils'
import { Section, FormRow } from '@/components/ui/primitives'
import { useCurrentUser } from '@/lib/queries/use-current-user'
import { TabHeader } from '../_shared/ui'

// ─── PROFILE tab ──────────────────────────────────────────────────────────────

export function ProfileTab() {
  const { data: user, isLoading } = useCurrentUser()
  return (
    <div>
      <TabHeader
        title="Profile"
        description="Your sign-in identity. Managed by Supabase Auth."
      />

      <Section title="Account" className="mb-4">
        {isLoading ? (
          <div className="px-6 py-4 font-mono text-[12.5px] text-text-faint">Loading…</div>
        ) : user ? (
          <>
            <FormRow label="Email">
              <div className="font-mono text-[12.5px] text-text">{user.email ?? '—'}</div>
            </FormRow>
            <FormRow label="User ID">
              <div className="font-mono text-[11px] text-text-muted truncate">{user.id}</div>
            </FormRow>
            <FormRow label="Account created">
              <div className="font-mono text-[12px] text-text-muted">
                {formatDate(user.created_at)}
              </div>
            </FormRow>
          </>
        ) : (
          <div className="px-6 py-4 font-mono text-[12.5px] text-text-faint">Not signed in.</div>
        )}
      </Section>

      <Section title="Change sign-in details" className="mb-4">
        <div className="px-6 py-4 text-[12.5px] text-text-muted leading-relaxed">
          To reset your password, use the <span className="font-mono text-text">&quot;Forgot password?&quot;</span> link
          on the login page and we&apos;ll email you a reset link. Changing your sign-in email isn&apos;t
          self-service yet, and two-factor authentication is not available at the moment. For an email
          change, write to <span className="font-mono text-text">support@spanlens.io</span> from your
          current address.
        </div>
      </Section>
    </div>
  )
}
