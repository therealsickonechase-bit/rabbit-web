// Standard medical vocabulary IDs for the body model and for research topics.
//   Organs: resolved ahead of time against NLM's public MeSH lookup (scripts/build-concepts.mjs writes concepts.generated.json), so every ID was returned by NLM.
//           UMLS CUIs are in the file only if the owner ran the script with a UMLS_API_KEY; without one, `umls` is null. No key is ever stored in the repo.
//   Topics: looked up live in MeSH, exact label first, with a strict check on the term and the answer. Only the term typed is sent to NLM.
// Pure functions plus one fetch helper with an injectable fetch, tested.
import generated from './concepts.generated.json' with { type: 'json' }

export interface Concept { mesh: { id: string; label: string; uri: string }; umls: { cui: string; name: string } | null }

export const MESH_LOOKUP = 'https://id.nlm.nih.gov/mesh/lookup/descriptor'
const MESH_URI = /^https?:\/\/id\.nlm\.nih\.gov\/mesh\/(D\d{6,9})$/

export const conceptForOrgan = (organ: string): Concept | null => (generated.concepts as Record<string, Concept>)[organ] ?? null
export const conceptSource = () => ({ source: generated.source, generated: generated.generated, umls_included: generated.umls_included })

/** A search term is short plain text; anything else is refused before it reaches NLM. */
export const validTerm = (t: string) => t.length >= 2 && t.length <= 80 && /^[\p{L}\p{N}][\p{L}\p{N} ,.'()/+-]*$/u.test(t)

export function parseMeshHits(raw: unknown): Concept['mesh'][] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 10).flatMap((h) => {
    const m = h && typeof h.resource === 'string' ? MESH_URI.exec(h.resource) : null
    return m && typeof h.label === 'string' ? [{ id: m[1], label: h.label.slice(0, 120), uri: `https://id.nlm.nih.gov/mesh/${m[1]}` }] : []
  })
}

const cache = new Map<string, { at: number; hits: Concept['mesh'][] }>()
const TTL = 6 * 3600_000

/** Exact label first, then labels containing the term. Cached for 6 hours; returns null if NLM cannot be reached. */
export async function lookupMesh(term: string, doFetch: typeof fetch = fetch, now = Date.now()): Promise<Concept['mesh'][] | null> {
  const t = term.trim()
  if (!validTerm(t)) return []
  const k = t.toLowerCase()
  const c = cache.get(k)
  if (c && now - c.at < TTL) return c.hits
  try {
    for (const match of ['exact', 'contains']) {
      const r = await doFetch(`${MESH_LOOKUP}?label=${encodeURIComponent(t)}&match=${match}&limit=5`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
      if (!r.ok) return null
      const hits = parseMeshHits(await r.json())
      if (hits.length) { cache.set(k, { at: now, hits }); if (cache.size > 500) cache.delete(cache.keys().next().value as string); return hits }
    }
    cache.set(k, { at: now, hits: [] }); return []
  } catch { return null }
}
