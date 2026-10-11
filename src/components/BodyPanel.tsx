import type { MutableRefObject } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import VitalsTrace from '@/components/VitalsTrace'
import type { Layers, ViewName } from '@/components/Brain3D'
import { SUPPLY } from '@/lib/anatomy'
import { BODY_ROUTES, GENE_BODY, ORGANS, ORGAN_IDS, genesIn, organStates, routesTo, type OrganId } from '@/lib/body'
import { PATHWAY_BARS, pathwayLevel, readings, type Physio } from '@/lib/body-physiology'
import { SCENARIO_INFO, SYSTEM_INFO, type ScenarioId, type SystemId } from '@/lib/neuro'
import { GENE_COUNTS } from '@/lib/neuro-genes'

const tone = { established: 'ok', supported: 'info', exploratory: 'warn' } as const
const flagClass = { normal: 'text-ok', raised: 'text-warn', lowered: 'text-warn', abnormal: 'text-bad' } as const

const LAYER_LABELS: [keyof Layers, string][] = [['skin', 'skin outline'], ['skeleton', 'bones'], ['organs', 'organs'], ['vessels', 'blood vessels'], ['nerves', 'nerves and spinal cord'], ['muscles', 'limb muscles'], ['labels', 'labels']]
const VIEW_LABELS: [ViewName, string][] = [['body', 'whole body'], ['chest', 'chest'], ['abdomen', 'abdomen'], ['spine', 'spine and cord (back)']]

/** Two circles for the two visual fields; a missing half means that half of the view is lost in both eyes. */
function VisualField({ physio }: { physio: Physio }) {
  const lostLeft = 1 - physio.visual.rightBrain, lostRight = 1 - physio.visual.leftBrain
  if (lostLeft < 0.2 && lostRight < 0.2) return null
  return (
    <div className="flex items-center gap-3">
      <svg width="170" height="84" viewBox="0 0 170 84" role="img" aria-label="What each eye sees, with the lost half of the view darkened">
        {[0, 1].map((eye) => (
          <g key={eye} transform={`translate(${eye * 86},0)`}>
            <circle cx="41" cy="42" r="38" className="fill-canvas stroke-line" />
            <path d="M41 4 A38 38 0 0 0 41 80 Z" fill="currentColor" opacity={lostLeft * 0.85} className="text-bad" />
            <path d="M41 4 A38 38 0 0 1 41 80 Z" fill="currentColor" opacity={lostRight * 0.85} className="text-bad" />
            <circle cx="41" cy="42" r="3" className="fill-fg" />
          </g>
        ))}
      </svg>
      <p className="text-xs text-muted">Both eyes work, but the damaged visual cortex cannot receive the {lostLeft > lostRight ? 'left' : 'right'} half of what each eye sees (shown in red). This is called a homonymous hemianopia.</p>
    </div>
  )
}

/**
 * The body half of the Brain Network view: live vitals and traces, how strongly each pathway through the cord is carrying signals, which organs the
 * chosen pathway or damage reaches, how the brain reaches each organ (with spinal levels), and the genes that act there.
 */
export default function BodyPanel({ system, scenario, organ, onOrgan, onView, crisprGenes, physio, physioRef, layers, onLayers }: {
  system: SystemId | 'none'
  scenario: ScenarioId
  organ: OrganId | null
  onOrgan: (o: OrganId | null) => void
  onView: (v: ViewName) => void
  crisprGenes: string[]
  physio: Physio
  physioRef: MutableRefObject<Physio>
  layers: Layers
  onLayers: (l: Layers) => void
}) {
  const states = organStates(system, scenario)
  const hit = ORGAN_IDS.filter((o) => states[o].level > 0).sort((a, b) => states[b].level - states[a].level)
  const sel = organ ? ORGANS[organ] : null
  const supply = organ ? SUPPLY[organ] : undefined
  const what = [system !== 'none' ? SYSTEM_INFO[system].name.split(' (')[0] : null, scenario !== 'healthy' ? SCENARIO_INFO[scenario].name.split(':')[0] : null].filter(Boolean).join(' + ')
  const rows = readings(physio)

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Body: how the brain and spinal cord reach the organs</h3>
        <span className="ml-auto flex flex-wrap gap-1.5" role="group" aria-label="Body camera views">
          {VIEW_LABELS.map(([v, label]) => <button key={v} onClick={() => onView(v)} className="text-xs rounded-full border border-line px-3 py-0.5 hover:border-accent hover:text-accent">{label}</button>)}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" role="group" aria-label="Body layers">
        <label className="flex items-center gap-1"><input type="checkbox" checked={layers.body} onChange={(e) => onLayers({ ...layers, body: e.target.checked })} /> body</label>
        {LAYER_LABELS.map(([k, label]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={layers[k]} onChange={(e) => onLayers({ ...layers, [k]: e.target.checked })} /> {label}</label>)}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Organs">
        {ORGAN_IDS.map((o) => (
          <button key={o} onClick={() => onOrgan(organ === o ? null : o)} aria-pressed={organ === o}
            className={`text-xs rounded-full border px-2.5 py-0.5 ${organ === o ? 'border-accent text-accent bg-accent-soft' : states[o].level > 0 ? 'border-bad/50 text-fg' : 'border-line text-muted hover:text-fg'}`}>
            {ORGANS[o].name.split(' (')[0].replace(' and visual pathway', '').replace(' and immune system', '').replace(' (arms and legs)', '')}
          </button>
        ))}
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h4 className="font-medium">Live body readings</h4>
            <span className="text-xs text-muted">{scenario === 'epilepsy' ? `seizure cycle: ${physio.phase}` : scenario === 'healthy' ? 'healthy baseline' : SCENARIO_INFO[scenario].name}</span>
          </div>
          <VitalsTrace physio={physioRef} />
          <table className="w-full text-xs">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line/60 align-top">
                  <td className="py-1 pr-2 text-muted">{r.label}</td>
                  <td className={`py-1 pr-2 font-medium ${flagClass[r.flag]}`}>{r.value}</td>
                  <td className="py-1 hidden md:table-cell text-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">Illustrative textbook values for the pattern shown, not measurements from anyone. They move with the animation (the seizure cycle repeats every 18 seconds).</p>
          <VisualField physio={physio} />
        </section>

        <section className="space-y-3">
          <h4 className="font-medium">Signals through the spinal cord and nerves</h4>
          <p className="text-xs text-muted">Each bar is how much of the normal signal gets through. Below 100% the pathway is drawn greyer and sparser in 3D; above it, brighter and faster. A red marker shows where the damage sits.</p>
          <ul className="space-y-1.5">
            {PATHWAY_BARS.map((b) => {
              const lv = pathwayLevel(physio, b.id), pct = Math.round(lv * 100)
              return (
                <li key={b.id} className="text-xs">
                  <div className="flex justify-between gap-2"><span>{b.label}</span><span className={`font-mono ${lv < 0.8 ? 'text-bad' : lv > 1.2 ? 'text-warn' : 'text-ok'}`}>{pct}%</span></div>
                  <div className="h-1.5 rounded bg-canvas overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, pct / 1.6)}%`, background: lv < 0.8 ? 'var(--bad)' : lv > 1.2 ? 'var(--warn)' : 'var(--ok)' }} /></div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {hit.length === 0 && !sel && (
        <p className="text-xs text-muted">Choose a chemical pathway or a damage overlay above and the organs it reaches light up here and on the body. Click any organ, in the list above or in the 3D view, to see how the brain reaches it, the spinal levels that supply it, and the genes that act there.</p>
      )}

      {hit.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">Reached by {what}</p>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
            {hit.map((o) => (
              <div key={o}>
                <button onClick={() => onOrgan(o)} className="font-medium hover:text-accent">{ORGANS[o].name}</button>{' '}
                {states[o].evidence && <Badge tone={tone[states[o].evidence!]}>{states[o].evidence}</Badge>}
                {states[o].reasons.map((r, i) => <p key={i} className="text-xs text-muted mt-0.5">{r.source === 'scenario' ? 'Damage: ' : 'Pathway: '}{r.text}</p>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {sel && organ && (
        <div className="border-t border-line pt-3 space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: sel.color }}>{sel.name}</h3>
          <p>{sel.text}</p>
          {supply && (
            <div className="rounded-md border border-line p-3 text-xs space-y-1">
              <p className="font-medium text-sm">Nerve supply <Badge tone={tone[supply.evidence]}>{supply.evidence}</Badge></p>
              {supply.sympathetic && <p><span className="text-muted">Sympathetic (fight or flight):</span> cord segments {supply.sympathetic[0]} to {supply.sympathetic[1]}, out through the sympathetic chain.</p>}
              <p><span className="text-muted">Parasympathetic / motor:</span> {supply.parasympathetic}</p>
              {supply.sensory && <p><span className="text-muted">Sensation returns at:</span> {supply.sensory}</p>}
              <p className="text-muted">{supply.note}</p>
            </div>
          )}
          <p className="font-medium">How the brain reaches it</p>
          <ul className="space-y-1.5">
            {routesTo(organ).map((r) => (
              <li key={r} className="text-xs"><span className="font-medium" style={{ color: BODY_ROUTES[r].color }}>{BODY_ROUTES[r].name}</span> <Badge tone={tone[BODY_ROUTES[r].evidence]}>{BODY_ROUTES[r].evidence}</Badge>
                <span className="block text-muted">From {BODY_ROUTES[r].from}. {BODY_ROUTES[r].text}</span></li>
            ))}
          </ul>
          {genesIn(organ).length > 0 && (
            <div>
              <p className="font-medium">Genes that act here</p>
              <p className="text-xs text-muted">Number = harmful variants listed in ClinVar. A gene with a CRISPR tag also has guide candidates in the CRISPR Explorer.</p>
              <ul className="mt-1 space-y-1.5">
                {genesIn(organ).map((g) => (
                  <li key={g} className="text-xs">
                    <Link href={`/connections?n=${g}`} className="rounded-full border border-line px-2.5 py-0.5 hover:border-accent hover:text-accent">{g} · {GENE_COUNTS[g].pathogenic_or_likely.toLocaleString()}</Link>{' '}
                    {crisprGenes.includes(g) && <Link href="/crispr" className="rounded-full border border-accent/50 text-accent px-2 py-0.5 hover:bg-accent-soft">CRISPR guides</Link>}{' '}
                    <Badge tone={tone[GENE_BODY[g].evidence]}>{GENE_BODY[g].evidence}</Badge>
                    <span className="block text-muted mt-0.5">{GENE_BODY[g].text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted border-t border-line pt-2">
        Anatomical positions follow standard teaching references (vertebral levels, rib spaces, cord segments); shapes are drawn procedurally and the brain is enlarged next to the body. Patterns are textbook-level and illustrative.
        They show where a brain change can reach and how that typically looks, not what will happen to any person. Not medical advice.
      </p>
    </div>
  )
}
