import { headers } from 'next/headers'
import { readLedgerSummary } from '@/lib/chain-ledger-db'
import { cloudshellCommand, mirrorCommand, mirrorCommandNode } from '@/lib/chain-public'
import LedgerVerify from '@/components/LedgerVerify'
import { Badge, Card, PageHeader, Stat, Table, Td, short, when } from '@/components/ui'

export const dynamic = 'force-dynamic'

// Public ledger explorer. No login. Everything shown here is also served by GET /api/chain/ledger and /api/chain/head.
export default async function LedgerPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.rabbitsoftware.io'
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${host}`
  let summary = null
  let failed = false
  try { summary = await readLedgerSummary() } catch { failed = true }

  return (
    <div className="space-y-6">
      <PageHeader title="Public ledger" sub="An append-only, hash-chained log of every write. Anyone can read, verify and mirror it. It is not a consensus blockchain." />
      {!summary ? (
        <Card><p className="text-sm text-muted">{failed ? 'The ledger could not be read right now.' : 'The chain ledger is not set up yet.'}</p></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Chain length" value={summary.length} sub={summary.updatedAt ? `last event ${when(summary.updatedAt)}` : 'no events yet'} />
            <div className="bg-surface border border-line rounded-lg p-4 sm:col-span-2 min-w-0">
              <p className="text-xs text-muted">Head hash</p>
              <p className="font-mono text-xs mt-2 break-all">{summary.headHash}</p>
              <p className="text-xs text-muted mt-3">Genesis (prev_hash of event 1)</p>
              <p className="font-mono text-xs mt-1 break-all">{summary.genesis}</p>
            </div>
          </div>

          <Card title="Events per table">
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.counts).map(([t, n]) => <Badge key={t} tone={n ? 'accent' : 'muted'}>{t}: {n}</Badge>)}
            </div>
          </Card>

          <Card title="Verify and mirror">
            <LedgerVerify expectedLength={summary.length} expectedHead={summary.headHash} command={mirrorCommand(origin)} nodeCommand={mirrorCommandNode(origin)} />
          </Card>

          <Card title="Read it from the RabbitOS CloudShell">
            <p className="text-xs text-muted mb-2">The ledger is public with full payloads. With an approved shell.execute grant, the CloudShell can read it directly:</p>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-md border border-line p-3">{cloudshellCommand(origin)}</pre>
          </Card>

          <Card title="Latest 50 events" flush>
            <Table head={['seq', 'table', 'op', 'row_id', 'hash', 'payload']} empty="No events yet.">
              {summary.latest.map((e) => (
                <tr key={e.seq}>
                  <Td mono>{e.seq}</Td>
                  <Td mono>{e.table}</Td>
                  <Td><Badge tone={e.op === 'delete' ? 'bad' : e.op === 'update' ? 'warn' : 'ok'}>{e.op}</Badge></Td>
                  <Td mono className="max-w-[16rem] break-all">{short(e.row_id, 40)}</Td>
                  <Td mono><span title={e.hash}>{short(e.hash, 12)}</span></Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">{e.op === 'delete' ? 'tombstone' : 'show'}</summary>
                      <pre className="mt-2 max-w-xl overflow-x-auto text-xs font-mono whitespace-pre-wrap break-all">{JSON.stringify({ prev_hash: e.prev_hash, hash: e.hash, payload: e.payload }, null, 2)}</pre>
                    </details>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
