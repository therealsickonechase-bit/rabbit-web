'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function CloudLoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/cloud-login', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? 'Restricted sign-in failed.')
      setMessage('Signed in to the restricted cloud boundary. Access remains pending until the approver agent grants requested scopes.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Restricted sign-in unavailable.') }
    finally { setPassword(''); setBusy(false) }
  }
  return <form onSubmit={submit} className="space-y-3 max-w-lg">
    <p>Existing confirmed, owner-allowlisted accounts only. No signup. Password goes only to this same-origin server/provider authentication; it is not saved locally or sent to a sandbox.</p>
    <label className="block">Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} className="block w-full border border-line rounded p-2" /></label>
    <label className="block">Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} required disabled={busy} className="block w-full border border-line rounded p-2" /></label>
    <button disabled={busy} className="border border-line rounded px-3 py-2 disabled:opacity-50">{busy ? 'Verifying…' : 'Sign in to restricted cloud tools'}</button>
    {message && <p role="status">{message}</p>}
    <p><Link href="/cloudshell" className="text-accent underline">Request shell access</Link> or <Link href="/vault-jobs" className="text-accent underline">request vault-job access</Link>.</p>
  </form>
}
