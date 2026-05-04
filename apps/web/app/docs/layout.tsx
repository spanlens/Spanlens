import Link from 'next/link'
import { DocsSidebar } from './_components/sidebar'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'
import { Footer } from '@/components/layout/footer'

export const metadata = {
  title: 'Docs · Spanlens',
  description:
    'Spanlens documentation — quick start, SDK reference, proxy API, self-hosting.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      {/* Nav */}
      <nav className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 h-[56px]">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/icon.png" alt="Spanlens" width={22} height={22} className="shrink-0 rounded-[5px]" />
            <span className="font-semibold text-[16px] text-text tracking-[-0.3px]">Spanlens</span>
            <span className="text-[13px] text-text-faint hidden sm:inline">/ Docs</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="https://github.com/sunes26/Spanlens"
              target="_blank"
              className="text-[13px] text-text-muted hover:text-text transition-colors"
            >
              GitHub
            </Link>
            <Link href="/pricing" className="text-[13px] text-text-muted hover:text-text transition-colors">
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
            className="prose prose-stone max-w-none
              prose-headings:scroll-mt-20
              prose-pre:bg-[#1a1816] prose-pre:text-[#d4cfc8] prose-pre:shadow-sm prose-pre:border prose-pre:border-border/40
              prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80
              prose-table:text-sm
              [&_:not(pre)>code]:bg-bg-elev [&_:not(pre)>code]:text-text [&_:not(pre)>code]:font-normal [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:border [&_:not(pre)>code]:border-border
              [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none
              [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-sm [&_pre_code]:font-normal [&_pre_code]:before:content-none [&_pre_code]:after:content-none"
          >
            {children}
          </article>
        </main>
      </div>

      <Footer />
    </div>
  )
}
