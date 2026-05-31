'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  title: string
  href: string
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    title: 'Getting started',
    items: [
      { title: 'Overview', href: '/docs' },
      { title: 'Quick start', href: '/docs/quick-start' },
      { title: 'Why Spanlens', href: '/docs/why' },
      { title: 'Data model', href: '/docs/concepts/data-model' },
    ],
  },
  {
    title: 'Migrate from',
    items: [
      { title: 'Langfuse', href: '/docs/migrate/from-langfuse' },
      { title: 'Helicone', href: '/docs/migrate/from-helicone' },
      { title: 'LangSmith', href: '/docs/migrate/from-langsmith' },
    ],
  },
  {
    title: 'Tutorials',
    items: [
      { title: 'RAG chatbot', href: '/docs/tutorials/rag-chatbot' },
      { title: 'Multi-step agent', href: '/docs/tutorials/agent-tracing' },
      { title: 'Nightly evals', href: '/docs/tutorials/nightly-evals' },
    ],
  },
  {
    title: 'Core',
    items: [
      { title: 'Requests', href: '/docs/features/requests' },
      { title: 'Saved filters', href: '/docs/features/saved-filters' },
      { title: 'Users', href: '/docs/features/users' },
      { title: 'Traces', href: '/docs/features/traces' },
    ],
  },
  {
    title: 'Prompts & evaluation',
    items: [
      { title: 'Prompts', href: '/docs/features/prompts' },
      { title: 'Prompt Playground', href: '/docs/features/prompts-playground' },
      { title: 'Prompt A/B', href: '/docs/features/prompt-ab' },
      { title: 'Evals', href: '/docs/features/evals' },
      { title: 'Datasets', href: '/docs/features/datasets' },
      { title: 'Experiments', href: '/docs/features/experiments' },
      { title: 'Annotation', href: '/docs/features/annotation' },
    ],
  },
  {
    title: 'Reliability',
    items: [
      { title: 'Security', href: '/docs/features/security' },
      { title: 'Anomalies', href: '/docs/features/anomalies' },
      { title: 'Alerts', href: '/docs/features/alerts' },
      { title: 'Webhooks', href: '/docs/features/webhooks' },
    ],
  },
  {
    title: 'Cost',
    items: [
      { title: 'Cost tracking', href: '/docs/features/cost-tracking' },
      { title: 'Savings', href: '/docs/features/savings' },
      { title: 'Billing & quotas', href: '/docs/features/billing' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { title: 'Projects & API keys', href: '/docs/features/projects' },
      { title: 'Keys & encryption', href: '/docs/features/settings' },
      { title: 'Members & invitations', href: '/docs/features/members-invitations' },
      { title: 'Audit logs', href: '/docs/features/audit-logs' },
      { title: 'Data export', href: '/docs/features/export' },
    ],
  },
  {
    title: 'SDK & integrations',
    items: [
      { title: '@spanlens/sdk', href: '/docs/sdk' },
      { title: 'LangGraph', href: '/docs/integrations/langgraph' },
      { title: 'LangChain', href: '/docs/sdk#langchain' },
      { title: 'Vercel AI SDK', href: '/docs/sdk#vercel-ai' },
      { title: 'LlamaIndex', href: '/docs/sdk#llamaindex' },
      { title: 'OpenTelemetry (OTLP)', href: '/docs/otel' },
    ],
  },
  {
    title: 'Production',
    items: [
      { title: 'Reliability', href: '/docs/production/reliability' },
      { title: 'Scaling', href: '/docs/production/scaling' },
    ],
  },
  {
    title: 'API',
    items: [
      { title: 'Direct proxy (any language)', href: '/docs/proxy' },
      { title: 'REST API reference', href: '/docs/api' },
    ],
  },
  {
    title: 'Self-hosting',
    items: [
      { title: 'Docker', href: '/docs/self-host' },
    ],
  },
]

export function DocsSidebar() {
  const pathname = usePathname()
  return (
    <nav className="space-y-6 text-sm">
      {NAV.map((group) => (
        <div key={group.title}>
          <h4 className="font-semibold text-xs uppercase tracking-wide text-text-faint mb-2">
            {group.title}
          </h4>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href + item.title}>
                  <Link
                    href={item.href}
                    className={cn(
                      'block rounded px-2.5 py-1.5 transition-colors',
                      active
                        ? 'bg-accent-bg text-accent font-medium'
                        : 'text-text-muted hover:bg-bg-elev hover:text-text',
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
