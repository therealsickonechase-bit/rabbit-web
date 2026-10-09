'use client'

import { useEffect, useRef, useState } from 'react'

// Cloudflare Turnstile, rendered explicitly. The implicit form (<div class="cf-turnstile">) is only picked up when
// api.js first loads, so after a client-side navigation (for example from "Forgot password" to the login page) the
// box never appeared and the form was sent without a token. Rendering from an effect works on every visit.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  remove(id: string): void
  reset(id: string): void
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT_ID = 'cf-turnstile-api'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Load api.js once; resolve when window.turnstile exists. Safe to call from many components. */
function loadScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile)
    let el = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!el) {
      el = document.createElement('script')
      el.id = SCRIPT_ID
      el.src = SCRIPT_SRC
      el.async = true
      document.head.appendChild(el)
    }
    el.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing'))), { once: true })
    el.addEventListener('error', () => { el?.remove(); reject(new Error('script blocked')) }, { once: true })
  })
}

export default function TurnstileWidget({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'blocked' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let id: string | undefined
    let api: TurnstileApi | undefined
    let cancelled = false
    loadScript()
      .then((t) => {
        if (cancelled || !box.current) return
        api = t
        id = t.render(box.current, {
          sitekey: siteKey,
          theme: 'auto',
          callback: () => setState('done'),
          'expired-callback': () => setState('ready'),
          'timeout-callback': () => setState('ready'),
          'error-callback': () => { setState('error'); return true },
        })
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('blocked') })
    return () => {
      cancelled = true
      if (id && api) { try { api.remove(id) } catch { /* already gone */ } }
    }
  }, [siteKey, attempt])

  return (
    <div className="space-y-2">
      <div ref={box} className="min-h-[65px]" />
      {state === 'loading' && <p className="text-xs text-muted" role="status">Loading the security check…</p>}
      {state === 'ready' && <p className="text-xs text-muted" role="status">Wait for the check to turn green, then continue.</p>}
      {state === 'done' && <p className="text-xs text-ok" role="status">Check complete.</p>}
      {(state === 'blocked' || state === 'error') && (
        <p className="text-xs text-bad" role="alert">
          {state === 'blocked'
            ? 'The security check could not load. An ad or privacy blocker, a VPN or a network filter may be blocking challenges.cloudflare.com.'
            : 'The security check failed.'}{' '}
          <button type="button" className="underline" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}>Try again</button>
        </p>
      )}
    </div>
  )
}
