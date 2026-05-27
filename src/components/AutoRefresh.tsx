'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const DEFAULT_INTERVAL = 30_000

export default function AutoRefresh({ intervalMs = DEFAULT_INTERVAL }: { intervalMs?: number }) {
  const router = useRouter()
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(intervalMs / 1000)
  const nextRefreshRef = useRef<number>(Date.now() + intervalMs)

  useEffect(() => {
    const refreshTimer = setInterval(() => {
      router.refresh()
      const now = new Date()
      setLastRefresh(now)
      nextRefreshRef.current = Date.now() + intervalMs
    }, intervalMs)

    const countdownTimer = setInterval(() => {
      setCountdown(Math.max(0, Math.round((nextRefreshRef.current - Date.now()) / 1000)))
    }, 1000)

    return () => {
      clearInterval(refreshTimer)
      clearInterval(countdownTimer)
    }
  }, [router, intervalMs])

  return (
    <div className="flex items-center gap-3 text-xs text-zinc-600 font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      <span>next refresh in {countdown}s</span>
      <span className="text-zinc-700">·</span>
      <span>last {lastRefresh.toLocaleTimeString()}</span>
    </div>
  )
}
