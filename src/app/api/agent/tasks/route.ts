import { createAdminClient } from '@/lib/supabase/admin'
import { verifySignature } from '@/lib/ingest'
import { ledgerCols, recordWrite } from '@/lib/chain-ledger-db'
import { agentRequestSchema, checkProposal, type Kind } from '@/lib/tasks'

// Signed endpoint for research agents: claim the next task, submit a proposal, or report a failure.
// Same HMAC scheme as /api/ingest. Agents can only touch tasks they claimed, and a proposal never writes to the
// corpus: an owner approves it first.

const fail = (status: number, error: string) => Response.json({ error }, { status })

export async function POST(request: Request) {
  const secret = process.env.INGEST_SHARED_SECRET
  if (!secret) return fail(500, 'not configured')

  const body = await request.text()
  const ok = await verifySignature(secret, request.headers.get('x-rabbit-timestamp') ?? '', body, request.headers.get('x-rabbit-signature') ?? '')
  if (!ok) return fail(401, 'bad signature')

  let json: unknown
  try { json = JSON.parse(body) } catch { return fail(400, 'invalid json') }
  const parsed = agentRequestSchema.safeParse(json)
  if (!parsed.success) return Response.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 3) }, { status: 400 })
  const req = parsed.data
  const sb = createAdminClient()
  const node = req.agent.node_id

  try {
    // Make sure the agent exists (tasks reference it) and note that it is alive.
    const seen = await sb.from('agents').upsert({ node_id: node, kind: 'research', last_seen_at: new Date().toISOString() }, { onConflict: 'node_id' })
    if (seen.error) throw seen.error

    if (req.action === 'claim') {
      const res = await sb.rpc('claim_agent_task', { p_agent: node, p_lease_seconds: req.lease_seconds })
      if (res.error) throw res.error
      const t = (res.data as { id: string; kind: string; params: unknown }[] | null)?.[0]
      if (t) {
        // The claim is an atomic SQL function, so it reaches the chain right after: the claimed row as an update event.
        const row = await sb.from('agent_tasks').select(ledgerCols('agent_tasks')).eq('id', t.id).maybeSingle()
        if (row.data) await recordWrite('agent_tasks', 'update', [row.data as unknown as Record<string, unknown>]).catch(() => console.warn('claim not recorded on the chain'))
      }
      return Response.json({ task: t ? { id: t.id, kind: t.kind, params: t.params } : null })
    }

    const cur = await sb.from('agent_tasks').select(ledgerCols('agent_tasks')).eq('id', req.task_id).maybeSingle()
    if (cur.error) throw cur.error
    if (!cur.data) return fail(404, 'no such task')
    const task = cur.data as unknown as Record<string, unknown> & { kind: string; status: string; claimed_by: string | null }
    if (task.status !== 'claimed' || task.claimed_by !== node) return fail(409, 'task is not claimed by this agent')

    if (req.action === 'fail') {
      const patch = { status: 'failed', error: req.error.slice(0, 500), updated_at: new Date().toISOString() }
      await recordWrite('agent_tasks', 'update', [{ ...task, ...patch }]) // chain first
      const upd = await sb.from('agent_tasks').update(patch).eq('id', req.task_id).eq('status', 'claimed')
      if (upd.error) throw upd.error
      return Response.json({ ok: true })
    }

    const checked = checkProposal(task.kind as Kind, req.result)
    if (!checked.ok) return fail(422, checked.error)
    const patch = { status: 'proposed', result: checked.proposal, updated_at: new Date().toISOString() }
    await recordWrite('agent_tasks', 'update', [{ ...task, ...patch }]) // chain first
    const upd = await sb.from('agent_tasks').update(patch).eq('id', req.task_id).eq('status', 'claimed').eq('claimed_by', node)
    if (upd.error) throw upd.error
    return Response.json({ ok: true, records: checked.proposal.records.length })
  } catch (e) {
    console.error('agent task failed', e)
    return fail(500, 'task request failed')
  }
}
