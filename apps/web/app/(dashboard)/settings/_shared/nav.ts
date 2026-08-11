// Settings inner-nav definition and the tab id union.
//
// Kept in its own module (no JSX, no hooks) so the page shell and every
// section file can share the tab identifiers without dragging section code
// into the same chunk.

export type TabId =
  | 'general' | 'members' | 'security' | 'audit-log' | 'system'
  | 'billing' | 'plan' | 'invoices'
  | 'profile' | 'auth-methods' | 'notifications' | 'preferences'
  | 'integrations' | 'destinations' | 'webhooks' | 'opentelemetry'

export interface NavItem { id: TabId; label: string; crumbs: { label: string }[] }

// Crumb shape is now `[{ label: 'Settings' }, { label: <Item> }]` across the
// board. The leading "Workspace" / "Account" / "Connect" prefix was
// redundant (the inner nav already shows the group) and inconsistent
// between groups. Normalising everything to "Settings / <Item>" matches
// the breadcrumb pattern used on the rest of the dashboard.
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      { id: 'general',    label: 'General',       crumbs: [{ label: 'Settings' }, { label: 'General' }] },
      { id: 'members',    label: 'Members',       crumbs: [{ label: 'Settings' }, { label: 'Members' }] },
      { id: 'security',   label: 'Security',      crumbs: [{ label: 'Settings' }, { label: 'Security' }] },
      { id: 'audit-log',  label: 'Audit log',     crumbs: [{ label: 'Settings' }, { label: 'Audit log' }] },
      { id: 'system',     label: 'System',        crumbs: [{ label: 'Settings' }, { label: 'System' }] },
    ],
  },
  {
    group: 'Usage',
    items: [
      { id: 'billing',  label: 'Billing',         crumbs: [{ label: 'Settings' }, { label: 'Billing' }] },
      { id: 'plan',     label: 'Plan & limits',   crumbs: [{ label: 'Settings' }, { label: 'Plan & limits' }] },
      { id: 'invoices', label: 'Invoices',        crumbs: [{ label: 'Settings' }, { label: 'Invoices' }] },
    ],
  },
  {
    group: 'Account',
    items: [
      { id: 'profile',       label: 'Profile',         crumbs: [{ label: 'Settings' }, { label: 'Profile' }] },
      { id: 'auth-methods',  label: 'Sign-in methods', crumbs: [{ label: 'Settings' }, { label: 'Sign-in methods' }] },
      { id: 'notifications', label: 'Notifications',   crumbs: [{ label: 'Settings' }, { label: 'Notifications' }] },
      { id: 'preferences',   label: 'Preferences',     crumbs: [{ label: 'Settings' }, { label: 'Preferences' }] },
    ],
  },
  {
    group: 'Connect',
    items: [
      { id: 'integrations',  label: 'Integrations',   crumbs: [{ label: 'Settings' }, { label: 'Integrations' }] },
      // DESTINATIONS_HIDDEN: uncomment when BigQuery/S3/Snowflake connectors are implemented
      // { id: 'destinations',  label: 'Destinations',   crumbs: [{ label: 'Settings' }, { label: 'Destinations' }] },
      { id: 'webhooks',      label: 'Webhooks',       crumbs: [{ label: 'Settings' }, { label: 'Webhooks' }] },
      { id: 'opentelemetry', label: 'OpenTelemetry',  crumbs: [{ label: 'Settings' }, { label: 'OpenTelemetry' }] },
    ],
  },
]

export const ALL_ITEMS = NAV.flatMap((g) => g.items)
