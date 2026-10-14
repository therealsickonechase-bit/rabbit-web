import { getAi } from '@/lib/runtime-env'
import { createAdminClient } from '@/lib/supabase/admin'
import { orFilter } from '@/lib/ask'
import { guideDigest, type GuideRow } from '@/lib/crispr-sim'
import { PUBLIC_SOURCES } from '@/lib/public-feed'
import { MAX_OPEN_PER_USER, MAX_PER_DAY } from '@/lib/tasks'
import { embedTexts, toVectorLiteral, type AiLike } from '@/lib/embed'
import type { Db } from '@/lib/mcp'

// The only sources an API key can read: public literature/variants and CRISPR guides. Never chats, notes, EEG or twin data.
const READABLE = [...PUBLIC_SOURCES, 'crispr_guide']

export function makeDb(): Db {
  const sb = createAdminClient()
  return {
    async searchRecords(words, source, limit) {
      const q = sb.from('research_records').select('id, source, title, url, first_seen_at').in('source', source ? [source].filter((s) => READABLE.includes(s)) : READABLE)
        .or(orFilter('title', words)).order('first_seen_at', { ascending: false }).limit(limit)
      const r = await q
      if (r.error) throw r.error
      return r.data ?? []
    },
    async semanticSearch(query, limit) {
      const ai = (await getAi()) as AiLike | undefined
      if (!ai) return null
      const [v] = await embedTexts(ai, [query])
      const m = await sb.rpc('match_records', { query_embedding: toVectorLiteral(v), match_count: limit, only_sources: READABLE.filter((s) => s !== 'crispr_guide') })
      if (m.error) throw m.error
      return ((m.data ?? []) as { id: string; source: string; title: string; url: string | null; similarity: number }[])
    },
    async getRecord(id) {
      const r = await sb.from('research_records').select('id, source, title, url, meta, first_seen_at').eq('id', id).in('source', READABLE).maybeSingle()
      if (r.error) throw r.error
      return r.data
    },
    async guides(gene, limit) {
      let q = sb.from('research_records').select('id, meta').eq('source', 'crispr_guide').limit(limit)
      if (gene) q = q.eq('meta->>gene', gene)
      const r = await q
      if (r.error) throw r.error
      return (r.data ?? []) as { id: string; meta: Record<string, unknown> }[]
    },
    async stats() {
      const out: Record<string, number> = {}
      await Promise.all(READABLE.map(async (s) => {
        const r = await sb.from('research_records').select('id', { count: 'exact', head: true }).eq('source', s)
        if (r.count) out[s] = r.count
      }))
      return out
    },
    async digestCheck() {
      const [g, log] = await Promise.all([
        sb.from('research_records').select('id, meta').eq('source', 'crispr_guide').limit(500),
        sb.from('audit_entries').select('details').eq('module', 'crispr_data').order('seq', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (g.error) throw g.error
      const rows = (g.data ?? []) as unknown as GuideRow[]
      const logged = (log.data?.details as { guide_digest?: string } | null)?.guide_digest ?? null
      const recomputed = rows.length ? await guideDigest(rows) : null
      return { status: !logged ? 'unlogged' : recomputed === logged ? 'match' : 'differs', recomputed, logged, guides: rows.length }
    },
    async createTask(userId, kind, params) {
      const open = await sb.from('agent_tasks').select('id', { count: 'exact', head: true }).eq('created_by', userId).in('status', ['queued', 'claimed', 'proposed'])
      if ((open.count ?? 0) >= MAX_OPEN_PER_USER) return { ok: false, error: `Too many open tasks (max ${MAX_OPEN_PER_USER}).` }
      const day = await sb.from('agent_tasks').select('id', { count: 'exact', head: true }).eq('created_by', userId).gte('created_at', new Date(Date.now() - 86400_000).toISOString())
      if ((day.count ?? 0) >= MAX_PER_DAY) return { ok: false, error: `Daily limit reached (${MAX_PER_DAY}).` }
      const ins = await sb.from('agent_tasks').insert({ created_by: userId, kind, params }).select('id').single()
      return ins.error ? { ok: false, error: 'Could not queue the task.' } : { ok: true, id: ins.data.id }
    },
    async myTasks(userId) {
      const r = await sb.from('agent_tasks').select('id, kind, params, status, result').eq('created_by', userId).order('created_at', { ascending: false }).limit(20)
      if (r.error) throw r.error
      return (r.data ?? []).map((t) => ({ id: t.id, kind: t.kind, params: t.params, status: t.status, records: (t.result as { records?: unknown[] } | null)?.records?.length ?? 0 }))
    },
  }
}
