'use client'

import { useState } from 'react'
import { verifyRemote } from '@/lib/chain-public'
import type { LedgerEvent } from '@/lib/chain-ledger'

// "Verify in your browser": downloads the public ledger page by page and re-checks every hash link with WebCrypto,
// using the same verifyChain() code as the server (src/lib/chain-ledger.ts). Nothing is sent anywhere.
export default function LedgerVerify({ expectedLength, expectedHead, command, nodeCommand }: { expectedLength: number; expectedHead: string; command: string; nodeCommand: string }) {
  const [state, setState] = useState<{ kind: 'idle' | 'running' | 'ok' | 'bad' | 'error'; text: string }>({ kind: 'idle', text: '' })
  const [copied, setCopied] = useState('')

  async function run() {
    setState({ kind: 'running', text: 'Downloading and checking…' })
    try {
      const v = await verifyRemote(
        async (since) => {
          const res = await fetch(`/api/chain/ledger?since=${since}`, { cache: 'no-store' })
          if (!res.ok) throw new Error(`the ledger could not be read (${res.status})`)
          return ((await res.json()) as { events: LedgerEvent[] }).events
        },
        (n) => setState({ kind: 'running', text: `Checked ${n} events…` }),
      )
      if (!v.ok) setState({ kind: 'bad', text: `BROKEN at seq ${v.seq}: ${v.reason}` })
      else {
        const same = v.head.seq === expectedLength && v.head.hash === expectedHead
        setState({ kind: 'ok', text: `Chain intact: ${v.count} events, head ${v.head.hash.slice(0, 16)}…${same ? ' (matches the head shown above)' : ' (the chain has grown since this page loaded)'}` })
      }
    } catch (e) {
      setState({ kind: 'error', text: e instanceof Error ? e.message : 'verification failed' })
    }
  }

  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked: the text is selectable */ }
  }

  const tone = { idle: '', running: 'text-muted', ok: 'text-ok', bad: 'text-bad', error: 'text-warn' }[state.kind]
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={state.kind === 'running'} className="rounded-md border border-line px-3 py-1.5 font-medium disabled:opacity-60">Verify in your browser</button>
        <span role="status" className={tone}>{state.text}</span>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-muted">Mirror this chain (checks every hash as it copies and refuses a broken chain):</p>
        {[['python', command], ['node', nodeCommand]].map(([label, cmd]) => (
          <div key={label} className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs bg-canvas border border-line rounded px-2 py-1 break-all">{cmd}</code>
            <button onClick={() => copy(label, cmd)} className="rounded-md border border-line px-2 py-1 text-xs">{copied === label ? 'Copied' : 'Copy'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
