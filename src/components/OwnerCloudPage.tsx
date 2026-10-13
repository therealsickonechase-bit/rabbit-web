import Link from 'next/link'
import { requireCloudIdentity } from '@/lib/auth/cloud-identity'
import { accessMode } from '@/lib/cloud-access'
import { ownerConsoles } from '@/lib/cloud-deployment'
import { approvedVaultRoots } from '@/lib/cloud-job-bff'
import { CloudJobError, upstreamConfig } from '@/lib/cloud-jobs'
import OwnerCloudConsole from './OwnerCloudConsole'
import CloudAccessRequest from './CloudAccessRequest'

export default async function OwnerCloudPage({ service }: { service: 'shell' | 'vault' }) {
  let authError = ''
  try { await requireCloudIdentity() }
  catch (error) { authError = error instanceof CloudJobError ? error.message : 'Cloud authentication unavailable.' }
  let mode = 'invalid (locked)'
  try { mode = accessMode(process.env) } catch {}
  const shell = service === 'shell'
  const roots = shell ? [] : approvedVaultRoots()
  let configured = false
  if (!authError) {
    try {
      upstreamConfig(shell ? process.env.RABBIT_CLOUDSHELL_URL : process.env.VAULT_AGENT_URL,
        shell ? process.env.RABBIT_CLOUDSHELL_TOKEN : process.env.VAULT_AGENT_TOKEN)
      configured = shell ? (process.env.RABBIT_CLOUDSHELL_TOKEN?.length ?? 0) >= 32 : roots.length > 0
    } catch {}
  }
  return <main className="max-w-4xl mx-auto p-6 space-y-5">
    <nav aria-label="Owner cloud tools" className="flex gap-4 text-accent">
      <Link href="/dashboard">RabbitOS</Link>
      <Link href="/cloudshell">Cloud shell</Link>
      <Link href="/vault-jobs">Vault cloud jobs</Link>
      <Link href="/cloud-login">Restricted cloud access</Link>
    </nav>
    <h1 className="text-2xl font-semibold">{shell ? 'Allowlisted cloud shell' : 'Allowlisted vault cloud jobs'}</h1>
    <p>Operator-selected mode: {mode}. Available modes: local-only, restricted Supabase, Cloudflare Access. Browser controls cannot change or downgrade server policy.</p>
    {mode === 'local-only' ? <section aria-labelledby="owner-consoles" className="space-y-2">
        <p>This console is local-only and never runs remote tools. Owner cloud tools live on separate consoles with their own sign-in:</p>
        <ul id="owner-consoles" className="list-disc pl-5">
          {ownerConsoles.map(item => <li key={item.url}><a href={item.url} className="text-accent" rel="noopener">{item.label}</a></li>)}
        </ul>
        <p className="text-sm text-muted">Signing in does not grant access. Each session still needs a time-limited approval.</p>
      </section> :
    authError ? <p role="alert">{authError} No commands, notes or reports are accessible. The public workspace remains account-free.</p> :
      <>
        <CloudAccessRequest scopes={shell ? ['shell.execute'] : ['vault.submit', 'vault.read']} />
        <OwnerCloudConsole service={service} configured={configured} roots={roots} />
      </>}
  </main>
}
