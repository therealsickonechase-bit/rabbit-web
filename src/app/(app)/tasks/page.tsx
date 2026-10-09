import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionRole, requireOwner } from '@/lib/auth/session'
import AutoRefresh from '@/components/AutoRefresh'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, short } from '@/components/ui'
import { GENES, KINDS, KIND_LABEL, MAX_OPEN_PER_USER, MAX_PER_DAY, checkProposal, type Kind } from '@/lib/tasks'
import { queueTask } from '@/lib/task-queue'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tone = { queued: 'muted', claimed: 'info', proposed: 'warn', approved: 'ok', rejected: 'bad', failed: 'bad' } as const

const NOTICE: Record<string, { ok: boolean; text: string }> = {
  created: { ok: true, text: 'Task queued. An agent will pick it up and propose results for an owner to approve.' },
  approved: { ok: true, text: 'Approved. The records were added to the research corpus.' },
  rejected: { ok: true, text: 'Rejected. Nothing was added.' },
  open: { ok: false, text: `You already have ${MAX_OPEN_PER_USER} open tasks. Wait for some to finish.` },
  limit: { ok: false, text: `Daily limit reached (${MAX_PER_DAY} tasks). Try again tomorrow.` },
  invalid: { ok: false, text: 'That task is not valid. Check the fields and try again.' },
  badproposal: { ok: false, text: 'The proposal did not pass validation and was not added.' },
}

async function createTask(formData: FormData) {
  'use server'
  const { user } = await getSessionRole()
  const kind = String(formData.get('kind') ?? '')
  const topic = String(formData.get('topic') ?? '')
  const second = String(formData.get('biomarker') ?? '').trim()
  const raw =
    kind === 'research_topic' ? { topic, ...(second ? { biomarker: second } : {}) }
    : kind === 'crispr_guides' ? { gene: second.toUpperCase(), top: 5 }
    : { query: topic }
  redirect(`/tasks?msg=${await queueTask(user.id, kind, raw)}`)
}

async function review(formData: FormData) {
  'use server'
  const owner = await requireOwner()
  const id = String(formData.get('task') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '').trim().slice(0, 500) || null
  if (!UUID.test(id) || !['approve', 'reject'].includes(decision)) redirect('/tasks?msg=invalid')

  const admin = createAdminClient()
  const t = await admin.from('agent_tasks').select('id, kind, status, result').eq('id', id).maybeSingle()
  if (!t.data || t.data.status !== 'proposed') redirect('/tasks')
  const now = new Date().toISOString()

  if (decision === 'reject') {
    await admin.from('agent_tasks').update({ status: 'rejected', reviewed_by: owner.id, reviewed_at: now, review_note: note, updated_at: now }).eq('id', id).eq('status', 'proposed')
    redirect('/tasks?msg=rejected')
  }

  // Validate again at approval time: never trust what is stored.
  const checked = checkProposal(t.data!.kind as Kind, t.data!.result)
  if (!checked.ok) redirect('/tasks?msg=badproposal')
  if (checked.proposal.records.length) {
    const up = await admin.from('research_records').upsert(
      checked.proposal.records.map((r) => ({ id: r.id, source: r.source, title: r.title, url: r.url ?? null, meta: { ...r.meta, via_task: id } })),
      { onConflict: 'id', ignoreDuplicates: true },   // never overwrites an existing record
    )
    if (up.error) redirect('/tasks?msg=badproposal')
  }
  await admin.from('agent_tasks').update({ status: 'approved', reviewed_by: owner.id, reviewed_at: now, review_note: note, updated_at: now }).eq('id', id).eq('status', 'proposed')
  redirect('/tasks?msg=approved')
}

const describe = (kind: string, p: Record<string, unknown>) =>
  kind === 'research_topic' ? `${p.topic}${p.biomarker ? ` · ${p.biomarker}` : ''}` : kind === 'crispr_guides' ? `${p.gene} (top ${p.top})` : String(p.query)

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams
  const { isOwner } = await getSessionRole()
  const sb = await createClient()
  const tasks = await sb.from('agent_tasks').select('id, kind, params, status, claimed_by, result, error, review_note, created_at, updated_at').order('created_at', { ascending: false }).limit(50)
  const rows = tasks.data ?? []
  const count = (s: string) => rows.filter((t) => t.status === s).length
  const awaiting = rows.filter((t) => t.status === 'proposed')
  const notice = msg ? NOTICE[msg] : undefined
  const proposal = (t: (typeof rows)[number]) => t.result as { summary?: string; records?: { id: string; source: string; title: string; url?: string | null }[] } | null

  return (
    <>
      <PageHeader title="Agent tasks" sub="Ask the research agents for something. They propose results; an owner approves what is added.">
        <AutoRefresh intervalMs={5000} />
      </PageHeader>
      <div className="space-y-6">
        {notice && <p role="status" className={`text-sm rounded-md border px-3 py-2 ${notice.ok ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>{notice.text}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Queued" value={count('queued')} />
          <Stat label="Running" value={count('claimed')} tone="info" />
          <Stat label="Awaiting approval" value={count('proposed')} tone={count('proposed') ? 'warn' : undefined} />
          <Stat label="Approved" value={count('approved')} />
        </div>

        {isOwner && awaiting.length > 0 && (
          <Card title={`Awaiting your approval (${awaiting.length})`}>
            <div className="space-y-5">
              {awaiting.map((t) => {
                const p = proposal(t)
                return (
                  <article key={t.id} className="border-b border-line pb-5 last:border-0 last:pb-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone="warn">{KIND_LABEL[t.kind as Kind] ?? t.kind}</Badge>
                      <strong>{describe(t.kind, t.params as Record<string, unknown>)}</strong>
                      <span className="text-xs text-muted">by agent {short(t.claimed_by, 18)} · {ago(t.updated_at)}</span>
                    </div>
                    <p className="text-sm">{p?.summary}</p>
                    <ul className="text-xs space-y-1 max-h-48 overflow-auto border border-line rounded-md p-2 bg-canvas">
                      {(p?.records ?? []).map((r) => (
                        <li key={r.id}><span className="text-muted">[{r.source}]</span> {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{r.title}</a> : r.title}</li>
                      ))}
                    </ul>
                    <form action={review} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="task" value={t.id} />
                      <input name="note" maxLength={500} placeholder="Optional note" aria-label="Optional note" className="flex-1 min-w-40 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs" />
                      <button name="decision" value="approve" className="rounded-md bg-accent text-white text-sm px-3 py-1.5">Approve {p?.records?.length ?? 0} records</button>
                      <button name="decision" value="reject" className="rounded-md border border-line text-sm px-3 py-1.5 hover:border-bad hover:text-bad">Reject</button>
                    </form>
                  </article>
                )
              })}
            </div>
          </Card>
        )}

        <Card title="New task">
          <form action={createTask} className="grid md:grid-cols-4 gap-3 items-end text-sm">
            <label className="md:col-span-1">
              <span className="block text-xs text-muted mb-1">What should the agents do?</span>
              <select name="kind" className="w-full rounded-md border border-line bg-canvas px-2 py-2">
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label>
              <span className="block text-xs text-muted mb-1">Topic / search words (not for guides)</span>
              <input name="topic" maxLength={80} placeholder="e.g. breast cancer" className="w-full rounded-md border border-line bg-canvas px-3 py-2" />
            </label>
            <label>
              <span className="block text-xs text-muted mb-1">Biomarker (optional) · gene for guides</span>
              <input name="biomarker" maxLength={80} list="genes" placeholder="e.g. PARP1" className="w-full rounded-md border border-line bg-canvas px-3 py-2" />
              <datalist id="genes">{GENES.map((g) => <option key={g} value={g} />)}</datalist>
            </label>
            <button className="rounded-md bg-accent text-white font-medium px-4 py-2">Queue task</button>
          </form>
          <p className="text-xs text-muted mt-3">
            For <strong>guides</strong>, put the gene ({GENES.join(', ')}) in the second box. For <strong>brain / EEG search</strong>, type your search words in the first box.
            You can have {MAX_OPEN_PER_USER} open tasks and {MAX_PER_DAY} per day. Results are proposals: nothing enters the shared research until an owner approves it.
          </p>
        </Card>

        <Card title={isOwner ? 'All tasks' : 'Your tasks'} flush>
          <Table head={['Task', 'Status', 'Agent', 'Records', 'Updated']} empty="No tasks yet.">
            {rows.map((t) => (
              <tr key={t.id}>
                <Td className="max-w-xs"><span className="block">{KIND_LABEL[t.kind as Kind]?.split(' (')[0] ?? t.kind}</span><span className="text-xs text-muted">{describe(t.kind, t.params as Record<string, unknown>)}</span></Td>
                <Td><Badge tone={tone[t.status as keyof typeof tone]}>{t.status}</Badge>{t.error && <span className="block text-xs text-bad mt-1">{t.error}</span>}{t.review_note && <span className="block text-xs text-muted mt-1">{t.review_note}</span>}</Td>
                <Td mono>{short(t.claimed_by, 14)}</Td>
                <Td mono>{proposal(t)?.records?.length ?? '—'}</Td>
                <Td>{ago(t.updated_at)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  )
}
