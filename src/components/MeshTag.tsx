'use client'

import { useEffect, useState } from 'react'

// A small standard-vocabulary tag for a research topic: the MeSH descriptor NLM returns for the topic text. Looked up when the row scrolls into view and
// cached by the browser and the edge for hours. Only the topic text is sent (to RabbitOS, which asks NLM). A "similar" tag is a suggestion, not a diagnosis.
interface Hit { id: string; label: string; uri: string }
const memo = new Map<string, Hit | null>()

export default function MeshTag({ term }: { term: string }) {
  const [hit, setHit] = useState<Hit | null | undefined>(memo.get(term))
  useEffect(() => {
    if (memo.has(term)) return
    let live = true
    fetch(`/api/model/concepts?term=${encodeURIComponent(term)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { matches?: Hit[] } | null) => { const h = j?.matches?.[0] ?? null; memo.set(term, h); if (live) setHit(h) })
      .catch(() => { if (live) setHit(null) })
    return () => { live = false }
  }, [term])
  if (!hit) return null
  const exact = hit.label.toLowerCase() === term.toLowerCase()
  return (
    <a href={hit.uri} target="_blank" rel="noopener noreferrer" title={`MeSH ${hit.id}: ${hit.label}${exact ? '' : ' (similar term, a suggestion)'}`}
      className="ml-2 inline-block rounded border border-line px-1 text-[10px] font-mono text-muted hover:text-accent">
      MeSH {hit.id}{exact ? '' : ' ~'}
    </a>
  )
}
