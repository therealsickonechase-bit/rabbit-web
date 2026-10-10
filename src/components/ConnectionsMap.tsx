'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui'
import { BAND_TEXT, COND_IDS, EDGES, GENE_SYSTEMS, GRAPH_SYSTEM_OF, MAP_COLUMNS, MAP_HEIGHT, NODE_LABEL, SCENARIO_INFO, SYSTEM_INFO, connectedEdges, edgePath, mapNodes, type Evidence } from '@/lib/neuro'
import { GENE_COUNTS, GENE_COUNTS_DATE } from '@/lib/neuro-genes'
import { geneLinks, identifiersFor } from '@/lib/gene-ids'

export interface GeneExample { title: string; cls: string | null; url: string }
const DASH: Record<Evidence, string | undefined> = { established: undefined, supported: '7 5', exploratory: '2 5' }
const TONE = { established: 'ok', supported: 'info', exploratory: 'warn' } as const
const SCENARIO_OF: Record<string, string> = { stroke: 'stroke', tbi: 'tbi', epilepsy: 'epilepsy', alzheimer: 'alz' }

export default function ConnectionsMap({ examples, papers, initial, isOwner, ask }: {
  examples: Record<string, GeneExample[]>
  papers: Record<string, number>
  initial: string | null
  isOwner: boolean
  ask: (formData: FormData) => Promise<void>
}) {
  const nodes = useMemo(() => mapNodes(), [])
  const [sel, setSel] = useState<string | null>(initial && nodes[initial] ? initial : null)
  const hotEdges = new Set<number>(), hot = new Set<string>()
  if (sel) { hot.add(sel); EDGES.forEach((e, i) => { if (e[0] === sel || e[1] === sel) { hot.add(e[0]); hot.add(e[1]); hotEdges.add(i) } }) }
  const node = sel ? nodes[sel] : null
  const list = sel ? connectedEdges(EDGES, sel) : []

  return (
    <div className="grid xl:grid-cols-[1fr_380px] gap-4 items-start">
      <section className="bg-surface border border-line rounded-lg min-w-0">
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold">Connection map</h2>
          <button onClick={() => setSel(null)} className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent">Clear selection</button>
        </header>
        <div className="p-4 overflow-x-auto">
          <svg viewBox={`0 0 900 ${MAP_HEIGHT}`} className="w-full h-auto min-w-[780px]" role="group" aria-label="Map linking genes, chemical systems, EEG patterns and damage. Select any box.">
            {MAP_COLUMNS.map((c) => <text key={c.title} x={c.x} y={26} textAnchor="middle" fontSize={12} fontWeight={600} className="fill-muted">{c.title}</text>)}
            {EDGES.map((e, i) => {
              const d = edgePath(nodes, e[0], e[1]); if (!d) return null
              const on = hotEdges.has(i), dim = sel && !on
              return <path key={i} d={d} fill="none" className={on ? 'stroke-accent' : 'stroke-muted'} strokeWidth={on ? 2.2 : 1} strokeOpacity={on ? 0.95 : dim ? 0.06 : 0.28} strokeDasharray={DASH[e[2]]} />
            })}
            {Object.values(nodes).map((n) => {
              const on = hot.has(n.id), dim = sel && !on, picked = n.id === sel, gene = n.kind === 'gene', c = GENE_COUNTS[n.id]
              const w = gene ? 76 : 150, h = gene ? 17 : 26
              return (
                <g key={n.id} tabIndex={0} role="button" aria-label={n.label} aria-pressed={picked} style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1 }}
                  onClick={() => setSel(picked ? null : n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(n.id) } }}>
                  <rect x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} rx={gene ? 4 : 6} className={gene ? 'fill-canvas' : 'fill-surface'} strokeWidth={picked ? 2.5 : 1.2}
                    stroke={picked ? 'var(--accent)' : on ? 'var(--fg)' : 'var(--line)'} />
                  <text x={n.x - (gene && c ? 6 : 0)} y={n.y + 4} textAnchor="middle" fontSize={gene ? 10.5 : 12} className="fill-fg" style={{ pointerEvents: 'none', fontFamily: gene ? 'var(--font-mono)' : undefined }}>{n.label}</text>
                  {c && <text x={n.x + w / 2 - 4} y={n.y + 4} textAnchor="end" fontSize={9} className="fill-muted" style={{ fontFamily: 'var(--font-mono)' }}>{c.pathogenic_or_likely >= 1000 ? `${(c.pathogenic_or_likely / 1000).toFixed(1)}k` : c.pathogenic_or_likely}</text>}
                </g>
              )
            })}
          </svg>
          <div className="flex flex-wrap gap-4 text-xs text-muted mt-2">
            {(['established', 'supported', 'exploratory'] as const).map((t) => (
              <span key={t} className="flex items-center gap-1"><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" strokeWidth="2" strokeDasharray={DASH[t]} className="stroke-muted" /></svg>{t}</span>
            ))}
            <span>number in a gene box = harmful variants in ClinVar ({GENE_COUNTS_DATE})</span>
          </div>
        </div>
      </section>

      <section className="bg-surface border border-line rounded-lg" aria-live="polite">
        <header className="px-4 py-3 border-b border-line"><h2 className="text-sm font-semibold">{node ? node.label : 'How to read this'}</h2></header>
        <div className="p-4 space-y-3 text-sm">
          {!node && <p className="text-xs text-muted">Select any box to see what it connects to and why. Lines: solid = established, dashed = supported, dotted = exploratory.</p>}
          {node?.kind === 'gene' && <GeneCard id={node.id} examples={examples[node.id] ?? []} papers={papers[node.id] ?? 0} ask={ask} />}
          {node?.kind === 'system' && (
            <>
              {GRAPH_SYSTEM_OF[node.id] && <p>{SYSTEM_INFO[GRAPH_SYSTEM_OF[node.id]].text}</p>}
              {node.id === 'melatonin' && <p>Made by the pineal gland in the dark; it signals night to the body clock and helps set sleep timing.</p>}
              <Chips label="Genes that act here:" ids={Object.keys(GENE_COUNTS).filter((g) => (GENE_SYSTEMS[GENE_COUNTS[g].system] ?? []).includes(node.id))} onPick={setSel} />
              {isOwner && GRAPH_SYSTEM_OF[node.id] && <Link href="/brain" className="inline-block text-xs rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-accent">Show this pathway on the 3D brain</Link>}
            </>
          )}
          {node?.kind === 'eeg' && <p>{BAND_TEXT[node.id]}</p>}
          {node?.kind === 'cond' && COND_IDS.includes(node.id) && (
            <>
              <p>{SCENARIO_INFO[SCENARIO_OF[node.id] as keyof typeof SCENARIO_INFO].text}</p>
              <Chips label="Genes:" ids={SCENARIO_INFO[SCENARIO_OF[node.id] as keyof typeof SCENARIO_INFO].genes} onPick={setSel} />
              {isOwner && <Link href="/brain" className="inline-block text-xs rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-accent">Show this on the 3D brain (damage overlay)</Link>}
            </>
          )}
          {list.length > 0 && (
            <div className="space-y-2">
              <p className="font-medium">Connections</p>
              {list.map((e, i) => {
                const other = e[0] === sel ? e[1] : e[0], dir = e[0] === sel ? '→' : '←'
                return (
                  <div key={i}>
                    <Badge tone={TONE[e[2]]}>{e[2]}</Badge>{' '}
                    <button onClick={() => setSel(other)} className="text-xs rounded-full border border-line px-2.5 py-0.5 hover:border-accent hover:text-accent">{dir} {NODE_LABEL[other] ?? other}</button>
                    <p className="text-xs text-muted mt-0.5">{e[3]}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )

  function Chips({ label, ids, onPick }: { label: string; ids: string[]; onPick: (id: string) => void }) {
    if (!ids.length) return null
    return <p><span className="font-medium">{label}</span> {ids.map((g) => <button key={g} onClick={() => onPick(g)} className="text-xs rounded-full border border-line px-2.5 py-0.5 mr-1 hover:border-accent hover:text-accent">{g}</button>)}</p>
  }
}

function GeneCard({ id, examples, papers, ask }: { id: string; examples: GeneExample[]; papers: number; ask: (fd: FormData) => Promise<void> }) {
  const c = GENE_COUNTS[id]
  return (
    <div className="space-y-3">
      <p>{c.role.charAt(0).toUpperCase() + c.role.slice(1)}.</p>
      {(() => {
        const ids = identifiersFor(id)
        if (!ids) return null
        const l = geneLinks(ids)
        return (
          <p className="text-xs text-muted" title={ids.source}>
            {ids.name}, {ids.cytoband}. Also known as {ids.synonyms.slice(0, 4).join(', ')}. Records:{' '}
            <a className="underline" href={l.ncbi_gene} target="_blank" rel="noopener noreferrer">NCBI Gene {ids.ncbi_gene_id}</a>,{' '}
            <a className="underline" href={l.omim} target="_blank" rel="noopener noreferrer">OMIM {ids.omim}</a>,{' '}
            <a className="underline" href={l.ensembl} target="_blank" rel="noopener noreferrer">Ensembl</a>,{' '}
            <a className="underline" href={l.uniprot} target="_blank" rel="noopener noreferrer">UniProt {ids.uniprot}</a>. Transcript {ids.refseq_transcript}.
          </p>
        )
      })()}
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-line rounded-md p-2"><p className="text-xs text-muted">ClinVar variants</p><p className="font-mono text-lg">{c.variants.toLocaleString()}</p></div>
        <div className="border border-line rounded-md p-2"><p className="text-xs text-muted">Pathogenic or likely</p><p className="font-mono text-lg">{c.pathogenic_or_likely.toLocaleString()}</p></div>
      </div>
      <p className="text-xs text-muted">Counts are real, from ClinVar ({GENE_COUNTS_DATE}). They describe how many DNA changes in this gene have been reported and classed as harmful; they say nothing about any one person. Some counts include large deletions that cover several genes.</p>
      {examples.length > 0
        ? <div className="space-y-1.5"><p className="font-medium">Example changes stored in RabbitOS</p>{examples.map((e) => <p key={e.url}>{e.cls && <Badge tone={/pathogenic/i.test(e.cls) ? 'bad' : 'muted'}>{e.cls}</Badge>} <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{e.title}</a></p>)}</div>
        : <p className="text-xs text-muted">No single-gene example is stored: this gene&apos;s harmful entries in ClinVar are mostly large deletions that cover other genes too.</p>}
      <p><strong>{papers}</strong> stored paper{papers === 1 ? '' : 's'} mention this gene.</p>
      <form action={ask}><input type="hidden" name="gene" value={id} /><button className="rounded-md bg-accent text-white text-sm font-medium px-3 py-2 hover:opacity-90">Ask the agents to research {id}</button></form>
    </div>
  )
}
