import { requireViewer, viewerClient } from '@/lib/auth/session'
import BrainExplorer, { type ChemRef, type GraphData } from '@/components/BrainExplorer'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, short } from '@/components/ui'
import { buildLinks, type EegSample, type Term } from '@/lib/brain'
import { primaryGene } from '@/lib/twin-stats'
import { autoRestoreIfEmpty } from '@/lib/chain-ledger-db'
import RestoreButton from '@/components/RestoreButton'

const label = (t: Term) => `${t.kind}: ${t.name}`

export default async function BrainPage() {
  await requireViewer()
  await autoRestoreIfEmpty('eeg_band_samples')
  const sb = await viewerClient()

  const [eeg, total, chem, recs, agents] = await Promise.all([
    sb.from('eeg_band_samples').select('channel, band, power, rel_power, ts').order('ts', { ascending: false }).limit(400),
    sb.from('eeg_band_samples').select('id', { count: 'exact', head: true }),
    sb.from('chemo_baselines').select('chemical_name, chemical_class, unit, baseline_mean, baseline_stddev'),
    sb.from('research_records').select('id, source, title, url, meta').limit(3000),
    sb.from('agents').select('node_id, kind, last_seen_at').order('last_seen_at', { ascending: false }),
  ])

  const chemicals: ChemRef[] = (chem.data ?? []).map((c) => ({ name: c.chemical_name, unit: c.unit, mean: c.baseline_mean, sd: c.baseline_stddev, cls: c.chemical_class }))
  const records = recs.data ?? []
  const genes = [...new Set(records.map((r) => primaryGene((r.meta as Record<string, unknown> | null)?.gene)).filter((g) => g !== 'UNKNOWN'))]
  const links = buildLinks(records.map((r) => ({ id: r.id, source: r.source, title: r.title, meta: r.meta as Record<string, unknown> | null })), { chemicals: chemicals.map((c) => c.name), genes })

  const byId = new Map(records.map((r) => [r.id, r]))
  const wanted = new Set<string>()
  for (const ids of links.mentions.values()) ids.slice(0, 12).forEach((i) => wanted.add(i))
  const graph: GraphData = {
    mentions: Object.fromEntries([...links.mentions].map(([k, ids]) => [k, ids.slice(0, 12)])),
    records: Object.fromEntries([...wanted].filter((id) => byId.has(id)).map((id) => { const r = byId.get(id)!; return [id, { id, source: r.source, title: r.title, url: r.url }] })),
    edges: links.edges.slice(0, 40).map((e) => ({ a: `${e.a.kind}:${e.a.name}`, b: `${e.b.kind}:${e.b.name}`, records: e.records })),
  }

  // genes that have CRISPR guide candidates stored, so the body view can link them to the CRISPR Explorer
  const crisprGenes = [...new Set(records.filter((r) => r.source === 'crispr_guide').map((r) => String((r.meta as Record<string, unknown> | null)?.gene ?? '')).filter(Boolean))]

  const initial = (eeg.data ?? []) as EegSample[]
  const streaming = new Set(initial.map((s) => s.channel)).size
  const eegAgents = (agents.data ?? []).filter((a) => a.kind === 'network_node' && a.node_id.startsWith('eeg-'))

  return (
    <>
      <PageHeader title="Brain Network" sub="Live EEG from OpenBCI / BrainFlow, with the research and chemistry connected to it" />
      <div className="space-y-6">
        <p role="note" className="text-sm rounded-md border border-warn/40 text-warn px-3 py-2">
          Research and visualisation only, not a medical device and not for diagnosis. EEG is neural data: use it on yourself or with the wearer&apos;s informed consent.
          Only band powers are stored (never raw waveforms), the stored samples are visible to everyone, and samples older than 30 days can be purged.
        </p>

        {!(total.count ?? 0) && <RestoreButton back="/brain" what="The EEG sample store" />}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Channels streaming" value={streaming} sub="in the newest samples" tone={streaming ? 'ok' : 'warn'} />
          <Stat label="Samples stored" value={total.count ?? 0} />
          <Stat label="Linked research terms" value={links.mentions.size} sub={`${links.edges.length} co-mention links`} />
          <Stat label="EEG bridges" value={eegAgents.length} sub="agents named eeg-…" />
        </div>

        <Card>
          <BrainExplorer initial={initial} graph={graph} chemicals={chemicals} crisprGenes={crisprGenes} storedEeg />
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="How the pieces are connected" flush>
            <Table head={['Term A', 'Term B', 'Records mentioning both']} empty="No co-mentions yet. The agents are searching EEG, neurotransmitter and gene topics; links appear as papers are stored.">
              {links.edges.slice(0, 12).map((e) => (
                <tr key={`${label(e.a)}|${label(e.b)}`}>
                  <Td>{label(e.a)}</Td><Td>{label(e.b)}</Td>
                  <Td mono>{e.records.length}</Td>
                </tr>
              ))}
            </Table>
            <p className="text-xs text-muted px-4 py-3 border-t border-line">
              A link means stored research titles mention both terms together. It is a pointer to papers to read, not evidence that one causes the other.
            </p>
          </Card>

          <Card title="Software and network: who is feeding this" flush>
            <Table head={['Agent', 'Kind', 'Last seen']} empty="No agents have connected.">
              {(agents.data ?? []).slice(0, 10).map((a) => (
                <tr key={a.node_id}>
                  <Td mono>{short(a.node_id, 22)}</Td>
                  <Td><Badge tone={a.node_id.startsWith('eeg-') ? 'accent' : 'muted'}>{a.node_id.startsWith('eeg-') ? 'EEG bridge' : a.kind}</Badge></Td>
                  <Td>{ago(a.last_seen_at)}</Td>
                </tr>
              ))}
            </Table>
            <p className="text-xs text-muted px-4 py-3 border-t border-line">
              Start a bridge with <code className="font-mono">python brainflow_bridge.py</code> (synthetic board) or <code className="font-mono">--board cyton --serial-port COM3</code>. Each write is signed and recorded.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
