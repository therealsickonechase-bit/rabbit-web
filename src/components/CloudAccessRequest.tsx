'use client'

import { useState } from 'react'

export default function CloudAccessRequest({ scopes }: { scopes: string[] }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Pending: authentication is not a grant. Request agent approval before using cloud tools.')
  async function call(request = false) {
    setBusy(true)
    try {
      const response = await fetch(`/api/cloud-access/${request ? 'request' : 'status'}`, {
        method: request ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: request ? { 'Content-Type': 'application/json' } : undefined,
        body: request ? JSON.stringify({ scopes }) : undefined,
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? 'Access request failed.')
      setMessage(request ? `Request ${value.id}: ${value.state}. No automatic approval.` :
        value.approved ? `Approved scopes: ${value.scopes.join(', ')}. Expires ${new Date(value.expiresAt).toISOString()}. Each operation rechecks revocation and scope.` :
          'Pending, expired or revoked: remote operations are locked. Request approval or refresh after the agent reviews it.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Access broker unavailable.') }
    finally { setBusy(false) }
  }
  return <section className="border border-line rounded p-3 space-y-3" aria-label="Agent approval">
    <h2 className="font-semibold">Agent-controlled one-hour access</h2>
    <p role="status">{message}</p>
    <p>Requested scopes: {scopes.join(', ')}. Only the separately credentialed approver agent can approve, deny or revoke. No approval token is exposed here.</p>
    <div className="flex gap-3">
      <button disabled={busy} onClick={() => call(true)} className="border border-line rounded px-3 py-2 disabled:opacity-50">Request access</button>
      <button disabled={busy} onClick={() => call()} className="border border-line rounded px-3 py-2 disabled:opacity-50">Refresh approval status</button>
    </div>
  </section>
}
