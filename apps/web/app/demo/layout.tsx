import Link from 'next/link'
import { DemoSidebar } from '@/components/layout/demo-sidebar'
import { SidebarProvider } from '@/lib/sidebar-context'
import { CommandPaletteProvider } from '@/components/command-palette'
import { TrackOnce } from '@/components/track-once'
import { DemoClientGuard } from './_client-guard'

// Demo is a noindex subsystem (sample-data playground, no SEO value). Until
// now these pages inherited the root layout's metadata and were served as
// `index, follow` with a canonical of `/` — make the noindex policy explicit.
export const metadata = {
  robots: { index: false, follow: false },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
    <SidebarProvider>
    {/* Funnel event: visitor reached the no-signup demo. Once per tab
        session so in-demo navigation doesn't inflate the count. */}
    <TrackOnce event="demo_entered" />
    {/* Mirrors the live (dashboard) layout: 125% zoom for a roomier default
        view, with height divided by the same factor so the zoomed container
        still resolves to exactly one viewport height. Without the height
        correction, 100vh * 1.25 overflows and adds a stray scrollbar.
        DemoSidebar applies `md:[zoom:0.8]` to cancel this parent zoom so the
        sidebar itself renders at 100% while the main content stays at 125%. */}
    <div className="flex h-[calc(100vh/1.25)] overflow-hidden bg-bg [zoom:1.25]">
      <DemoSidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Demo banner */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-accent/10 border-b border-accent/20 text-[12px] font-mono">
          <span className="text-accent font-medium">⚡ Demo Mode</span>
          <span className="text-text-muted hidden sm:inline">Exploring with sample data · No signup required</span>
          <Link
            href="/signup"
            className="shrink-0 px-3 py-1 rounded-[5px] bg-accent text-bg font-medium hover:opacity-90 transition-opacity text-[11px]"
          >
            Start free →
          </Link>
        </div>
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="px-4 py-4 md:px-8 md:py-7">
            {/* Renders nothing during SSR + first client paint to sidestep any
                remaining #418 hydration mismatches in demo children. See
                _client-guard.tsx for the rationale and trade-offs. */}
            <DemoClientGuard>{children}</DemoClientGuard>
          </div>
        </main>
      </div>
    </div>
    </SidebarProvider>
    </CommandPaletteProvider>
  )
}
