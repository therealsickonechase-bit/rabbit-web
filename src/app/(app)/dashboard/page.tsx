import { createClient } from '@/lib/supabase/server'
import { Badge, Card, PageHeader, Stat, Table, Td, short, when } from '@/components/ui'

const GATE = { cortisol: 0.75, gsr: 0.05, arousal: 0.6 }

const tierTone = { EXISTENTIAL: 'bad', CRITICAL: 'bad', HIGH: 'warn', LOW: 'ok', MINIMAL: 'muted' } as const

export default async function OverviewPage() {
  const sb = await createClient()
  const [twin, tokens, nodes, readings, anchors] = await Promise.all([
    sb.from('twin_identity').select('*').limit(1).maybeSingle(),
    sb.from('convergence_tokens').select('*').order('minted_at', { ascending: false }).limit(1),
    sb.from('sdr_node_profiles').select('*').order('node_id').limit(50),
    sb.from('mesh_node_readings').select('*').order('timestamp', { ascending: false }).limit(10),
    sb.from('xrpl_memo_anchors').select('*').order('anchored_at', { ascending: false }).limit(5),
  ])

  const t = twin.data
  const latest = tokens.data?.[0]
  const fired = latest && latest.cortisol_ng_ml > GATE.cortisol && latest.gsr_delta_phi > GATE.gsr && latest.arousal > GATE.arousal

  return (
    <>
      <PageHeader title="Overview" sub={`Digital twin${t?.subject_name ? ` — ${t.subject_name}` : ''}`} />

      <div className="space-y-6">
        <Card title="Twin identity">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><dt className="text-xs text-muted">Subject</dt><dd className="font-medium">{t?.subject_name ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted">Date of birth</dt><dd className="font-mono">{t?.subject_dob ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted">Sealed</dt><dd><Badge tone={t?.is_sealed ? 'ok' : 'warn'}>{t?.is_sealed ? 'Sealed' : 'Not sealed'}</Badge></dd></div>
            <div><dt className="text-xs text-muted">Biological hash</dt><dd className="font-mono text-xs">{short(t?.biological_hash, 24)}</dd></div>
          </dl>
        </Card>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Convergence gate</h2>
            {latest && <span className="text-xs text-muted">minted {when(latest.minted_at)}</span>}
          </div>
          {latest ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Valence" value={Number(latest.valence).toFixed(2)} sub="F3/F4 FAA" tone={latest.valence >= 0 ? 'ok' : 'warn'} />
                <Stat label="Arousal" value={Number(latest.arousal).toFixed(2)} sub={`gate > ${GATE.arousal}`} tone={latest.arousal > GATE.arousal ? 'bad' : 'ok'} />
                <Stat label="GSR Δφ" value={Number(latest.gsr_delta_phi).toFixed(3)} sub={`gate > ${GATE.gsr}`} tone={latest.gsr_delta_phi > GATE.gsr ? 'warn' : 'info'} />
                <Stat label="Cortisol" value={`${Number(latest.cortisol_ng_ml).toFixed(2)}`} sub={`ng/mL · gate > ${GATE.cortisol}`} tone={latest.cortisol_ng_ml > GATE.cortisol ? 'bad' : 'ok'} />
              </div>
              <Card>
                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <div><p className="text-xs text-muted mb-1">Access tier</p><Badge tone={tierTone[latest.access_tier as keyof typeof tierTone] ?? 'muted'}>{latest.access_tier}</Badge></div>
                  <div><p className="text-xs text-muted mb-1">Gate</p><Badge tone={fired ? 'bad' : 'ok'}>{fired ? 'Fired' : 'Idle'}</Badge></div>
                  <div className="min-w-0 flex-1"><p className="text-xs text-muted mb-1">State hash</p><p className="font-mono text-xs truncate">{latest.state_hash}</p></div>
                </div>
              </Card>
            </div>
          ) : (
            <Card><p className="text-sm text-muted">No convergence tokens yet.</p></Card>
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card title={`RF mesh nodes (${nodes.data?.length ?? 0})`} flush>
            <Table head={['Node', 'Carrier', 'PRF', 'Sources', 'Status']} empty="No nodes registered.">
              {(nodes.data ?? []).map((n) => (
                <tr key={n.id}>
                  <Td mono>#{n.node_id}</Td>
                  <Td mono>{n.carrier_freq_ghz} GHz</Td>
                  <Td mono>{n.prf_hz} Hz</Td>
                  <Td>{(n.reflection_sources ?? []).join(', ') || '—'}</Td>
                  <Td><Badge tone={n.is_active ? 'ok' : 'muted'}>{n.is_active ? 'Active' : 'Idle'}</Badge></Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Recent readings" flush>
            <Table head={['Time', 'Node', 'Band', 'Amp µV', 'Vascular']} empty="No readings yet.">
              {(readings.data ?? []).map((r) => (
                <tr key={r.id}>
                  <Td mono className="whitespace-nowrap">{when(r.timestamp)}</Td>
                  <Td mono>#{r.node_id}</Td>
                  <Td>{r.band ?? '—'}</Td>
                  <Td mono>{r.amplitude_uv ?? '—'}</Td>
                  <Td>{r.vasc_state ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <Card title="XRPL anchors" flush>
          <Table head={['Anchored', 'Type', 'Transaction', 'Ledger', 'Tier']} empty="Nothing anchored to the XRP Ledger yet.">
            {(anchors.data ?? []).map((a) => (
              <tr key={a.id}>
                <Td mono className="whitespace-nowrap">{when(a.anchored_at)}</Td>
                <Td>{a.payload_type ?? '—'}</Td>
                <Td mono>{short(a.xrpl_txn_hash, 20)}</Td>
                <Td mono>{a.xrpl_ledger_index ?? '—'}</Td>
                <Td>{a.access_tier ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  )
}
