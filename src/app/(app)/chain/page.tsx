import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge, Card, PageHeader, Table, Td, short, when } from '@/components/ui'

export default async function ChainPage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const { chain = 'network' } = await searchParams
  const isMaxwell = chain === 'maxwell'
  const sb = await createClient()

  const [blocks, audit, genesis] = await Promise.all([
    sb
      .from('chain_blocks')
      .select('*')
      .eq('chain', chain)
      .order(isMaxwell ? 'height' : 'mined_at', { ascending: false })
      .limit(25),
    sb.from('audit_entries').select('*').order('seq', { ascending: false }).limit(50),
    isMaxwell
      ? sb.from('chain_blocks').select('payload, hash').eq('chain', 'maxwell').eq('height', 0).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Re-check the hash links of the window we loaded (newest first -> compare each to the one below it).
  const entries = audit.data ?? []
  let intact = true
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i].prev_hash !== entries[i + 1].hash) intact = false
  }

  // Same check for the Maxwell chain: every block's previous_hash must be the hash of the block below it.
  const rows = blocks.data ?? []
  let linked = true
  if (isMaxwell) {
    for (let i = 0; i < rows.length - 1; i++) if (rows[i].prev_hash !== rows[i + 1].hash) linked = false
  }
  const anchor = genesis.data?.payload as { anchor_sha256?: string; anchor_verified?: boolean } | null

  return (
    <>
      <PageHeader title="Chain & Audit" sub="Mined blocks and the tamper-evident audit trail" />

      <div className="space-y-6">
        <Card
          title="Audit trail"
          action={
            entries.length > 1 ? (
              <Badge tone={intact ? 'ok' : 'bad'}>{intact ? `Chain intact · ${entries.length} entries checked` : 'Chain broken'}</Badge>
            ) : undefined
          }
          flush
        >
          <Table head={['Seq', 'Time', 'Module', 'Action', 'Hash', 'Prev']} empty="No audit entries yet.">
            {entries.map((e) => (
              <tr key={e.seq}>
                <Td mono>{e.seq}</Td>
                <Td mono className="whitespace-nowrap">{when(e.ts)}</Td>
                <Td>{e.module}</Td>
                <Td>{e.action}</Td>
                <Td mono>{short(e.hash, 12)}</Td>
                <Td mono>{short(e.prev_hash, 12)}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card
          title="Blocks"
          action={
            <div className="flex gap-2">
              <ChainTab href="/chain" active={!isMaxwell} label="Network" />
              <ChainTab href="/chain?chain=maxwell" active={isMaxwell} label="Maxwell" />
            </div>
          }
          flush
        >
          {isMaxwell && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 border-b border-line text-sm">
              <span className="text-muted">Genesis anchor</span>
              {anchor ? (
                <>
                  <Badge tone={anchor.anchor_verified ? 'ok' : 'bad'}>{anchor.anchor_verified ? 'Verified' : 'Not verified'}</Badge>
                  <span className="font-mono text-xs break-all">{anchor.anchor_sha256}</span>
                  <span className="text-xs text-muted">SHA-256 of &ldquo;hello world&rdquo;</span>
                </>
              ) : (
                <span className="text-muted">No Maxwell chain synced yet.</span>
              )}
              {rows.length > 1 && <Badge tone={linked ? 'ok' : 'bad'}>{linked ? 'Links intact' : 'Links broken'}</Badge>}
            </div>
          )}
          {isMaxwell ? (
            <Table head={['Height', 'Hash', 'Prev', 'Kind', 'Mined']} empty="No Maxwell blocks yet. Run python maxwellblockchain.py --save, then rabbit_sync.py.">
              {rows.map((b) => (
                <tr key={b.block_id}>
                  <Td mono>{b.height}</Td>
                  <Td mono>{short(b.hash, 16)}</Td>
                  <Td mono>{short(b.prev_hash, 12)}</Td>
                  <Td>{b.source}</Td>
                  <Td mono className="whitespace-nowrap">{when(b.mined_at)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Table head={['Block', 'Node', 'Source', 'DAS', 'Mined']} empty="No blocks yet.">
              {rows.map((b) => (
                <tr key={b.block_id}>
                  <Td mono>{short(b.block_id.split(':').pop(), 20)}</Td>
                  <Td mono>{short(b.node_id, 10)}</Td>
                  <Td>{b.source}</Td>
                  <Td mono>{b.das_score != null ? Number(b.das_score).toFixed(2) : '—'}</Td>
                  <Td mono className="whitespace-nowrap">{when(b.mined_at)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}

function ChainTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`text-xs rounded-full border px-3 py-1 ${active ? 'border-accent text-accent bg-accent-soft' : 'border-line text-muted hover:text-fg'}`}
    >
      {label}
    </Link>
  )
}
