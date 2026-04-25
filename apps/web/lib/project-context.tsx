'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useProjects } from '@/lib/queries/use-projects'

/**
 * Global "current project" scope for dashboard views.
 *
 * - `null` = "All projects" — unfiltered view across the workspace.
 * - A concrete id = filter applied to every per-project query.
 *
 * Persisted to localStorage so the scope sticks across page loads, but NOT
 * encoded in the URL by default. Individual pages can choose to reflect it
 * in the URL (e.g. for shareable filtered links) without the provider forcing
 * them to.
 */

const STORAGE_KEY = 'spanlens:current_project_id'

interface ProjectContextValue {
  /** Null when "All projects" is active OR data still loading. */
  projectId: string | null
  setProjectId: (id: string | null) => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

/**
 * Default when no project id is stored. We default to the first project
 * (sorted by created_at) so the single-project case feels like "this IS
 * your workspace" rather than an unfiltered aggregate that happens to
 * equal the only project. "All projects" is only meaningful once there
 * are 2+.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  // Hydrate from storage once on mount. Using a lazy initializer would be
  // nicer but localStorage is unavailable during SSR — defer to effect.
  const [projectId, setProjectIdState] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const projects = useProjects()

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setProjectIdState(raw)
    } catch { /* ignore */ }
    setHydrated(true)
  }, [])

  // Auto-select the first project after hydration if nothing is stored.
  // Waiting for `hydrated` avoids clobbering a legit "All projects" (null)
  // choice with the default before we've read localStorage.
  useEffect(() => {
    if (!hydrated) return
    const list = projects.data ?? []
    if (list.length === 0) return
    // Respect an explicit null ("All projects") only when multiple projects
    // exist. When there's just one, null is almost always unintentional and
    // we'd rather pin it to the only option.
    if (projectId === null && list.length === 1) {
      setProjectIdState(list[0]!.id)
    } else if (projectId === null && list.length > 1) {
      // First-ever visit with multiple projects: pick the first by default
      // instead of showing "All projects" aggregate (which hides per-project
      // nuance behind a sum).
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          const first = list[0]!.id
          setProjectIdState(first)
          localStorage.setItem(STORAGE_KEY, first)
        }
      } catch { /* ignore */ }
    }
  }, [hydrated, projects.data, projectId])

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id)
    try {
      if (id === null) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, id)
    } catch { /* ignore */ }
  }, [])

  const value = useMemo(() => ({ projectId, setProjectId }), [projectId, setProjectId])
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

/**
 * Read the current project scope. Returns the id string or null ("all").
 * Safe to call from any dashboard component.
 */
export function useCurrentProjectId(): string | null {
  const ctx = useContext(ProjectContext)
  if (!ctx) return null
  return ctx.projectId
}

export function useSetCurrentProjectId() {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    // Outside the provider — swallow to keep SSR/non-dashboard pages safe.
    return () => { /* no-op */ }
  }
  return ctx.setProjectId
}

/**
 * Resolve the current project's row from the projects list. Null when
 * "All projects" is selected or data still loading.
 */
export function useCurrentProject() {
  const projectId = useCurrentProjectId()
  const projects = useProjects()
  const setProjectId = useSetCurrentProjectId()

  const all = useMemo(() => projects.data ?? [], [projects.data])
  const found = useMemo(
    () => (projectId ? all.find((p) => p.id === projectId) ?? null : null),
    [projectId, all],
  )

  // If the stored id no longer exists (e.g. project was deleted in another
  // tab) we silently clear it rather than pin a ghost filter.
  useEffect(() => {
    if (projectId && all.length > 0 && !found) setProjectId(null)
  }, [projectId, all, found, setProjectId])

  return found
}
