import Link from 'next/link'
import { requireViewer, viewerClient } from '@/lib/auth/session'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, short, when } from '@/components/ui'
import { VariantBars, ZChart, classSwatch } from '@/components/charts'
import { VARIANT_CLASSES, bandShares, groupVariants, isConcerning, linearTrend, primaryGene, variantClass } from '@/lib/twin-stats'

const HOUR = 3600 * 1000
const clinvarUrl = (id: unknown) => (id ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(String(id))}/` : null)

export default async function TwinAtlasPage() {
  await requireViewer()
  const sb = await viewerClient()

  const [twin, baselines, readings, variants, edits, dna, anchors, blocks, audit, runs, topics, sources] = await Promise.all([
    sb.from('twin_identity').select('id, is_sealed, biological_hash, sealed_at').limit(1).maybeSingle(),
    sb.from('chemo_baselines').select('chemical_name, chemical_class, unit, baseline_mean, baseline_stddev').order('chemical_class').order('chemical_name'),
    sb.from('mesh_node_readings').select('timestamp, deviation_z, band').not('deviation_z', 'is', null).order('timestamp').limit(1000),
    sb.from('research_records').select('id, title, meta').eq('source', 'clinvar').limit(1000),
    sb.from('crispr_guide_registry').select('id', { count: 'exact', head: true }),
    sb.from('dna_storage_records').select('id', { count: 'exact', head: true }),
    sb.from('xrpl_memo_anchors').select('id', { count: 'exact', head: true }),
    sb.from('chain_blocks').select('hash', { count: 'exact', head: true }),
    sb.from('audit_entries').select('seq, hash, prev_hash, ts').order('seq', { ascending: false }).limit(200),
    sb.from('research_runs').select('agent_id, cycle, new_ids_found, started_at, research_topics(topic, biomarker)').order('started_at', { ascending: false }).limit(8),
    sb.from('research_topics').select('topic, biomarker, status, discovered_by'),
    sb.from('research_records').select('source').limit(5000),
  ])

  // --- Live readings vs their baseline, with a straight-line trend ---------------------------------
  const rows = (readings.data ?? []).filter((r) => typeof r.deviation_z === 'number')
  const t0 = rows.length ? new Date(rows[0].timestamp).getTime() : 0
  const pts = rows.map((r) => ({ t: new Date(r.timestamp).getTime(), z: Number(r.deviation_z) }))
  const trend = linearTrend(pts.map((p) => ({ x: (p.t - t0) / HOUR, y: p.z })))
  const spanH = pts.length ? (pts[pts.length - 1].t - t0) / HOUR : 0
  const shares = bandShares(pts.map((p) => p.z))
  const endZ = trend ? trend.intercept + trend.slope * spanH : null
  const projZ = trend ? trend.intercept + trend.slope * (spanH * 2) : null

  // --- Gene variants from the literature (reference data, not the twin's genotype) -----------------
  const vrows = variants.data ?? []
  const genes = groupVariants(vrows)
  const flagged = vrows.filter((v) => isConcerning(v.meta?.classification))
  const missing = (n: number | null) => (n ?? 0) === 0

  // --- Integrity ------------------------------------------------------------------------------------
  const entries = audit.data ?? []
  let intact = true
  for (let i = 0; i < entries.length - 1; i++) if (entries[i].prev_hash !== entries[i + 1].hash) intact = false
  const latestAudit = entries[0]

  const counts = new Map<string, number>()
  for (const r of sources.data ?? []) counts.set(r.source, (counts.get(r.source) ?? 0) + 1)
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v)

  return (
    <>
      <PageHeader title="Twin Atlas" sub="Live data, research and proof in one view — owner only">
        <Link href="/chain" className="text-sm rounded-md border border-line px-3 py-1 hover:bg-canvas">Chain &amp; Audit</Link>
      </PageHeader>

      <div className="space-y-6">
        <p role="note" className="text-sm rounded-md border border-warn/40 text-warn px-3 py-2">
          Research and engineering view, not medical advice. No personal DNA sequence is stored for the twin yet, so the gene panel below
          shows <strong>published reference variants</strong> for the genes under research, not the twin&apos;s own genotype.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Twin" value={twin.data?.is_sealed ? 'Sealed' : 'Open'} sub={short(twin.data?.biological_hash, 14)} tone={twin.data?.is_sealed ? 'ok' : 'warn'} />
          <Stat label="Live readings" value={pts.length} sub={pts.length ? `latest ${ago(rows[rows.length - 1].timestamp)}` : 'none'} />
          <Stat label="Within ±1 SD" value={`${shares.pct('within')}%`} sub="of readings vs baseline" tone={shares.pct('within') >= 68 ? 'ok' : 'warn'} />
          <Stat label="Reference variants" value={vrows.length} sub={`${flagged.length} flagged`} tone={flagged.length ? 'warn' : 'ok'} />
          <Stat label="Chain proof" value={intact ? 'Intact' : 'Broken'} sub={`${entries.length} audit entries checked`} tone={intact ? 'ok' : 'bad'} />
        </div>

        <Card title="1 · Live readings compared with the twin's baseline">
          <ZChart points={pts} trend={trend} projectMs={Math.max(spanH, 1) * HOUR} />
          <div className="grid sm:grid-cols-3 gap-3 mt-4 text-sm">
            <div><p className="text-xs text-muted">Where it should be</p><p>z between −1 and +1 (at baseline = 0). −2 to +2 is the watch band.</p></div>
            <div>
              <p className="text-xs text-muted">Trend</p>
              <p>{trend ? <>{trend.slope >= 0 ? 'Rising' : 'Falling'} {Math.abs(trend.slope).toFixed(3)} SD per hour; z ≈ {endZ?.toFixed(2)} now.</> : 'Needs at least 3 readings.'}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Straight-line projection (same window ahead)</p>
              <p>{projZ == null ? '—' : <>z ≈ {projZ.toFixed(2)} <Badge tone={Math.abs(projZ) <= 1 ? 'ok' : Math.abs(projZ) <= 2 ? 'warn' : 'bad'}>{Math.abs(projZ) <= 1 ? 'stays near baseline' : Math.abs(projZ) <= 2 ? 'drifts into watch band' : 'leaves reference range'}</Badge></>}</p>
            </div>
          </div>
          <p className="text-xs text-muted mt-3">
            The projection extends a fitted line; it is not a forecast of health. Source: mesh_node_readings.deviation_z. Bands: {shares.counts.within} within, {shares.counts.watch} watch, {shares.counts.outside} outside.
          </p>
        </Card>

        <Card title="2 · Reference chemistry the twin is compared against" flush>
          <Table head={['Chemical', 'Class', 'Baseline', '±1 SD (68%)', '±2 SD (95%)', 'Unit']} empty="No baselines.">
            {(baselines.data ?? []).map((b) => (
              <tr key={b.chemical_name}>
                <Td className="capitalize">{b.chemical_name}</Td>
                <Td><Badge tone="muted">{b.chemical_class}</Badge></Td>
                <Td mono>{b.baseline_mean}</Td>
                <Td mono>{+(b.baseline_mean - b.baseline_stddev).toFixed(3)} – {+(b.baseline_mean + b.baseline_stddev).toFixed(3)}</Td>
                <Td mono>{+(b.baseline_mean - 2 * b.baseline_stddev).toFixed(3)} – {+(b.baseline_mean + 2 * b.baseline_stddev).toFixed(3)}</Td>
                <Td>{b.unit}</Td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted px-4 py-3 border-t border-line">
            No measured values for these chemicals are stored yet, so they cannot be placed on the scale. The convergence cortisol is a normalised gate value and is deliberately not compared with these laboratory units.
          </p>
        </Card>

        <Card title="3 · DNA: what the research flags (reference variants by gene)">
          <VariantBars genes={genes} order={VARIANT_CLASSES} />
          <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted">
            {VARIANT_CLASSES.map((c) => <span key={c} className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm ${classSwatch[c]}`} />{c}</span>)}
          </div>
          <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-md border border-line p-3">
              <p className="text-xs text-muted mb-1">What was wrong (in the literature)</p>
              {flagged.length === 0 ? <p>No pathogenic or likely pathogenic variants among the stored records.</p> : (
                <ul className="space-y-2">
                  {flagged.map((v) => (
                    <li key={v.id}>
                      <Badge tone={variantClass(v.meta?.classification) === 'Pathogenic' ? 'bad' : 'warn'}>{variantClass(v.meta?.classification)}</Badge>{' '}
                      <a href={clinvarUrl(v.meta?.clinvar_id) ?? '#'} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{v.title}</a>
                      <span className="text-xs text-muted"> · {primaryGene(v.meta?.gene)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md border border-line p-3">
              <p className="text-xs text-muted mb-1">Where it needs to be, and the edit</p>
              <p>The reference state for each gene is no pathogenic variant. A planned edit is shown here as: reference sequence → variant → edited sequence, with the guide, the cut site and the protein effect.</p>
              <p className="mt-2">
                Edits recorded: <strong>{edits.count ?? 0}</strong> · Twin DNA records: <strong>{dna.count ?? 0}</strong>
                {missing(dna.count) && <span className="text-muted"> — add a sequence to compare it with these references (the data vault and CRISPR simulator are the next steps).</span>}
              </p>
            </div>
          </div>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="4 · Agents: where each record came from" flush>
            <Table head={['Source', 'Records']} empty="No records.">
              {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <tr key={k}><Td>{k}</Td><Td mono>{n}</Td></tr>
              ))}
            </Table>
            <Table head={['Agent', 'Cycle', 'Topic', 'New', 'Run']} empty="No runs yet.">
              {(runs.data ?? []).map((r) => {
                const t = one(r.research_topics)
                return (
                  <tr key={`${r.agent_id}-${r.cycle}`}>
                    <Td mono>{short(r.agent_id, 18)}</Td><Td mono>{r.cycle}</Td>
                    <Td>{t ? `${t.topic}${t.biomarker ? ` · ${t.biomarker}` : ''}` : '—'}</Td>
                    <Td mono>{r.new_ids_found}</Td><Td>{ago(r.started_at)}</Td>
                  </tr>
                )
              })}
            </Table>
          </Card>

          <Card title="5 · Proof: how the data is tied to the chain">
            <dl className="space-y-3 text-sm">
              <div><dt className="text-xs text-muted">Audit trail</dt>
                <dd><Badge tone={intact ? 'ok' : 'bad'}>{intact ? 'Hash links intact' : 'Link broken'}</Badge> {entries.length} newest entries re-checked. Latest: <span className="font-mono text-xs">{short(latestAudit?.hash, 20)}</span> {latestAudit && `· ${when(latestAudit.ts)}`}</dd></div>
              <div><dt className="text-xs text-muted">Chain blocks</dt><dd className="font-mono">{blocks.count ?? 0}</dd></div>
              <div><dt className="text-xs text-muted">XRP Ledger anchors</dt>
                <dd>{missing(anchors.count) ? <Badge tone="muted">None yet</Badge> : <Badge tone="ok">{anchors.count}</Badge>}{' '}
                  Anchors hold only a hash of a record or an approval, never names, sequences or health values.</dd></div>
              <div><dt className="text-xs text-muted">Research topics</dt>
                <dd>{(topics.data ?? []).filter((t) => t.status === 'explored').length} explored · {(topics.data ?? []).filter((t) => t.status === 'queued').length} queued</dd></div>
            </dl>
            <p className="text-xs text-muted mt-4">
              Each agent write is signed on arrival, recorded in the audit trail, and chained to the entry before it. Anchoring a hash to the ledger lets anyone holding the original record prove it was not changed.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
