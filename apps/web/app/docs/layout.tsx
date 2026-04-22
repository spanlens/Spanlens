import Link from 'next/link'
import { Zap } from 'lucide-react'
import { DocsSidebar } from './_components/sidebar'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'

export const metadata = {
  title: 'Docs · Spanlens',
  description:
    'Spanlens documentation — quick start, SDK reference, proxy API, self-hosting.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600" />
            <span className="font-bold text-lg">Spanlens</span>
            <span className="text-sm text-muted-foreground hidden sm:inline">/ Docs</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="https://github.com/sunes26/Spanlens"
              target="_blank"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              GitHub
            </Link>
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <AuthNavButtons signupLabel="Start free" />
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto flex gap-8 px-6 py-10">
        <aside className="hidden md:block w-56 shrink-0">
          <div className="sticky top-20">
            <DocsSidebar />
          </div>
        </aside>

        <main className="flex-1 min-w-0 max-w-3xl">
          <article
            className="prose prose-gray max-w-none
              prose-headings:scroll-mt-20
              prose-pre:bg-gray-950 prose-pre:text-gray-100 prose-pre:shadow-sm prose-pre:border prose-pre:border-gray-800
              prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
              prose-table:text-sm
              [&_:not(pre)>code]:bg-gray-100 [&_:not(pre)>code]:text-gray-900 [&_:not(pre)>code]:font-normal [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5
              [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none
              [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-sm [&_pre_code]:font-normal [&_pre_code]:before:content-none [&_pre_code]:after:content-none"
          >
            {children}
          </article>
        </main>
      </div>
    </div>
  )
}
