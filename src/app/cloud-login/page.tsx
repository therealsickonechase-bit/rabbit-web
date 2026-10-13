import Link from 'next/link'
import { accessMode } from '@/lib/cloud-access'
import CloudLoginForm from '@/components/CloudLoginForm'
export const dynamic = 'force-dynamic'

export default function CloudLoginPage() {
  let mode = 'invalid (locked)'
  try { mode = accessMode(process.env) } catch {}
  return <main className="max-w-3xl mx-auto p-6 space-y-4">
    <h1 className="text-2xl font-semibold">Restricted cloud access</h1>
    <p>Operator-selected mode: {mode}. Modes are selected by server configuration, never by browser-provided authorization flags.</p>
    <ul className="list-disc pl-6">
      <li>Local-only (default): every human and machine remote integration is disabled.</li>
      <li>Supabase: only existing confirmed users in the owner-controlled email allowlist may authenticate, then request agent approval. No signup or legacy account restoration.</li>
      <li>Cloudflare Access: signed application JWT verified against configured team keys, issuer, audience and expiry, then exact email allowlist. Agent service identity has separate rules.</li>
    </ul>
    {mode === 'supabase' && <CloudLoginForm />}
    {mode === 'cloudflare-access' && <p>Authenticate through the operator-configured Access application; this page does not create Access policies or trust unsigned identity headers.</p>}
    <p>Authentication alone never approves cloud use. Agent-reviewed grants last at most one hour, are scope-bound and revocable. No approval credential is available in this console.</p>
    <nav className="flex gap-4 text-accent"><Link href="/dashboard">RabbitOS</Link><Link href="/cloudshell">Cloud shell</Link><Link href="/vault-jobs">Vault jobs</Link></nav>
  </main>
}
