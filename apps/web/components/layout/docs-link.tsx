import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

interface DocsLinkProps {
  /** Path to the docs page. Typically "/docs/features/<feature>". */
  href: string
  /** Optional label override. Defaults to "Learn more". */
  label?: string
}

/**
 * Small "Learn more →" link for dashboard page headers.
 * Navigates in-tab to the matching /docs/* page so users can dig into how a
 * feature works without searching.
 */
export function DocsLink({ href, label = 'Learn more' }: DocsLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-sm text-blue-600 hover:text-blue-700 hover:underline shrink-0"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )
}
