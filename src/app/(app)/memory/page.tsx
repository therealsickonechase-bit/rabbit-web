import { redirect } from 'next/navigation'
import { getAi } from '@/lib/runtime-env'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMember, viewerClient } from '@/lib/auth/session'
import { Badge, Card, PageHeader, Stat, Table, Td } from '@/components/ui'
import { EMBED_MODEL, embedTexts, recordText, toVectorLiteral, type AiLike } from '@/lib/embed'
import { buildLinks } from '@/lib/brain'
import { primaryGene } from '@/lib/twin-stats'
import { PUBLIC_SOURCES } from '@/lib/public-feed'

const SOURCES = [...PUBLIC_SOURCES, 'crispr_guide']
const ai = async () => (await getAi()) as AiLike | undefined

const NOTICE: Record<string, { ok: boolean; text: string }> = {
  embedded: { ok: true, text: 'Embedded the next batch of records.' },
  nothing: { ok: true, text: 'Every record already has an embedding.' },
  noai: { ok: false, text: 'The Workers AI binding is not available in this environment (it works once deployed).' },
  failed: { ok: false, text: 'That did not work. Try again in a moment.' },
  graph: { ok: true, text: 'Knowledge graph rebuilt from the stored records.' },
  empty: { ok: false, text: 'Type something to search for.' },
}

async function embedNext() {
  'use server'
  await requireMember()
  const binding = await ai()
  if (!binding) redirect('/memory?msg=noai')
  const admin = createAdminClient()
  const [recs, done] = await Promise.all([
    admin.from('research_records').select('id, source, title, meta').in('source', SOURCES).order('first_seen_at', { ascending: false }).limit(3000),
    admin.from('record_embeddings').select('record_id').limit(5000),
  ])
  const have = new Set((done.data ?? []).map((d) => d.record_id))
  const todo = (recs.data ?? []).filter((r) => !have.has(r.id)).slice(0, 50)
  if (!todo.length) redirect('/memory?msg=nothing')
  try {
    const vectors = await embedTexts(binding!, todo.map((r) => recordText({ title: r.title, source: r.source, meta: r.meta as Record<string, unknown> })))
    const up = await admin.from('record_embeddings').upsert(todo.map((r, i) => ({ record_id: r.id, embedding: toVectorLiteral(vectors[i]), model: EMBED_MODEL })), { onConflict: 'record_id' })
    if (up.error) throw up.error
  } catch (e) {
    console.error('embed failed', e instanceof Error ? e.message : e)
    redirect('/memory?msg=failed')
  }
  redirect('/memory?msg=embedded')
}

async function rebuildGraph() {
  'use server'
  await requireMember()
  const admin = createAdminClient()
  const [recs, chem] = await Promise.all([
    admin.from('research_records').select('id, source, title, meta').in('source', PUBLIC_SOURCES).limit(3000),
    admin.from('chemo_baselines').select('chemical_name'),
  ])
  const records = recs.data ?? []
  const genes = [...new Set(records.map((r) => primaryGene((r.meta as Record<string, unknown> | null)?.gene)).filter((g) => g !== 'UNKNOWN'))]
  const links = buildLinks(records.map((r) => ({ id: r.id, source: r.source, title: r.title, meta: r.meta as Record<string, unknown> | null })), { chemicals: (chem.data ?? []).map((c) => c.chemical_name), genes })
  const rows = links.edges.flatMap((e) => e.records.map((record_id) => ({ a_kind: e.a.kind, a_name: e.a.name, b_kind: e.b.kind, b_name: e.b.name, record_id })))
  const del = await admin.from('kg_edges').delete().neq('record_id', '')
  if (del.error) redirect('/memory?msg=failed')
  for (let i = 0; i < rows.length; i += 500) {
    const ins = await admin.from('kg_edges').insert(rows.slice(i, i + 500))
    if (ins.error) redirect('/memory?msg=failed')
  }
  redirect('/memory?msg=graph')
}

async function search(formData: FormData) {
  'use server'
  await requireMember()
  const q = String(formData.get('q') ?? '').trim().slice(0, 200)
  if (q.length < 3) redirect('/memory?msg=empty')
  redirect(`/memory?q=${encodeURIComponent(q)}`)
}

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ msg?: string; q?: string }> }) {
  const { msg, q } = await searchParams
  const sb = await viewerClient()
  const admin = createAdminClient()

  const [recCount, embCount, edges] = await Promise.all([
    admin.from('research_records').select('id', { count: 'exact', head: true }).in('source', SOURCES),
    admin.from('record_embeddings').select('record_id', { count: 'exact', head: true }),
    sb.from('kg_edges').select('a_kind, a_name, b_kind, b_name, record_id').limit(5000),
  ])

  let results: { id: string; source: string; title: string; url: string | null; similarity: number }[] = []
  let searchError = false
  if (q && q.length >= 3) {
    const binding = await ai()
    if (!binding) searchError = true
    else {
      try {
        const [v] = await embedTexts(binding, [q])
        const m = await admin.rpc('match_records', { query_embedding: toVectorLiteral(v), match_count: 10, only_sources: [...PUBLIC_SOURCES] })
        if (m.error) throw m.error
        results = (m.data ?? []) as typeof results
      } catch (e) {
        console.error('semantic search failed', e instanceof Error ? e.message : e)
        searchError = true
      }
    }
  }

  const pairs = new Map<string, { a: string; b: string; n: number }>()
  for (const e of edges.data ?? []) {
    const k = `${e.a_kind}:${e.a_name}|${e.b_kind}:${e.b_name}`
    const cur = pairs.get(k) ?? { a: `${e.a_kind}: ${e.a_name}`, b: `${e.b_kind}: ${e.b_name}`, n: 0 }
    cur.n++
    pairs.set(k, cur)
  }
  const top = [...pairs.values()].sort((x, y) => y.n - x.n).slice(0, 15)
  const notice = msg ? NOTICE[msg] : undefined

  return (
    <>
      <PageHeader title="Memory" sub="Search by meaning, and the graph of what the research connects" />
      <div className="space-y-6">
        {notice && <p role="status" className={`text-sm rounded-md border px-3 py-2 ${notice.ok ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>{notice.text}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Records" value={recCount.count ?? 0} />
          <Stat label="Embedded" value={embCount.count ?? 0} sub={`of ${recCount.count ?? 0}`} tone={(embCount.count ?? 0) >= (recCount.count ?? 0) ? 'ok' : 'warn'} />
          <Stat label="Graph links" value={edges.data?.length ?? 0} />
          <Stat label="Distinct connections" value={pairs.size} />
        </div>

        <Card title="Search by meaning">
          <form action={search} className="flex gap-2">
            <input name="q" defaultValue={q ?? ''} required minLength={3} maxLength={200} placeholder="e.g. DNA repair defects in breast tumours"
              aria-label="Search by meaning" className="flex-1 min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
            <button className="rounded-md bg-accent text-white text-sm font-medium px-4 py-2">Search</button>
          </form>
          {q && (
            <div className="mt-4">
              {searchError ? <p className="text-sm text-bad">Search is not available right now.</p>
                : results.length === 0 ? <p className="text-sm text-muted">No matches. Records may not be embedded yet.</p>
                : (
                  <ul className="space-y-2 text-sm">
                    {results.map((r) => (
                      <li key={r.id} className="flex gap-3">
                        <span className="font-mono text-xs text-muted w-12 shrink-0">{(r.similarity * 100).toFixed(0)}%</span>
                        <span><Badge tone="accent">{r.source}</Badge>{' '}{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{r.title}</a> : r.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
          <p className="text-xs text-muted mt-3">Finds records whose meaning is close to your words, even when the exact words differ. The percentage is similarity, not accuracy.</p>
        </Card>

        <Card title="Strongest connections in the research" flush>
          <Table head={['Term', 'Mentioned together with', 'Records']} empty="The graph is empty. Anyone can build it from the stored records.">
            {top.map((p) => <tr key={`${p.a}|${p.b}`}><Td>{p.a}</Td><Td>{p.b}</Td><Td mono>{p.n}</Td></tr>)}
          </Table>
          <p className="text-xs text-muted px-4 py-3 border-t border-line">A connection means stored record titles mention both terms together. It points to papers to read; it is not evidence of cause.</p>
        </Card>

        {(
          <Card title="Maintenance">
            <div className="flex flex-wrap gap-3">
              <form action={embedNext}><button className="rounded-md border border-line text-sm px-3 py-2 hover:border-accent hover:text-accent">Embed next 50 records</button></form>
              <form action={rebuildGraph}><button className="rounded-md border border-line text-sm px-3 py-2 hover:border-accent hover:text-accent">Rebuild knowledge graph</button></form>
            </div>
            <p className="text-xs text-muted mt-3">Embedding uses Cloudflare Workers AI ({EMBED_MODEL}) and works once deployed. Only public research text is embedded; no personal data.</p>
          </Card>
        )}
      </div>
    </>
  )
}
