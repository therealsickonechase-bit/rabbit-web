'use client'

import { useMemo, useState } from 'react'
import { GUIDE_LEN, applyEdit, validBases, type Edit } from '@/lib/crispr-sim'

export interface GuideChoice {
  id: string
  gene: string
  transcript: string
  strand: string
  position: number
  guide: string
  pam: string
  gc: number
  score: number
  window: string
  offset: number
}

function Row({ label, text, offset, cut, del, ins }: {
  label: string; text: string; offset: number; cut: number
  del?: { start: number; end: number }; ins?: { start: number; end: number }
}) {
  return (
    <div className="flex items-baseline gap-3 overflow-x-auto">
      <span className="text-xs text-muted w-16 shrink-0">{label}</span>
      <code className="font-mono text-sm whitespace-pre tracking-wider">
        {text.split('').map((ch, i) => {
          const inGuide = i >= offset && i < offset + GUIDE_LEN
          const inPam = i >= offset + GUIDE_LEN && i < offset + GUIDE_LEN + 3
          const isDel = del && i >= del.start && i < del.end
          const isIns = ins && i >= ins.start && i < ins.end
          const cls = isDel ? 'text-bad line-through' : isIns ? 'text-ok font-bold' : inPam ? 'text-warn font-bold' : inGuide ? 'text-accent' : 'text-muted'
          return (
            <span key={i}>
              {i === cut && <span className="text-info" title="Cas9 cuts here" aria-label="cut site">✂</span>}
              <span className={cls}>{ch}</span>
            </span>
          )
        })}
      </code>
    </div>
  )
}

export default function GuideEditor({ guides }: { guides: GuideChoice[] }) {
  const [id, setId] = useState(guides[0]?.id ?? '')
  const [kind, setKind] = useState<'none' | 'delete' | 'insert'>('delete')
  const [n, setN] = useState(1)
  const [bases, setBases] = useState('A')

  const g = guides.find((x) => x.id === id) ?? guides[0]
  const edit: Edit = kind === 'delete' ? { type: 'delete', n } : kind === 'insert' ? { type: 'insert', bases: bases.toUpperCase() } : { type: 'none' }
  const badInsert = kind === 'insert' && !validBases(bases.toUpperCase())

  const result = useMemo(() => {
    if (!g || badInsert) return null
    return applyEdit(g.window, g.offset, edit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, kind, n, bases, badInsert])

  if (!g) return <p className="text-sm text-muted">No guides yet. Run crispr_data.py then rabbit_sync.py.</p>

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3 text-sm">
        <label className="sm:col-span-2">
          <span className="block text-xs text-muted mb-1">Guide</span>
          <select value={g.id} onChange={(e) => setId(e.target.value)} className="w-full rounded-md border border-line bg-canvas px-2 py-2">
            {guides.map((x) => <option key={x.id} value={x.id}>{x.gene} · {x.strand}{x.position} · {x.guide} (score {x.score.toFixed(2)})</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs text-muted mb-1">Edit at the cut</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-full rounded-md border border-line bg-canvas px-2 py-2">
            <option value="none">No edit (reference)</option>
            <option value="delete">Delete bases</option>
            <option value="insert">Insert bases</option>
          </select>
        </label>
        {kind === 'delete' && (
          <label>
            <span className="block text-xs text-muted mb-1">How many (1–10)</span>
            <input type="number" min={1} max={10} value={n} onChange={(e) => setN(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className="w-full rounded-md border border-line bg-canvas px-2 py-2" />
          </label>
        )}
        {kind === 'insert' && (
          <label>
            <span className="block text-xs text-muted mb-1">Bases (A, C, G, T)</span>
            <input value={bases} maxLength={10} onChange={(e) => setBases(e.target.value.replace(/[^acgtACGT]/g, ''))}
              aria-invalid={badInsert} className="w-full rounded-md border border-line bg-canvas px-2 py-2 font-mono" />
          </label>
        )}
      </div>

      <div className="rounded-md border border-line bg-canvas p-3 space-y-2" aria-live="polite">
        {result ? (
          <>
            <Row label="Reference" text={result.before} offset={g.offset} cut={result.cut} del={result.deleted} />
            <Row label="Edited" text={result.after} offset={g.offset} cut={result.cut} ins={result.inserted} />
          </>
        ) : (
          <p className="text-sm text-bad">Enter 1 to 10 bases using A, C, G or T.</p>
        )}
        <p className="text-xs text-muted pt-1">
          <span className="text-accent">guide (20)</span> · <span className="text-warn">PAM</span> · <span className="text-info">✂ cut, 3 bases before the PAM</span>
          {kind === 'delete' && <> · <span className="text-bad">deleted</span></>}{kind === 'insert' && <> · <span className="text-ok">inserted</span></>}
        </p>
      </div>

      {result && (
        <dl className="grid sm:grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted">Length change</dt><dd className="font-mono">{result.lengthChange > 0 ? '+' : ''}{result.lengthChange} base{Math.abs(result.lengthChange) === 1 ? '' : 's'}</dd></div>
          <div><dt className="text-xs text-muted">Reading frame (if in a coding region)</dt>
            <dd>{result.lengthChange === 0 ? 'unchanged' : result.keepsFrame ? 'kept (multiple of 3)' : 'shifted — would scramble the protein downstream'}</dd></div>
          <div><dt className="text-xs text-muted">Guide quality (heuristic)</dt><dd className="font-mono">GC {Math.round(g.gc * 100)}% · score {g.score.toFixed(2)}</dd></div>
        </dl>
      )}
      <p className="text-xs text-muted">
        Illustration on a {g.window.length}-base window of the public RefSeq transcript {g.transcript} ({g.gene}). The guide is on the {g.strand === '+' ? 'forward' : 'reverse'} strand,
        shown 5′→3′. Real repair outcomes are varied and unpredictable; this is not a prediction and not a protocol.
      </p>
    </div>
  )
}
