import { createAdminClient } from '@/lib/supabase/admin'
import { recordWrite } from '@/lib/chain-ledger-db'
import { ANON_TASK_STATUS } from '@/lib/open-access'
import { MAX_OPEN_PER_USER, MAX_PER_DAY, parseTaskParams } from '@/lib/tasks'

export type QueueResult = 'created' | 'open' | 'limit' | 'invalid'

/** Validate and record an anonymous task proposal, enforcing the open-task and daily limits.
 *  It is stored as 'proposed', never 'queued': agents only claim queued tasks, so a proposal never runs on its own. */
export async function queueTask(userId: string, kind: string, raw: unknown): Promise<QueueResult> {
  const parsed = parseTaskParams(kind, raw)
  if (!parsed.ok) return 'invalid'
  const admin = createAdminClient()
  const open = await admin.from('agent_tasks').select('id', { count: 'exact', head: true }).eq('created_by', userId).in('status', ['queued', 'claimed', 'proposed'])
  if ((open.count ?? 0) >= MAX_OPEN_PER_USER) return 'open'
  const day = await admin.from('agent_tasks').select('id', { count: 'exact', head: true }).eq('created_by', userId).gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
  if ((day.count ?? 0) >= MAX_PER_DAY) return 'limit'
  const now = new Date().toISOString()
  const row = { id: crypto.randomUUID(), created_by: userId, kind: parsed.kind, params: parsed.params, status: ANON_TASK_STATUS, created_at: now, updated_at: now }
  try { await recordWrite('agent_tasks', 'insert', [row]) } catch { return 'invalid' } // chain first
  const ins = await admin.from('agent_tasks').insert(row)
  return ins.error ? 'invalid' : 'created'
}
