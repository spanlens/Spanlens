import Link from 'next/link'
import { DemoSidebar } from '@/components/layout/demo-sidebar'
import { SidebarProvider } from '@/lib/sidebar-context'
import { CommandPaletteProvider } from '@/components/command-palette'

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
    <SidebarProvider>
    <div className="flex h-screen overflow-hidden bg-bg">
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
          <div className="px-4 py-4 md:px-8 md:py-7">{children}</div>
        </main>
      </div>
    </div>
    </SidebarProvider>
    </CommandPaletteProvider>
  )
}
