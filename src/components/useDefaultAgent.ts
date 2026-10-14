'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { normalizeDefaultAgent, readDefaultAgent, writeDefaultAgent, type TerminalAgent } from '@/lib/coding-assistant'

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

// The default agent lives in this browser's localStorage only. If storage is unavailable the choice still works for this page
// view through the in-memory fallback. The server snapshot is 'gemini', so hydration matches.
let memory: TerminalAgent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = () => { memory = null; listener() }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}
const snapshot = (): TerminalAgent => memory ?? readDefaultAgent(storage())
const serverSnapshot = (): TerminalAgent => 'gemini'

export function useDefaultAgent(): [TerminalAgent, (value: TerminalAgent) => void] {
  const agent = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const update = useCallback((value: TerminalAgent) => {
    const next = normalizeDefaultAgent(value)
    memory = next
    writeDefaultAgent(storage(), next)
    emit()
  }, [])
  return [agent, update]
}
