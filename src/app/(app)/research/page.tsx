import Link from 'next/link'
import { recordWrite } from '@/lib/chain-ledger-db'
import { redirect } from 'next/navigation'
import { requireMember, viewerClient } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import MeshTag from '@/components/MeshTag'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, short } from '@/components/ui'

const statusTone = { explored: 'ok', queued: 'info', dropped: 'muted' } as const

const SOURCE_LABEL: Record<string, string> = {
  trial: 'Trials',
  pubmed: 'PubMed',
  stjude: 'St. Jude papers',
  stjude_dataset: 'St. Jude datasets',
  europepmc: 'Europe PMC',
  nih_grant: 'NIH grants',
  clinvar: 'ClinVar',
  ncbi_datasets: 'NCBI sequences',
  topic_summary: 'Topic summaries',
  crispr_guide: 'CRISPR guides',
  crispr_trial: 'CRISPR trials',
  crispr_paper: 'CRISPR papers',
  crispr_preprint: 'CRISPR preprints',
  brain_paper: 'Brain / EEG papers',
  brain_preprint: 'Brain / EEG preprints',
}

function detail(source: string, m: Record<string, unknown>) {
  const s = (k: string) => (m[k] != null && m[k] !== '' ? String(m[k]) : null)
  const parts =
    source === 'trial' ? [s('status'), s('sponsor'), s('start_date')]
    : source === 'pubmed' || source === 'stjude' ? [s('journal'), s('pub_date')]
    : source === 'europepmc' ? [s('pub_year'), m.is_preprint ? 'preprint' : null]
    : source === 'nih_grant' ? [s('org'), s('fiscal_year') ? `FY${s('fiscal_year')}` : null]
    : source === 'ncbi_datasets' ? [s('kind'), m.length ? `${m.length} ${(s('kind') ?? '').includes('protein') ? 'aa' : 'bp'}` : null]
    : source === 'clinvar' ? [s('classification'), s('review_status'), s('last_evaluated')]
    : []
  return parts.filter(Boolean).join(' · ') || '—'
}

const NOTICE: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  nocollection: { tone: 'bad', text: 'Create a collection first, then save records to it.' },
}

async function saveRecord(formData: FormData) {
  'use server'
  const user = await requireMember()
  const admin = createAdminClient()
  const collectionId = String(formData.get('collection') ?? '')
  const recordId = String(formData.get('record') ?? '')
  const own = await admin.from('collections').select('id').eq('id', collectionId).eq('user_id', user.id).maybeSingle()
  if (!own.data) redirect('/research?msg=nocollection')
  const exists = await admin.from('research_records').select('id').eq('id', recordId).maybeSingle()
  if (!exists.data) redirect('/research')
  const item = { collection_id: collectionId, record_id: recordId, user_id: user.id, added_at: new Date().toISOString() }
  await recordWrite('collection_items', 'insert', [item]) // chain first
  await admin.from('collection_items').upsert(
    item,
    { onConflict: 'collection_id,record_id', ignoreDuplicates: true },
  )
  redirect(`/collections?c=${collectionId}`)
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ source?: string; msg?: string }> }) {
  const { source, msg } = await searchParams
  const notice = msg ? NOTICE[msg] : undefined
  const sb = await viewerClient()

  let recordQuery = sb
    .from('research_records')
    .select('id, source, title, url, meta, first_seen_at, research_topics(topic, biomarker)')
    .order('first_seen_at', { ascending: false })
    .limit(50)
  if (source) recordQuery = recordQuery.eq('source', source)

  const [topics, records, sources, runs, summaries, myCollections] = await Promise.all([
    sb.from('research_topics').select('id, topic, biomarker, status, discovered_by, created_at').order('created_at', { ascending: false }).limit(50),
    recordQuery,
    sb.from('research_records').select('source').limit(5000),
    sb.from('research_runs').select('id', { count: 'exact', head: true }),
    sb
      .from('research_summaries')
      .select('id, model, ai_interpretation, disclaimer, created_at, research_topics(topic, biomarker)')
      .order('created_at', { ascending: false })
      .limit(5),
    sb.from('collections').select('id, name').order('name'),
  ])

  const topicRows = topics.data ?? []
  const counts = new Map<string, number>()
  for (const r of sources.data ?? []) counts.set(r.source, (counts.get(r.source) ?? 0) + 1)
  const total = sources.data?.length ?? 0
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v)

  return (
    <>
      <PageHeader title="Research" sub="Topics, literature and AI summaries from the research agents (read-only summaries)" />

      <div className="space-y-6">
        {notice && (
          <p role="status" className={`text-sm rounded-md border px-3 py-2 ${notice.tone === 'ok' ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>
            {notice.text}{' '}
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Topics" value={topicRows.length} />
          <Stat label="Queued" value={topicRows.filter((t) => t.status === 'queued').length} sub="waiting to be explored" />
          <Stat label="Records" value={total} sub={`${counts.size} sources`} />
          <Stat label="Agent runs" value={runs.count ?? 0} />
        </div>

        {(summaries.data ?? []).length > 0 && (
          <Card title="AI summaries">
            <div className="space-y-4">
              {(summaries.data ?? []).map((sm) => {
                const t = one(sm.research_topics)
                return (
                  <article key={sm.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge tone="warn">AI interpretation</Badge>
                      <span className="text-sm font-medium">{t ? `${t.topic}${t.biomarker ? ` · ${t.biomarker}` : ''}` : 'Topic'}</span>
                      <span className="text-xs text-muted">{sm.model} · {ago(sm.created_at)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-line">{sm.ai_interpretation}</p>
                    <p className="text-xs text-muted mt-2">{sm.disclaimer}</p>
                  </article>
                )
              })}
            </div>
          </Card>
        )}

        <Card title="Topics" flush>
          <Table head={['Topic', 'Biomarker', 'Status', 'Found by', 'Added']} empty="No topics yet. Run rabbit_sync.py to import them.">
            {topicRows.map((t) => (
              <tr key={t.id}>
                <Td>{t.topic}<MeshTag term={t.topic} /></Td>
                <Td mono>{t.biomarker ?? '—'}</Td>
                <Td><Badge tone={statusTone[t.status as keyof typeof statusTone]}>{t.status}</Badge></Td>
                <Td mono>{short(t.discovered_by, 10)}</Td>
                <Td>{ago(t.created_at)}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Records" flush>
          <nav className="flex flex-wrap gap-2 px-4 py-3 border-b border-line" aria-label="Filter by source">
            <FilterLink href="/research" active={!source} label={`All (${total})`} />
            {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <FilterLink key={k} href={`/research?source=${encodeURIComponent(k)}`} active={source === k} label={`${SOURCE_LABEL[k] ?? k} (${n})`} />
            ))}
          </nav>
          <Table head={['Source', 'Title', 'Details', 'Topic', 'Seen', 'Save']} empty="No records for this filter.">
            {(records.data ?? []).map((r) => {
              const t = one(r.research_topics)
              return (
                <tr key={r.id}>
                  <Td><Badge tone="accent">{SOURCE_LABEL[r.source] ?? r.source}</Badge></Td>
                  <Td className="max-w-md">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{r.title}</a>
                    ) : (
                      r.title
                    )}
                  </Td>
                  <Td className="text-muted">{detail(r.source, (r.meta ?? {}) as Record<string, unknown>)}</Td>
                  <Td>{t ? `${t.topic}${t.biomarker ? ` · ${t.biomarker}` : ''}` : '—'}</Td>
                  <Td>{ago(r.first_seen_at)}</Td>
                  <Td>
                    {(myCollections.data ?? []).length ? (
                      <form action={saveRecord} className="flex gap-1">
                        <input type="hidden" name="record" value={r.id} />
                        <select name="collection" aria-label="Collection" className="text-xs rounded border border-line bg-canvas px-1 py-1 max-w-28">
                          {(myCollections.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button className="text-xs rounded-md border border-line px-2 hover:border-accent hover:text-accent">Save</button>
                      </form>
                    ) : (
                      <Link href="/collections" className="text-xs text-muted underline">Create a collection</Link>
                    )}
                  </Td>
                </tr>
              )
            })}
          </Table>
        </Card>
      </div>
    </>
  )
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`text-xs rounded-full border px-3 py-1 ${active ? 'border-accent text-accent bg-accent-soft' : 'border-line text-muted hover:text-fg'}`}
    >
      {label}
    </Link>
  )
}
