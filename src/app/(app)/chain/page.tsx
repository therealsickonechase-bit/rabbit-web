import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_BATCH, MIN_BATCH, merkleRoot } from '@/lib/merkle'
import { createClient } from '@/lib/supabase/server'
import { requireOwner } from '@/lib/auth/session'
import { Badge, Card, PageHeader, Table, Td, short, when } from '@/components/ui'

async function sealBatch() {
  'use server'
  const owner = await requireOwner()
  const admin = createAdminClient()
  const last = await admin.from('merkle_batches').select('to_seq').order('to_seq', { ascending: false }).limit(1).maybeSingle()
  const from = last.data ? Number(last.data.to_seq) + 1 : 0
  const rows = await admin.from('audit_entries').select('seq, hash').gte('seq', from).order('seq').limit(MAX_BATCH)
  const list = rows.data ?? []
  // Only a gap-free run can be sealed: stop at the first missing sequence number.
  let n = 0
  while (n < list.length && Number(list[n].seq) === from + n) n++
  if (n < MIN_BATCH) redirect('/chain?sealed=few')
  const batch = list.slice(0, n)
  const root = await merkleRoot(batch.map((e) => e.hash))
  const ins = await admin.from('merkle_batches').insert({ from_seq: from, to_seq: from + n - 1, leaf_count: n, root, sealed_by: owner.id })
  redirect(ins.error ? '/chain?sealed=error' : '/chain?sealed=ok')
}

export default async function ChainPage({ searchParams }: { searchParams: Promise<{ chain?: string; sealed?: string }> }) {
  await requireOwner()
  const { chain = 'network', sealed } = await searchParams
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
  const admin = createAdminClient()
  const batchRes = await admin.from('merkle_batches').select('id, from_seq, to_seq, leaf_count, root, created_at, anchor_tx').order('id', { ascending: false }).limit(10)
  const batches = await Promise.all((batchRes.data ?? []).map(async (b) => {
    const hs = await admin.from('audit_entries').select('seq, hash').gte('seq', b.from_seq).lte('seq', b.to_seq).order('seq')
    const hashes = (hs.data ?? []).map((e) => e.hash)
    const ok = hashes.length === b.leaf_count && (await merkleRoot(hashes)) === b.root
    return { ...b, ok }
  }))
  const lastTo = batchRes.data?.[0]?.to_seq
  const pending = await admin.from('audit_entries').select('seq', { count: 'exact', head: true }).gt('seq', lastTo ?? -1)
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
          title="Merkle batches"
          action={
            <form action={sealBatch}>
              <button className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent">Seal next batch ({pending.count ?? 0} waiting)</button>
            </form>
          }
          flush
        >
          {sealed && (
            <p role="status" className={`text-sm px-4 py-2 border-b border-line ${sealed === 'ok' ? 'text-ok' : 'text-bad'}`}>
              {sealed === 'ok' ? 'Batch sealed.' : sealed === 'few' ? `Need at least ${MIN_BATCH} consecutive unsealed audit entries.` : 'Could not seal the batch.'}
            </p>
          )}
          <Table head={['Batch', 'Entries', 'Root', 'Recomputed', 'Sealed', 'Ledger']} empty="No batches sealed yet.">
            {batches.map((b) => (
              <tr key={b.id}>
                <Td mono>#{b.id}</Td>
                <Td mono>{b.from_seq}–{b.to_seq} ({b.leaf_count})</Td>
                <Td mono>{short(b.root, 20)}</Td>
                <Td><Badge tone={b.ok ? 'ok' : 'bad'}>{b.ok ? 'matches' : 'DIFFERS'}</Badge></Td>
                <Td mono className="whitespace-nowrap">{when(b.created_at)}</Td>
                <Td>{b.anchor_tx ? <span className="font-mono text-xs">{short(b.anchor_tx, 14)}</span> : <Badge tone="muted">not anchored</Badge>}</Td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted px-4 py-3 border-t border-line">
            Each batch is a Merkle tree over consecutive audit entries. Only the root needs publishing; a short proof shows one entry belongs to it
            (<code className="font-mono">/api/public/proof?seq=N</code>). &ldquo;Recomputed&rdquo; rebuilds the root from the stored entries now, so any later change to an entry shows as DIFFERS.
          </p>
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
