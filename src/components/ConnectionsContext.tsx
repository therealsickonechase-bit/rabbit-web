'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConnId, ConnReport } from '@/lib/connections'

// Components on the Brain Network page tell this provider how their connection is doing; the Connections panel reads the lot. Reports are written to a ref
// as often as they like (a live feed reports several times a second) and published to the screen at most once a second.

type Reports = Partial<Record<ConnId, ConnReport>>
interface Ctx { report: (id: ConnId, r: ConnReport) => void; reports: Reports }
const NOOP: Ctx = { report: () => {}, reports: {} }
const ConnectionsCtx = createContext<Ctx>(NOOP)

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const store = useRef<Reports>({})
  const dirty = useRef(false)
  const [reports, setReports] = useState<Reports>({})
  const report = useCallback((id: ConnId, r: ConnReport) => {
    const cur = store.current[id]
    if (cur && cur.status === r.status && cur.detail === r.detail && cur.lastAt === r.lastAt) return
    store.current[id] = r; dirty.current = true
  }, [])
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current) { dirty.current = false; setReports({ ...store.current }) } }, 1000)
    return () => clearInterval(t)
  }, [])
  return <ConnectionsCtx.Provider value={{ report, reports }}>{children}</ConnectionsCtx.Provider>
}

/** Call from a component with its current connection state. Does nothing outside a provider. */
export function useConnectionReport(id: ConnId, r: ConnReport) {
  const { report } = useContext(ConnectionsCtx)
  const { status, detail, lastAt } = r
  useEffect(() => { report(id, { status, detail, lastAt }) }, [report, id, status, detail, lastAt])
}

export const useConnectionReports = () => useContext(ConnectionsCtx)
