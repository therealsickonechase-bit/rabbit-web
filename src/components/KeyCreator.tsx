'use client'

import { useActionState, useState } from 'react'
import type { CreateState } from '@/app/(app)/keys/actions'

export default function KeyCreator({ action }: { action: (prev: CreateState, fd: FormData) => Promise<CreateState> }) {
  const [state, formAction, pending] = useActionState(action, {} as CreateState)
  const [copied, setCopied] = useState(false)

  return (
    <div className="space-y-3">
      <form action={formAction} className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end text-sm">
        <label>
          <span className="block text-xs text-muted mb-1">Name</span>
          <input name="name" required maxLength={60} placeholder="e.g. Claude Desktop" className="w-full rounded-md border border-line bg-canvas px-3 py-2" />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted pb-2">
          <input type="checkbox" name="propose" /> allow filing agent tasks
        </label>
        <button disabled={pending} className="rounded-md bg-accent text-white font-medium px-4 py-2 disabled:opacity-60">{pending ? 'Creating…' : 'Create key'}</button>
      </form>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.key && (
        <div role="status" className="rounded-md border border-warn/40 p-3 space-y-2">
          <p className="text-sm font-medium">Key “{state.name}” — copy it now. It is shown once and cannot be recovered.</p>
          <code className="block font-mono text-xs break-all bg-canvas border border-line rounded p-2 select-all">{state.key}</code>
          <button type="button" className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent"
            onClick={() => { navigator.clipboard?.writeText(state.key!).then(() => setCopied(true)).catch(() => setCopied(false)) }}>
            {copied ? 'Copied' : 'Copy key'}
          </button>
        </div>
      )}
    </div>
  )
}
