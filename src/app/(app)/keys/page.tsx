import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import KeyCreator from '@/components/KeyCreator'
import { Badge, Card, PageHeader, Table, Td, ago, when } from '@/components/ui'
import { MAX_ACTIVE_KEYS, RATE_LIMIT_PER_MINUTE, keyUsable } from '@/lib/mcp'
import { createKey, revokeKey } from './actions'

export default async function KeysPage() {
  await requireUser()
  const sb = await createClient()
  const keys = await sb.from('api_keys').select('id, name, prefix, scopes, created_at, expires_at, last_used_at, revoked_at').order('created_at', { ascending: false })
  const rows = keys.data ?? []

  return (
    <>
      <PageHeader title="API keys" sub="Let Claude Desktop, scripts and other MCP clients use RabbitOS as you, with limited access" />
      <div className="space-y-6">
        <Card title="Create a key">
          <KeyCreator action={createKey} />
          <p className="text-xs text-muted mt-3">
            Up to {MAX_ACTIVE_KEYS} active keys, each valid for 90 days and limited to {RATE_LIMIT_PER_MINUTE} calls a minute. A key can search the public research and CRISPR guides
            and check the proof digest. With “allow filing agent tasks” it can also queue tasks; an owner still approves anything that is added. It can never read chats, notes, EEG or twin data.
            Only a hash of the key is stored, so a lost key must be replaced.
          </p>
        </Card>

        <Card title="Your keys" flush>
          <Table head={['Name', 'Key', 'Access', 'Status', 'Last used', 'Expires', '']} empty="No keys yet.">
            {rows.map((k) => {
              const usable = keyUsable({ revoked_at: k.revoked_at, expires_at: k.expires_at })
              return (
                <tr key={k.id}>
                  <Td>{k.name}</Td>
                  <Td mono>{k.prefix}…</Td>
                  <Td>{(k.scopes as string[]).join(' + ')}</Td>
                  <Td><Badge tone={usable ? 'ok' : 'muted'}>{k.revoked_at ? 'revoked' : usable ? 'active' : 'expired'}</Badge></Td>
                  <Td>{k.last_used_at ? ago(k.last_used_at) : 'never'}</Td>
                  <Td className="whitespace-nowrap">{when(k.expires_at)}</Td>
                  <Td>
                    {usable && (
                      <form action={revokeKey}>
                        <input type="hidden" name="key" value={k.id} />
                        <button className="text-xs underline text-muted hover:text-bad">Revoke</button>
                      </form>
                    )}
                  </Td>
                </tr>
              )
            })}
          </Table>
        </Card>

        <Card title="Connect an MCP client">
          <p className="text-sm">Server address: <code className="font-mono text-xs">https://app.rabbitsoftware.io/api/mcp</code></p>
          <p className="text-xs text-muted mt-2">Send your key as <code className="font-mono">Authorization: Bearer rbk_…</code>. Example for Claude Code:</p>
          <pre className="bg-canvas border border-line rounded-md p-3 text-xs font-mono overflow-x-auto mt-2">{`claude mcp add --transport http rabbitos https://app.rabbitsoftware.io/api/mcp \\
  --header "Authorization: Bearer rbk_YOUR_KEY"`}</pre>
          <p className="text-xs text-muted mt-2">Tools: search_research, get_record, list_crispr_guides, verify_crispr_digest, research_stats, list_my_tasks, and propose_task (needs the task scope).</p>
        </Card>
      </div>
    </>
  )
}
