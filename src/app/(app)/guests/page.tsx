import { createAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import GuestCreator from '@/components/GuestCreator'
import { Badge, Card, PageHeader, Table, Td, ago, when } from '@/components/ui'
import { ACCESS_DAYS, LINK_DAYS, MAX_USES, evaluateRedemption, timeLeft } from '@/lib/guest'
import { createPass, revokePass, sweepEnded } from './actions'

export default async function GuestsPage() {
  await requireOwner()
  const admin = createAdminClient()
  const res = await admin.from('guest_passes').select('id, label, issued_to, created_at, link_expires_at, first_used_at, access_until, uses, max_uses, revoked_at, user_id').order('created_at', { ascending: false }).limit(50)
  const rows = res.data ?? []

  const status = (p: (typeof rows)[number]) => {
    if (p.revoked_at) return { tone: 'muted' as const, text: 'revoked' }
    const v = evaluateRedemption(p)
    if (!v.ok) return { tone: 'muted' as const, text: v.reason === 'link_expired' ? 'link expired' : v.reason === 'access_ended' ? 'ended' : 'used up' }
    return p.first_used_at ? { tone: 'ok' as const, text: timeLeft(p.access_until) } : { tone: 'info' as const, text: 'not used yet' }
  }

  return (
    <>
      <PageHeader title="Guest passes" sub="Give someone 3 days of read-only access with a link and no password">
        <form action={sweepEnded}><button className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent">Clean up ended passes</button></form>
      </PageHeader>
      <div className="space-y-6">
        <Card title="Create a pass">
          <GuestCreator action={createPass} />
          <p className="text-xs text-muted mt-3">
            The pass lasts {ACCESS_DAYS} days from the first time the link is opened (an unopened link expires after {LINK_DAYS} days) and works for up to {MAX_USES} sign-ins.
            A guest can browse Research, the CRISPR Explorer and the Guide, read-only. No chat, collections, tasks, API keys, settings, EEG or twin data.
            Guests have no real email address and no contact record, so write down who you gave each pass to. Revoking a pass signs the guest out immediately.
          </p>
        </Card>

        <Card title="Passes" flush>
          <Table head={['Label', 'Issued to', 'Status', 'Sign-ins', 'Created', 'Ends', '']} empty="No passes yet.">
            {rows.map((p) => {
              const s = status(p)
              return (
                <tr key={p.id}>
                  <Td>{p.label}</Td>
                  <Td>{p.issued_to ?? '—'}</Td>
                  <Td><Badge tone={s.tone}>{s.text}</Badge></Td>
                  <Td mono>{p.uses}/{p.max_uses}</Td>
                  <Td>{ago(p.created_at)}</Td>
                  <Td className="whitespace-nowrap">{p.access_until ? when(p.access_until) : '—'}</Td>
                  <Td>
                    {!p.revoked_at && p.user_id && (
                      <form action={revokePass}>
                        <input type="hidden" name="pass" value={p.id} />
                        <button className="text-xs underline text-muted hover:text-bad">Revoke</button>
                      </form>
                    )}
                  </Td>
                </tr>
              )
            })}
          </Table>
        </Card>
      </div>
    </>
  )
}
