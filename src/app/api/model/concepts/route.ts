import { lookupMesh, validTerm } from '@/lib/concepts'

// Maps a research topic or any medical term to MeSH descriptors (NLM's public vocabulary). Only the term in the URL is sent to NLM; nothing about you is.
const OPEN = { 'Access-Control-Allow-Origin': '*' }

export async function GET(request: Request) {
  const term = (new URL(request.url).searchParams.get('term') ?? '').trim()
  if (!validTerm(term)) return Response.json({ error: 'term must be 2-80 letters, digits or common punctuation' }, { status: 400, headers: OPEN })
  const hits = await lookupMesh(term)
  if (hits === null) return Response.json({ error: 'the NLM vocabulary service did not answer; try again later' }, { status: 502, headers: OPEN })
  return Response.json({ term, vocabulary: 'MeSH', matches: hits, note: 'Exact label match first, then labels containing the term. A match is a vocabulary suggestion, not a diagnosis.' },
    { headers: { ...OPEN, 'Cache-Control': 'public, max-age=3600, s-maxage=21600' } })
}
