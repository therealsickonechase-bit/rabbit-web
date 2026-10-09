import { createAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import { isGuestEmail } from '@/lib/guest'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, when } from '@/components/ui'

export default async function MembersPage() {
  await requireOwner()
  const admin = createAdminClient()

  const [list, owners, contacts] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from('owners').select('user_id'),
    admin.from('contact_records').select('user_id'),
  ])

  const users = (list.data?.users ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const ownerIds = new Set((owners.data ?? []).map((o) => o.user_id))
  const withRecord = new Set((contacts.data ?? []).map((c) => c.user_id))
  const confirmed = users.filter((u) => u.email_confirmed_at).length

  return (
    <>
      <PageHeader title="Members" sub="Accounts on this console. Visible to the owner only." />
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Accounts" value={users.length} />
          <Stat label="Confirmed" value={confirmed} sub="verified their email" />
          <Stat label="Unconfirmed" value={users.length - confirmed} />
          <Stat label="Contact records" value={users.filter((u) => withRecord.has(u.id)).length} sub="encrypted, opened only on valid legal request" />
        </div>

        <Card flush>
          <Table head={['Email', 'Role', 'Joined', 'Last sign-in', 'Confirmed', 'Contact record']} empty="No accounts yet.">
            {users.map((u) => (
              <tr key={u.id}>
                <Td>{u.email}</Td>
                <Td><Badge tone={ownerIds.has(u.id) ? 'accent' : 'muted'}>{ownerIds.has(u.id) ? 'Owner' : isGuestEmail(u.email) ? 'Guest' : 'Member'}</Badge></Td>
                <Td className="whitespace-nowrap">{when(u.created_at)}</Td>
                <Td>{ago(u.last_sign_in_at)}</Td>
                <Td><Badge tone={u.email_confirmed_at ? 'ok' : 'warn'}>{u.email_confirmed_at ? 'Yes' : 'No'}</Badge></Td>
                <Td>{withRecord.has(u.id) ? <Badge tone="ok">Stored</Badge> : <Badge tone="muted">None</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <p className="text-xs text-muted">
          Contact records are encrypted to a key only the owner holds. This page shows that one exists, never its contents. Opening one is logged and follows docs/legal-requests.md.
        </p>
      </div>
    </>
  )
}
