'use client'
import { useSyncExternalStore } from 'react'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false

export function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}
