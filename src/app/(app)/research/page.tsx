import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/secrets'
import { DISCLAIMER, MODEL, buildPrompt, summarize } from '@/lib/summarize'
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
  topic_summary: 'Topic summaries',
}

function detail(source: string, m: Record<string, unknown>) {
  const s = (k: string) => (m[k] != null && m[k] !== '' ? String(m[k]) : null)
  const parts =
    source === 'trial' ? [s('status'), s('sponsor'), s('start_date')]
    : source === 'pubmed' || source === 'stjude' ? [s('journal'), s('pub_date')]
    : source === 'europepmc' ? [s('pub_year'), m.is_preprint ? 'preprint' : null]
    : source === 'nih_grant' ? [s('org'), s('fiscal_year') ? `FY${s('fiscal_year')}` : null]
    : source === 'clinvar' ? [s('classification'), s('review_status'), s('last_evaluated')]
    : []
  return parts.filter(Boolean).join(' · ') || '—'
}

const NOTICE: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  done: { tone: 'ok', text: 'Summary saved. It appears under AI summaries below.' },
  nokey: { tone: 'bad', text: 'Add your Anthropic key in Settings first.' },
  norecords: { tone: 'bad', text: 'This topic has no stored records to summarize yet.' },
  failed: { tone: 'bad', text: 'The summary could not be generated. Try again in a moment.' },
  credits: { tone: 'bad', text: 'Your Anthropic account has no credits. Add credits under Plans & Billing in the Anthropic console, then try again.' },
  badkey: { tone: 'bad', text: 'Anthropic rejected your saved key. Replace it in Settings.' },
  ratelimit: { tone: 'bad', text: 'Anthropic is rate limiting this key. Wait a minute and try again.' },
}

async function summarizeTopic(formData: FormData) {
  'use server'
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const topicId = Number(formData.get('topic_id'))
  const admin = createAdminClient()
  const { data: settings } = await admin.from('user_settings').select('anthropic_key_enc').eq('user_id', user.id).maybeSingle()
  if (!settings?.anthropic_key_enc) redirect('/research?msg=nokey')

  const [topic, records] = await Promise.all([
    sb.from('research_topics').select('id, topic, biomarker').eq('id', topicId).maybeSingle(),
    sb.from('research_records').select('id, source, title, meta').eq('topic_id', topicId).limit(80),
  ])
  if (!topic.data || !records.data?.length) redirect('/research?msg=norecords')

  let outcome = 'failed'
  try {
    const key = await decryptSecret(settings.anthropic_key_enc)
    const prompt = buildPrompt(topic.data.topic, topic.data.biomarker, records.data)
    const text = await summarize(key, prompt)

    const agent = await admin.from('agents').upsert({ node_id: 'rabbitos-web', kind: 'ai_participant', last_seen_at: new Date().toISOString() }, { onConflict: 'node_id' })
    if (agent.error) throw agent.error
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`web:${topicId}:${text}`))))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    const saved = await admin.from('research_summaries').insert({
      agent_id: 'rabbitos-web',
      topic_id: topicId,
      model: MODEL,
      ai_interpretation: text,
      disclaimer: DISCLAIMER,
      source_counts: { records: records.data.length },
      input_hash: hash,
    })
    if (saved.error) throw saved.error
    outcome = 'done'
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown'
    console.error('summarize failed', detail.slice(0, 300))
    if (/credit balance/i.test(detail)) outcome = 'credits'
    else if (/Anthropic API 40[13]/.test(detail)) outcome = 'badkey'
    else if (/Anthropic API 429/.test(detail)) outcome = 'ratelimit'
  }
  redirect(`/research?msg=${outcome}`)
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ source?: string; msg?: string }> }) {
  const { source, msg } = await searchParams
  const notice = msg ? NOTICE[msg] : undefined
  const sb = await createClient()

  let recordQuery = sb
    .from('research_records')
    .select('id, source, title, url, meta, first_seen_at, research_topics(topic, biomarker)')
    .order('first_seen_at', { ascending: false })
    .limit(50)
  if (source) recordQuery = recordQuery.eq('source', source)

  const [topics, records, sources, runs, summaries] = await Promise.all([
    sb.from('research_topics').select('*').order('created_at', { ascending: false }).limit(50),
    recordQuery,
    sb.from('research_records').select('source').limit(5000),
    sb.from('research_runs').select('*', { count: 'exact', head: true }),
    sb
      .from('research_summaries')
      .select('id, model, ai_interpretation, disclaimer, created_at, research_topics(topic, biomarker)')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const topicRows = topics.data ?? []
  const counts = new Map<string, number>()
  for (const r of sources.data ?? []) counts.set(r.source, (counts.get(r.source) ?? 0) + 1)
  const total = sources.data?.length ?? 0
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v)

  return (
    <>
      <PageHeader title="Research" sub="Topics, literature and AI summaries from the research agents" />

      <div className="space-y-6">
        {notice && (
          <p role="status" className={`text-sm rounded-md border px-3 py-2 ${notice.tone === 'ok' ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>
            {notice.text}{' '}
            {msg === 'nokey' && <Link href="/settings" className="underline">Open Settings</Link>}
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
          <Table head={['Topic', 'Biomarker', 'Status', 'Found by', 'Added', 'AI summary']} empty="No topics yet. Run rabbit_sync.py to import them.">
            {topicRows.map((t) => (
              <tr key={t.id}>
                <Td>{t.topic}</Td>
                <Td mono>{t.biomarker ?? '—'}</Td>
                <Td><Badge tone={statusTone[t.status as keyof typeof statusTone]}>{t.status}</Badge></Td>
                <Td mono>{short(t.discovered_by, 10)}</Td>
                <Td>{ago(t.created_at)}</Td>
                <Td>
                  <form action={summarizeTopic}>
                    <input type="hidden" name="topic_id" value={t.id} />
                    <button className="text-xs rounded-md border border-line px-2 py-1 hover:border-accent hover:text-accent">Summarize</button>
                  </form>
                </Td>
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
          <Table head={['Source', 'Title', 'Details', 'Topic', 'Seen']} empty="No records for this filter.">
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
