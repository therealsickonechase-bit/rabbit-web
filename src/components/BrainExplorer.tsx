'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Brain3D, { rampColor, type ElectrodeView } from '@/components/Brain3D'
import { BANDS, BAND_HZ, dominantBand, electrodePosition, latestByChannel, regionOf, type Band, type EegSample } from '@/lib/brain'

export interface RecordRef { id: string; source: string; title: string; url: string | null }
export interface GraphData {
  /** "kind:name" -> record ids */
  mentions: Record<string, string[]>
  records: Record<string, RecordRef>
  edges: { a: string; b: string; records: string[] }[]
}
export interface ChemRef { name: string; unit: string; mean: number; sd: number; cls: string }

const CHANNELS_FALLBACK = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2']
const hex = (c: { getHexString: () => string }) => `#${c.getHexString()}`

export default function BrainExplorer({ initial, graph, chemicals }: { initial: EegSample[]; graph: GraphData; chemicals: ChemRef[] }) {
  const [samples, setSamples] = useState<EegSample[]>(initial)
  const [band, setBand] = useState<Band>('alpha')
  const [selected, setSelected] = useState<string | null>(null)
  const [spin, setSpin] = useState(true)
  const [live, setLive] = useState<'live' | 'stale' | 'error'>('stale')
  const [lastAt, setLastAt] = useState<string | null>(initial[0]?.ts ?? null)
  const [similar, setSimilar] = useState(true)
  const [now, setNow] = useState(0)

  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/brain/live', { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const d = (await r.json()) as { samples: EegSample[] }
      setSamples(d.samples)
      setNow(Date.now())
      const newest = d.samples[0]?.ts ?? null
      setLastAt(newest)
      setLive(newest && Date.now() - new Date(newest).getTime() < 15_000 ? 'live' : 'stale')
    } catch {
      setLive('error')
    }
  }, [])
  useEffect(() => {
    const t0 = setTimeout(poll, 0)
    const id = setInterval(poll, 2000)
    return () => { clearTimeout(t0); clearInterval(id) }
  }, [poll])

  const latest = useMemo(() => latestByChannel(samples), [samples])
  const names = useMemo(() => (latest.size ? [...latest.keys()] : CHANNELS_FALLBACK), [latest])

  const electrodes: ElectrodeView[] = useMemo(() => {
    const out: ElectrodeView[] = []
    for (const n of names) {
      const p = electrodePosition(n)
      if (!p) continue
      const e = latest.get(p.name)?.[band]
      out.push({ name: p.name, x: p.x, y: p.y, z: p.z, level: e ? (e.rel ?? null) : null })
    }
    return out
  }, [names, latest, band])

  // "Similar level" lines: electrodes whose relative power in this band is within 0.03 of each other.
  // This is a display of similarity, NOT a measurement of connectivity (that needs coherence/phase).
  const links = useMemo(() => {
    if (!similar) return []
    const withData = electrodes.filter((e) => e.level != null)
    const pairs: [string, string][] = []
    for (let i = 0; i < withData.length; i++) {
      for (let j = i + 1; j < withData.length; j++) {
        if (Math.abs(withData[i].level! - withData[j].level!) <= 0.03) pairs.push([withData[i].name, withData[j].name])
      }
    }
    return pairs.slice(0, 60)
  }, [electrodes, similar])

  const sel = selected ? latest.get(selected) : undefined
  const region = selected ? regionOf(selected) : null
  const recs = (key: string) => (graph.mentions[key] ?? []).map((id) => graph.records[id]).filter(Boolean)
  const relevant = [...(region ? recs(`region:${region}`) : []), ...recs(`band:${band}`)]
  const uniqueRelevant = [...new Map(relevant.map((r) => [r.id, r])).values()].slice(0, 6)
  const age = lastAt && now ? Math.max(0, Math.round((now - new Date(lastAt).getTime()) / 1000)) : null

  return (
    <div className="grid xl:grid-cols-[1fr_340px] gap-4">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Band">
          {BANDS.map((b) => (
            <button key={b} onClick={() => setBand(b)} aria-pressed={band === b}
              className={`text-xs rounded-full border px-3 py-1 ${band === b ? 'border-accent text-accent bg-accent-soft' : 'border-line text-muted hover:text-fg'}`}>
              {b} <span className="opacity-70">{BAND_HZ[b]}</span>
            </button>
          ))}
          <span className="flex-1" />
          <label className="text-xs text-muted flex items-center gap-1"><input type="checkbox" checked={similar} onChange={(e) => setSimilar(e.target.checked)} /> similar-level lines</label>
          <label className="text-xs text-muted flex items-center gap-1"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> rotate</label>
          <span className={`text-xs rounded border px-2 py-0.5 ${live === 'live' ? 'text-ok border-ok/40' : live === 'error' ? 'text-bad border-bad/40' : 'text-muted border-line'}`} role="status">
            {live === 'live' ? `live · ${age}s ago` : live === 'error' ? 'feed error' : lastAt ? `no new data · ${age}s ago` : 'waiting for a headset'}
          </span>
        </div>

        <Brain3D electrodes={electrodes} selected={selected} onSelect={setSelected} spin={spin} links={links} />

        <div className="flex items-center gap-2 text-xs text-muted" aria-hidden>
          <span>low</span>
          <span className="h-2 w-40 rounded" style={{ background: `linear-gradient(90deg, ${hex(rampColor(0))}, ${hex(rampColor(0.5))}, ${hex(rampColor(1))})` }} />
          <span>high share of {band} power</span>
          <span className="ml-3">grey = no data</span>
        </div>
        <p className="text-xs text-muted">
          Schematic head and brain with electrodes at approximate international 10-20 positions. It is not an MRI-based model, and the colours show band power at the scalp, not activity at a particular spot in the brain.
        </p>
      </div>

      <aside className="space-y-4 text-sm" aria-live="polite">
        <section className="bg-surface border border-line rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">{selected ? `${selected} · ${region}` : 'Select an electrode'}</h3>
          {!selected && <p className="text-muted text-xs">Click a dot on the brain, or start the bridge to see live data.</p>}
          {selected && !sel && <p className="text-muted text-xs">No data from this channel yet.</p>}
          {sel && (
            <div className="space-y-1.5">
              {BANDS.map((b) => {
                const v = sel[b]?.rel ?? 0
                return (
                  <div key={b} className="flex items-center gap-2 text-xs">
                    <span className="w-12">{b}</span>
                    <span className="flex-1 h-2 bg-canvas rounded overflow-hidden"><span className="block h-full" style={{ width: `${Math.round(v * 100)}%`, background: hex(rampColor(v)) }} /></span>
                    <span className="w-9 text-right font-mono">{Math.round(v * 100)}%</span>
                  </div>
                )
              })}
              <p className="text-xs text-muted pt-1">Dominant: <strong>{dominantBand(sel) ?? '—'}</strong></p>
            </div>
          )}
        </section>

        <section className="bg-surface border border-line rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Research that mentions {region ? `${region} + ` : ''}{band}</h3>
          {uniqueRelevant.length === 0 ? (
            <p className="text-xs text-muted">No stored records mention this yet. The agents have EEG topics queued; links appear as they find papers.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {uniqueRelevant.map((r) => (
                <li key={r.id}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{r.title}</a> : r.title}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-surface border border-line rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Chemistry (reference ranges)</h3>
          <ul className="space-y-1 text-xs">
            {chemicals.filter((c) => c.cls === 'NEUROTRANSMITTER' || c.cls === 'HORMONE').map((c) => {
              const n = (graph.mentions[`chemical:${c.name}`] ?? []).length
              return (
                <li key={c.name} className="flex justify-between gap-2">
                  <span className="capitalize">{c.name}</span>
                  <span className="text-muted font-mono">{+(c.mean - c.sd).toFixed(2)}–{+(c.mean + c.sd).toFixed(2)} {c.unit}{n ? ` · ${n} paper${n > 1 ? 's' : ''}` : ''}</span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted mt-2">No measured values yet, only the twin&apos;s reference bands.</p>
        </section>
      </aside>
    </div>
  )
}
