import Link from 'next/link'
import { Badge } from '@/components/ui'
import { BODY_ROUTES, GENE_BODY, ORGANS, ORGAN_IDS, genesIn, organStates, routesTo, type OrganId } from '@/lib/body'
import { SCENARIO_INFO, SYSTEM_INFO, type ScenarioId, type SystemId } from '@/lib/neuro'
import { GENE_COUNTS } from '@/lib/neuro-genes'

const tone = { established: 'ok', supported: 'info', exploratory: 'warn' } as const

/**
 * The body half of the Brain Network view: which organs the chosen pathway or damage scenario reaches, how the brain
 * gets there, and which genes act in each organ. Genes link to the Chemistry map and, where guide candidates exist, to the CRISPR Explorer.
 */
export default function BodyPanel({ system, scenario, organ, onOrgan, onShowBody, crisprGenes }: {
  system: SystemId | 'none'
  scenario: ScenarioId
  organ: OrganId | null
  onOrgan: (o: OrganId | null) => void
  onShowBody: () => void
  crisprGenes: string[]
}) {
  const states = organStates(system, scenario)
  const hit = ORGAN_IDS.filter((o) => states[o].level > 0).sort((a, b) => states[b].level - states[a].level)
  const sel = organ ? ORGANS[organ] : null
  const what = [system !== 'none' ? SYSTEM_INFO[system].name.split(' (')[0] : null, scenario !== 'healthy' ? SCENARIO_INFO[scenario].name.split(':')[0] : null].filter(Boolean).join(' + ')

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Body: where the brain reaches</h3>
        <button onClick={onShowBody} className="ml-auto text-xs rounded-full border border-line px-3 py-0.5 hover:border-accent hover:text-accent">View whole body</button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Organs">
        {ORGAN_IDS.map((o) => (
          <button key={o} onClick={() => onOrgan(organ === o ? null : o)} aria-pressed={organ === o}
            className={`text-xs rounded-full border px-2.5 py-0.5 ${organ === o ? 'border-accent text-accent bg-accent-soft' : states[o].level > 0 ? 'border-bad/50 text-fg' : 'border-line text-muted hover:text-fg'}`}>
            {ORGANS[o].name.split(' (')[0].replace(' and visual pathway', '').replace(' and immune system', '')}
          </button>
        ))}
      </div>

      {hit.length === 0 && !sel && (
        <p className="text-xs text-muted">Choose a chemical pathway or a damage overlay above and the organs it reaches light up here and on the body. Click an organ to see how the brain reaches it and which genes act there.</p>
      )}

      {hit.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">Reached by {what}</p>
          {hit.map((o) => (
            <div key={o}>
              <button onClick={() => onOrgan(o)} className="font-medium hover:text-accent">{ORGANS[o].name}</button>{' '}
              {states[o].evidence && <Badge tone={tone[states[o].evidence!]}>{states[o].evidence}</Badge>}
              {states[o].reasons.map((r, i) => <p key={i} className="text-xs text-muted mt-0.5">{r.source === 'scenario' ? 'Damage: ' : 'Pathway: '}{r.text}</p>)}
            </div>
          ))}
        </div>
      )}

      {sel && organ && (
        <div className="border-t border-line pt-3 space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: sel.color }}>{sel.name}</h3>
          <p>{sel.text}</p>
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
        Schematic body, not to scale, and textbook-level patterns only. It shows where a brain change can reach, not what will happen to any person. Not medical advice.
      </p>
    </div>
  )
}
