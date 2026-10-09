import Link from 'next/link'
import { Badge } from '@/components/ui'
import { EDGES, EEG_IDS, GENE_IDS, NODE_LABEL, SCENARIO_INFO, SYSTEM_GENE_KEYS, SYSTEM_INFO, type ScenarioId, type SystemId } from '@/lib/neuro'
import { GENE_COUNTS } from '@/lib/neuro-genes'

const tone = { established: 'ok', supported: 'info', exploratory: 'warn' } as const

/** Explains the chosen chemical pathway and damage scenario: what it is, which genes act in it, and what it does to the EEG. */
export default function PathwayPanel({ system, scenario }: { system: SystemId | 'none'; scenario: ScenarioId }) {
  const sc = SCENARIO_INFO[scenario]
  const ids = system === 'thalamocortical' ? ['GABA', 'glutamate'] : system === 'hpa' ? ['cortisol'] : system === 'none' ? [] : [system]
  const genes = system === 'none' ? [] : GENE_IDS.filter((g) => SYSTEM_GENE_KEYS[system].includes(GENE_COUNTS[g].system))
  const effects = EDGES.filter((e) => ids.includes(e[0]) && EEG_IDS.includes(e[1]))

  return (
    <div className="space-y-3 text-sm">
      {system !== 'none' && (
        <>
          <h3 className="text-sm font-semibold" style={{ color: SYSTEM_INFO[system].color }}>{SYSTEM_INFO[system].name}</h3>
          <p>{SYSTEM_INFO[system].text}</p>
          <p className="text-xs text-muted">Glowing dots show the direction of release{system === 'thalamocortical' ? ' (both directions here)' : ''}. Positions and routes are simplified.</p>
          <p>
            <span className="font-medium">Genes in this system</span> <span className="text-xs text-muted">(number = harmful variants listed in ClinVar)</span><br />
            <span className="flex flex-wrap gap-1.5 mt-1">
              {genes.map((g) => (
                <Link key={g} href={`/connections?n=${g}`} className="text-xs rounded-full border border-line px-2.5 py-0.5 hover:border-accent hover:text-accent">
                  {g} · {GENE_COUNTS[g].pathogenic_or_likely.toLocaleString()}
                </Link>
              ))}
            </span>
          </p>
          {effects.length > 0 && (
            <div className="space-y-2">
              <p className="font-medium">What it does to the EEG</p>
              {effects.map((e) => (
                <div key={`${e[0]}-${e[1]}`}>
                  <Badge tone={tone[e[2]]}>{e[2]}</Badge> {NODE_LABEL[e[0]]} → <strong>{NODE_LABEL[e[1]]}</strong>
                  <p className="text-xs text-muted mt-0.5">{e[3]}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {scenario !== 'healthy' && (
        <>
          <h3 className="text-sm font-semibold text-bad">{sc.name}</h3>
          <p>{sc.text}</p>
          <p><span className="font-medium">Typical EEG:</span> {sc.typical}</p>
          {sc.systems.length > 0 && <p><span className="font-medium">Chemistry involved:</span> {sc.systems.join('; ')}</p>}
          {sc.genes.length > 0 && (
            <p><span className="font-medium">Genes:</span>{' '}
              {sc.genes.map((g) => <Link key={g} href={`/connections?n=${g}`} className="text-xs rounded-full border border-line px-2.5 py-0.5 mr-1 hover:border-accent hover:text-accent">{g}</Link>)}
            </p>
          )}
          <p className="text-xs text-muted">Red marks the damaged tissue. A pathway that passes through it stops there (grey dashes); a pathway weakened across the brain is drawn thinner and dimmer, with fewer pulses. This overlay is an illustration: it does not change the live EEG on the head.</p>
        </>
      )}
      {system === 'none' && scenario === 'healthy' && (
        <p className="text-xs text-muted">Choose a chemical pathway to see its routes through the brain, then a damage scenario to see what it interrupts and how the EEG typically changes. For the full map of genes, chemicals and EEG patterns, open Chemistry &amp; DNA.</p>
      )}
      <p className="text-xs text-muted border-t border-line pt-2">Illustrative textbook patterns on a schematic brain. Nothing here comes from a person, and an EEG alone cannot diagnose a condition.</p>
    </div>
  )
}
