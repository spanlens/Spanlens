'use client'
import { createClient } from './supabase/client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export async function apiGet<T>(path: string): Promise<T> {
  const authHeaders = await getAuthHeader()
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const authHeaders = await getAuthHeader()
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: body !== undefined ? JSON.stringify(body) : null,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const authHeaders = await getAuthHeader()
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: body !== undefined ? JSON.stringify(body) : null,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiDelete<T>(path: string): Promise<T> {
  const authHeaders = await getAuthHeader()
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}
