import { createAdminClient } from '@/lib/supabase/admin'
import { GENESIS_HASH, checkAuditLinks, ingestSchema, verifySignature } from '@/lib/ingest'

type Admin = ReturnType<typeof createAdminClient>
type TopicRef = { topic: string; biomarker?: string | null }

const fail = (status: number, error: string) => Response.json({ error }, { status })

async function topicId(sb: Admin, ref: TopicRef, extra: Record<string, unknown> = {}) {
  const biomarker = ref.biomarker ?? null
  let q = sb.from('research_topics').select('id').eq('topic', ref.topic)
  q = biomarker === null ? q.is('biomarker', null) : q.eq('biomarker', biomarker)
  const found = await q.maybeSingle()
  if (found.error) throw found.error
  if (found.data) return found.data.id as number

  const ins = await sb
    .from('research_topics')
    .insert({ topic: ref.topic, biomarker, ...extra })
    .select('id')
    .single()
  if (ins.error) throw ins.error
  return ins.data.id as number
}

export async function POST(request: Request) {
  const secret = process.env.INGEST_SHARED_SECRET
  if (!secret) return fail(500, 'ingest not configured')

  const body = await request.text()
  const ok = await verifySignature(
    secret,
    request.headers.get('x-rabbit-timestamp') ?? '',
    body,
    request.headers.get('x-rabbit-signature') ?? ''
  )
  if (!ok) return fail(401, 'bad signature')

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return fail(400, 'invalid json')
  }
  const parsed = ingestSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const p = parsed.data

  const linkError = checkAuditLinks(p.audit)
  if (linkError) return fail(422, linkError)

  const sb = createAdminClient()
  const node = p.agent.node_id

  try {
    const agent = await sb.from('agents').upsert(
      {
        node_id: node,
        kind: p.agent.kind,
        twin_id: p.agent.twin_id ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'node_id' }
    )
    if (agent.error) throw agent.error

    for (const t of p.topics) {
      const parentId = t.parent ? await topicId(sb, t.parent, { discovered_by: node }) : null
      const id = await topicId(sb, t, { discovered_by: node, parent_topic_id: parentId })
      const upd = await sb
        .from('research_topics')
        .update({ status: t.status, explored_at: t.status === 'explored' ? new Date().toISOString() : null })
        .eq('id', id)
      if (upd.error) throw upd.error
    }

    const runIds = new Map<number, number>()
    for (const r of p.runs) {
      const tid = r.topic ? await topicId(sb, r.topic, { discovered_by: node }) : null
      const res = await sb
        .from('research_runs')
        .upsert(
          {
            agent_id: node,
            twin_id: p.agent.twin_id ?? null,
            topic_id: tid,
            cycle: r.cycle,
            new_ids_found: r.new_ids_found,
            summary: r.summary ?? null,
          },
          { onConflict: 'agent_id,cycle' }
        )
        .select('id')
        .single()
      if (res.error) throw res.error
      runIds.set(r.cycle, res.data.id)
    }

    if (p.records.length) {
      const rows = []
      for (const r of p.records) {
        let runId = r.cycle != null ? (runIds.get(r.cycle) ?? null) : null
        if (r.cycle != null && runId === null) {
          const found = await sb
            .from('research_runs')
            .select('id')
            .eq('agent_id', node)
            .eq('cycle', r.cycle)
            .maybeSingle()
          if (found.error) throw found.error
          runId = found.data?.id ?? null
        }
        rows.push({
          id: r.id,
          source: r.source,
          title: r.title,
          url: r.url ?? null,
          topic_id: r.topic ? await topicId(sb, r.topic, { discovered_by: node }) : null,
          run_id: runId,
          meta: r.meta,
        })
      }
      const res = await sb.from('research_records').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      if (res.error) throw res.error

      // Existing rows keep their topic/run/first-seen; only the descriptive fields are refreshed.
      for (const r of p.records.filter((x) => x.refresh)) {
        const upd = await sb
          .from('research_records')
          .update({ title: r.title, url: r.url ?? null, meta: r.meta })
          .eq('id', r.id)
        if (upd.error) throw upd.error
      }
    }

    for (const sm of p.summaries) {
      const res = await sb.from('research_summaries').upsert(
        {
          agent_id: node,
          topic_id: sm.topic ? await topicId(sb, sm.topic, { discovered_by: node }) : null,
          model: sm.model,
          ai_interpretation: sm.ai_interpretation,
          disclaimer: sm.disclaimer,
          source_counts: sm.source_counts,
          input_hash: sm.input_hash,
        },
        { onConflict: 'agent_id,input_hash', ignoreDuplicates: true }
      )
      if (res.error) throw res.error
    }

    if (p.blocks.length) {
      const res = await sb
        .from('chain_blocks')
        .upsert(
          p.blocks.map((b) => ({ ...b, node_id: node })),
          { onConflict: 'block_id', ignoreDuplicates: true }
        )
      if (res.error) throw res.error
    }

    if (p.scores.length) {
      const res = await sb
        .from('node_scores')
        .upsert(
          p.scores.map((s) => ({ node_id: node, mos: s.mos ?? null, balance: s.balance ?? null, ts: s.ts })),
          { onConflict: 'node_id,ts', ignoreDuplicates: true }
        )
      if (res.error) throw res.error
    }

    if (p.audit.length) {
      const sorted = [...p.audit].sort((a, b) => a.seq - b.seq)
      const first = sorted[0]
      if (first.seq === 0) {
        if (first.prev_hash !== GENESIS_HASH) return fail(422, 'audit seq 0 must start from the genesis hash')
      } else {
        const prev = await sb.from('audit_entries').select('hash').eq('seq', first.seq - 1).maybeSingle()
        if (prev.error) throw prev.error
        if (!prev.data) return fail(422, `audit entry ${first.seq - 1} not ingested yet`)
        if (prev.data.hash !== first.prev_hash) return fail(422, `audit chain broken at seq ${first.seq}`)
      }
      const rows = sorted.map((e) => ({
        seq: e.seq,
        ts: e.ts,
        module: e.module,
        action: e.action,
        node_id: e.node_id ?? node,
        details: { ...e.details, _code: { file: e.code_file ?? null, sha256: e.code_sha256 ?? null } },
        prev_hash: e.prev_hash,
        hash: e.hash,
      }))
      const res = await sb.from('audit_entries').upsert(rows, { onConflict: 'seq', ignoreDuplicates: true })
      if (res.error) throw res.error
    }
  } catch (e) {
    console.error('ingest failed', e)
    return fail(500, 'ingest failed')
  }

  return Response.json({
    ok: true,
    counts: {
      topics: p.topics.length,
      runs: p.runs.length,
      records: p.records.length,
      summaries: p.summaries.length,
      blocks: p.blocks.length,
      scores: p.scores.length,
      audit: p.audit.length,
    },
  })
}
