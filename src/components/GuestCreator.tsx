'use client'

import { useActionState, useState } from 'react'
import type { PassState } from '@/app/(app)/guests/actions'

export default function GuestCreator({ action }: { action: (prev: PassState, fd: FormData) => Promise<PassState> }) {
  const [state, formAction, pending] = useActionState(action, {} as PassState)
  const [copied, setCopied] = useState(false)

  return (
    <div className="space-y-3">
      <form action={formAction} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end text-sm">
        <label>
          <span className="block text-xs text-muted mb-1">Label</span>
          <input name="label" required maxLength={60} placeholder="e.g. Dr Lee demo" className="w-full rounded-md border border-line bg-canvas px-3 py-2" />
        </label>
        <label>
          <span className="block text-xs text-muted mb-1">Issued to (your own record, optional)</span>
          <input name="issued_to" maxLength={120} placeholder="name or contact" className="w-full rounded-md border border-line bg-canvas px-3 py-2" />
        </label>
        <button disabled={pending} className="rounded-md bg-accent text-white font-medium px-4 py-2 disabled:opacity-60">{pending ? 'Creating…' : 'Create pass'}</button>
      </form>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.link && (
        <div role="status" className="rounded-md border border-warn/40 p-3 space-y-2">
          <p className="text-sm font-medium">Guest link for “{state.label}” — copy it now; it is shown once.</p>
          <code className="block font-mono text-xs break-all bg-canvas border border-line rounded p-2 select-all">{state.link}</code>
          <button type="button" className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent"
            onClick={() => { navigator.clipboard?.writeText(state.link!).then(() => setCopied(true)).catch(() => setCopied(false)) }}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <p className="text-xs text-muted">Anyone with this link can use the pass, so send it only to the person it is for.</p>
        </div>
      )}
    </div>
  )
}
