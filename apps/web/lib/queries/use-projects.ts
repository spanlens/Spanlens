'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope, Project } from './types'

export const projectsQueryKey = ['projects'] as const

export function useProjects() {
  return useQuery({
    queryKey: projectsQueryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Project[]>>('/api/v1/projects')
      return res.data
    },
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const res = await apiPost<ApiEnvelope<Project>>('/api/v1/projects', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/projects/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}
