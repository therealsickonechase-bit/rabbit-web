'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter()
  const [lastRefresh, setLastRefresh] = useState<string>('—')
  const [countdown, setCountdown] = useState(intervalMs / 1000)
  const nextRefreshRef = useRef(0)

  useEffect(() => {
    nextRefreshRef.current = Date.now() + intervalMs
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock, set after mount
    setLastRefresh(new Date().toLocaleTimeString())

    const refreshTimer = setInterval(() => {
      router.refresh()
      setLastRefresh(new Date().toLocaleTimeString())
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
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" />
      <span>Live · refresh in {countdown}s · last {lastRefresh}</span>
    </div>
  )
}
