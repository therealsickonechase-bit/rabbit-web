import { redirect } from 'next/navigation'
import { getSessionRole, viewerClient } from '@/lib/auth/session'
import AutoRefresh from '@/components/AutoRefresh'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, short } from '@/components/ui'
import { GENES, KINDS, KIND_LABEL, MAX_OPEN_PER_USER, MAX_PER_DAY, type Kind } from '@/lib/tasks'
import { queueTask } from '@/lib/task-queue'
import { autoRestoreIfEmpty } from '@/lib/chain-ledger-db'
import RestoreButton from '@/components/RestoreButton'

const tone = { queued: 'muted', claimed: 'info', proposed: 'warn', approved: 'ok', rejected: 'bad', failed: 'bad' } as const

const NOTICE: Record<string, { ok: boolean; text: string }> = {
  created: { ok: true, text: 'Proposal recorded. It stays parked as proposed until the owner moves it into the agent queue; nothing runs automatically.' },
  open: { ok: false, text: `You already have ${MAX_OPEN_PER_USER} open tasks. Wait for some to finish.` },
  limit: { ok: false, text: `Daily limit reached (${MAX_PER_DAY} tasks). Try again tomorrow.` },
  invalid: { ok: false, text: 'That task is not valid. Check the fields and try again.' },
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

const describe = (kind: string, p: Record<string, unknown>) =>
  kind === 'research_topic' ? `${p.topic}${p.biomarker ? ` · ${p.biomarker}` : ''}` : kind === 'crispr_guides' ? `${p.gene} (top ${p.top})` : String(p.query)

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams
  await autoRestoreIfEmpty('agent_tasks')
  const sb = await viewerClient()
  const tasks = await sb.from('agent_tasks').select('id, kind, params, status, claimed_by, result, error, review_note, created_at, updated_at').order('created_at', { ascending: false }).limit(50)
  const rows = tasks.data ?? []
  const count = (s: string) => rows.filter((t) => t.status === s).length
  const notice = msg ? NOTICE[msg] : undefined
  const proposal = (t: (typeof rows)[number]) => t.result as { summary?: string; records?: { id: string; source: string; title: string; url?: string | null }[] } | null

  return (
    <>
      <PageHeader title="Agent tasks" sub="Propose a task for the research agents. Proposals are read-only parked requests: they never run until the owner queues them, and nothing enters the research corpus from this page.">
        <AutoRefresh intervalMs={5000} />
      </PageHeader>
      <div className="space-y-6">
        {notice && <p role="status" className={`text-sm rounded-md border px-3 py-2 ${notice.ok ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>{notice.text}</p>}

        {!rows.length && <RestoreButton back="/tasks" what="The task list" />}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Queued" value={count('queued')} />
          <Stat label="Running" value={count('claimed')} tone="info" />
          <Stat label="Proposed" value={count('proposed')} tone={count('proposed') ? 'warn' : undefined} />
          <Stat label="Approved" value={count('approved')} />
        </div>

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
            <button className="rounded-md bg-accent text-white font-medium px-4 py-2">Propose task</button>
          </form>
          <p className="text-xs text-muted mt-3">
            For <strong>guides</strong>, put the gene ({GENES.join(', ')}) in the second box. For <strong>brain / EEG search</strong>, type your search words in the first box.
            You can have {MAX_OPEN_PER_USER} open tasks and {MAX_PER_DAY} per day. Proposals are parked and never run automatically.
          </p>
        </Card>

        <Card title="All tasks" flush>
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
