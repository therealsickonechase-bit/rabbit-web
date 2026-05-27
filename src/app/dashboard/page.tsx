import { createAdminClient } from '@/lib/supabase/admin'
import AutoRefresh from '@/components/AutoRefresh'

async function getData() {
  const sb = createAdminClient()

  const [{ data: twin }, { data: tokens }, { data: nodes }, { data: readings }, { data: anchors }] =
    await Promise.all([
      sb.from('twin_identity').select('*').limit(1).single(),
      sb.from('convergence_tokens').select('*').order('minted_at', { ascending: false }).limit(5),
      sb.from('sdr_node_profiles').select('*').limit(50),
      sb.from('mesh_node_readings').select('*').order('recorded_at', { ascending: false }).limit(10),
      sb.from('xrpl_memo_anchors').select('*').order('anchored_at', { ascending: false }).limit(5),
    ])

  return { twin, tokens: tokens ?? [], nodes: nodes ?? [], readings: readings ?? [], anchors: anchors ?? [] }
}

function StatCard({ label, value, sub, accent = 'green' }: {
  label: string
  value: string | number
  sub?: string
  accent?: 'green' | 'yellow' | 'red' | 'blue' | 'purple'
}) {
  const colors = {
    green:  'text-emerald-400 border-emerald-900',
    yellow: 'text-yellow-400 border-yellow-900',
    red:    'text-red-400 border-red-900',
    blue:   'text-cyan-400 border-cyan-900',
    purple: 'text-purple-400 border-purple-900',
  }
  return (
    <div className={`border rounded-lg p-4 bg-zinc-900 ${colors[accent]}`}>
      <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${colors[accent].split(' ')[0]}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

function Badge({ tier }: { tier: string }) {
  const map: Record<string, string> = {
    EXISTENTIAL: 'bg-red-950 text-red-300 border border-red-800',
    CRITICAL:    'bg-orange-950 text-orange-300 border border-orange-800',
    HIGH:        'bg-yellow-950 text-yellow-300 border border-yellow-800',
    LOW:         'bg-emerald-950 text-emerald-300 border border-emerald-800',
    MINIMAL:     'bg-zinc-800 text-zinc-400 border border-zinc-700',
  }
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded ${map[tier] ?? map.MINIMAL}`}>
      {tier}
    </span>
  )
}

function truncate(s: string, n = 20) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export default async function DashboardPage() {
  const { twin, tokens, nodes, readings, anchors } = await getData()
  const latest = tokens[0] ?? null

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-emerald-400">Rabbit</span>OS
          </h1>
          <p className="text-xs text-zinc-500 font-mono mt-0.5">
            Digital Twin Dashboard — {twin?.subject_name ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <AutoRefresh intervalMs={30_000} />
          <span className="text-xs text-zinc-400 font-mono uppercase tracking-widest">LIVE</span>
        </div>
      </div>

      {/* Twin Identity */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Twin Identity</h2>
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Subject</p>
            <p className="font-semibold">{twin?.subject_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Date of Birth</p>
            <p className="font-mono text-sm">{twin?.subject_dob ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Sealed</p>
            <p className={twin?.is_sealed ? 'text-emerald-400' : 'text-yellow-400'}>
              {twin?.is_sealed ? 'Yes' : 'No'}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Biological Hash</p>
            <p className="font-mono text-xs text-zinc-400 truncate">
              {twin?.biological_hash ? truncate(twin.biological_hash, 24) : '—'}
            </p>
          </div>
        </div>
      </section>

      {/* Convergence State */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
          Convergence Gate
          {latest && (
            <span className="ml-3 text-zinc-600 normal-case">
              minted {new Date(latest.minted_at).toLocaleString()}
            </span>
          )}
        </h2>
        {latest ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <StatCard
                label="Valence"
                value={latest.valence?.toFixed(2) ?? '—'}
                sub="F3/F4 FAA"
                accent={latest.valence >= 0 ? 'green' : 'yellow'}
              />
              <StatCard
                label="Arousal"
                value={latest.arousal?.toFixed(2) ?? '—'}
                sub="θ/α ratio"
                accent={latest.arousal > 0.6 ? 'red' : 'green'}
              />
              <StatCard
                label="GSR Δφ"
                value={latest.gsr_delta_phi?.toFixed(3) ?? '—'}
                sub={latest.gsr_delta_phi > 0.05 ? '▲ above threshold' : '▽ below threshold'}
                accent={latest.gsr_delta_phi > 0.05 ? 'yellow' : 'blue'}
              />
              <StatCard
                label="Cortisol"
                value={`${latest.cortisol_ng_ml?.toFixed(2) ?? '—'} ng/mL`}
                sub={latest.cortisol_ng_ml > 0.75 ? '▲ gate FIRED' : '▽ below threshold'}
                accent={latest.cortisol_ng_ml > 0.75 ? 'red' : 'green'}
              />
            </div>
            <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs text-zinc-500 mb-1">Access Tier</p>
                <Badge tier={latest.access_tier} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-500 mb-1">State Hash</p>
                <p className="font-mono text-xs text-zinc-400 truncate">{latest.state_hash}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Gate Status</p>
                {latest.cortisol_ng_ml > 0.75 && latest.gsr_delta_phi > 0.05 && latest.arousal > 0.6
                  ? <span className="text-xs text-red-400 font-mono">FIRED</span>
                  : <span className="text-xs text-emerald-400 font-mono">IDLE</span>
                }
              </div>
            </div>
          </>
        ) : (
          <div className="border border-zinc-800 rounded-xl p-6 bg-zinc-900 text-zinc-600 text-sm">
            No convergence tokens yet.
          </div>
        )}
      </section>

      {/* Mesh Nodes + Readings */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <section>
          <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">RF Mesh Nodes</h2>
          {nodes.length > 0 ? (
            <div className="space-y-2">
              {nodes.map((n: Record<string, unknown>, i: number) => (
                <div key={i} className="border border-zinc-800 rounded-lg p-3 bg-zinc-900 flex justify-between items-center">
                  <span className="font-mono text-sm">Node {String(n.node_id)}</span>
                  <span className="text-xs text-cyan-400 font-mono">{String(n.carrier_freq_ghz)} GHz</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-zinc-800 rounded-xl p-6 bg-zinc-900 text-zinc-600 text-sm text-center">
              0 nodes registered
              <p className="text-xs mt-1">Populate sdr_node_profiles to see mesh</p>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Recent Readings</h2>
          {readings.length > 0 ? (
            <div className="space-y-2">
              {readings.map((r: Record<string, unknown>, i: number) => (
                <div key={i} className="border border-zinc-800 rounded-lg p-3 bg-zinc-900 text-xs font-mono flex justify-between">
                  <span className="text-zinc-500">{String(r.recorded_at ?? '').slice(0, 19)}</span>
                  <span className="text-emerald-400">HR {String(r.heart_rate_bpm ?? '—')} bpm</span>
                  <span className="text-cyan-400">GSR {String(r.gsr_microsiemens ?? '—')} µS</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-zinc-800 rounded-xl p-6 bg-zinc-900 text-zinc-600 text-sm text-center">
              0 readings
              <p className="text-xs mt-1">Populate mesh_node_readings to see biometrics</p>
            </div>
          )}
        </section>
      </div>

      {/* XRPL Anchors */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">XRPL Memo Anchors</h2>
        {anchors.length > 0 ? (
          <div className="space-y-2">
            {anchors.map((a: Record<string, unknown>, i: number) => (
              <div key={i} className="border border-zinc-800 rounded-lg p-3 bg-zinc-900 flex items-center gap-4">
                <span className="text-xs text-zinc-500 font-mono">{String(a.anchored_at ?? '').slice(0, 19)}</span>
                <span className="font-mono text-xs text-purple-400 truncate flex-1">{String(a.memo_hash ?? '—')}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-zinc-800 rounded-xl p-6 bg-zinc-900 text-zinc-600 text-sm text-center">
            0 XRPL anchors
            <p className="text-xs mt-1">Blockchain anchoring not yet active</p>
          </div>
        )}
      </section>

      {/* Footer */}
      <div className="border-t border-zinc-800 pt-4 flex justify-between text-xs text-zinc-600 font-mono">
        <span>twin: ef5eb8ab</span>
        <span>supabase: ludxbakxpmdqhfgdenwp</span>
        <span>© RabbitOS</span>
      </div>
    </main>
  )
}
