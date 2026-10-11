'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { captchaSubmissionReady, usableCaptchaToken } from '@/lib/auth/captcha'

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
    const created = !el
    if (!el) {
      el = document.createElement('script')
      el.id = SCRIPT_ID
      el.src = SCRIPT_SRC
      el.async = true
    }
    const script = el
    const cleanup = () => {
      clearTimeout(timeout)
      script.removeEventListener('load', loaded)
      script.removeEventListener('error', failed)
    }
    const loaded = () => {
      cleanup()
      if (window.turnstile) resolve(window.turnstile)
      else { script.remove(); reject(new Error('turnstile missing')) }
    }
    const failed = () => { cleanup(); script.remove(); reject(new Error('script blocked or timed out')) }
    const timeout = setTimeout(failed, 15000)
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (created) document.head.appendChild(script)
  })
}

export default function TurnstileWidget({ siteKey, buttonClass }: { siteKey: string; buttonClass: string }) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const submitted = useRef(false)
  const { pending } = useFormStatus()
  const [token, setToken] = useState('')
  const [wasPending, setWasPending] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'blocked' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  if (pending !== wasPending) {
    setWasPending(pending)
    setToken('')
    setState('ready')
  }

  useEffect(() => {
    if (pending) submitted.current = true
    else if (submitted.current) {
      submitted.current = false
      widget.current?.api.reset(widget.current.id)
    }
  }, [pending])

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
          'response-field': false,
          callback: (value: string) => {
            if (cancelled) return
            setToken(usableCaptchaToken(value) ? value : '')
            setState(usableCaptchaToken(value) ? 'done' : 'error')
          },
          'expired-callback': () => { if (!cancelled) { setToken(''); setState('ready') } },
          'timeout-callback': () => { if (!cancelled) { setToken(''); setState('ready') } },
          'error-callback': (code: string) => {
            if (!cancelled) {
              console.error('Turnstile challenge failed', code)
              setToken(''); setState('error')
            }
            return true
          },
        })
        widget.current = { api: t, id }
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) {
          console.error('Turnstile script could not load')
          setState('blocked')
        }
      })
    return () => {
      cancelled = true
      widget.current = null
      if (id && api) { try { api.remove(id) } catch { /* already gone */ } }
    }
  }, [siteKey, attempt])

  return (
    <div className="space-y-2">
      <input type="hidden" name="cf-turnstile-response" value={token} />
      <div ref={box} className="min-h-[65px]" />
      {state === 'loading' && <p className="text-xs text-muted" role="status">Loading the security check…</p>}
      {state === 'ready' && <p className="text-xs text-muted" role="status">Wait for the check to turn green, then continue.</p>}
      {state === 'done' && <p className="text-xs text-ok" role="status">Check complete.</p>}
      {(state === 'blocked' || state === 'error') && (
        <p className="text-xs text-bad" role="alert">
          {state === 'blocked'
            ? 'The security check could not load. An ad or privacy blocker, a VPN or a network filter may be blocking challenges.cloudflare.com.'
            : 'The security check failed. Check your network or browser filters allow challenges.cloudflare.com, then retry.'}{' '}
          <button type="button" className="underline" disabled={pending} onClick={() => { setToken(''); setState('loading'); setAttempt((n) => n + 1) }}>Try again</button>
        </p>
      )}
      <button className={`${buttonClass} disabled:opacity-50`} disabled={!captchaSubmissionReady(token, pending)}>
        {pending ? 'Requesting sign-in link…' : 'Email me a sign-in link'}
      </button>
    </div>
  )
}
