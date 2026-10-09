import { createAdminClient } from '@/lib/supabase/admin'
import { PUBLIC_SOURCES, corsHeaders } from '@/lib/public-feed'

// Read-only and cacheable. Anyone may call it; it exposes only public literature titles/links, counts, and chain heads.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'))
  const sb = createAdminClient()

  const counts: Record<string, number> = {}
  await Promise.all(
    [...PUBLIC_SOURCES, 'crispr_guide'].map(async (s) => {
      const r = await sb.from('research_records').select('id', { count: 'exact', head: true }).eq('source', s)
      counts[s] = r.count ?? 0
    }),
  )

  const [recent, audit, guideLog, topics] = await Promise.all([
    sb.from('research_records').select('id, source, title, url, first_seen_at').in('source', [...PUBLIC_SOURCES]).order('first_seen_at', { ascending: false }).limit(20),
    sb.from('audit_entries').select('seq, hash, ts').order('seq', { ascending: false }).limit(1).maybeSingle(),
    sb.from('audit_entries').select('seq, ts, details').eq('module', 'crispr_data').order('seq', { ascending: false }).limit(1).maybeSingle(),
    sb.from('research_topics').select('status'),
  ])
  if (recent.error || audit.error) return Response.json({ error: 'unavailable' }, { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })

  const guide = guideLog.data?.details as { guide_digest?: string; guides?: number } | null
  return Response.json(
    {
      generated_at: new Date().toISOString(),
      counts,
      topics: {
        explored: (topics.data ?? []).filter((t) => t.status === 'explored').length,
        queued: (topics.data ?? []).filter((t) => t.status === 'queued').length,
      },
      chain: { audit_head_seq: audit.data?.seq ?? null, audit_head_hash: audit.data?.hash ?? null, audit_head_time: audit.data?.ts ?? null },
      crispr: { guides: counts.crispr_guide, logged_guides: guide?.guides ?? null, guide_digest: guide?.guide_digest ?? null, logged_at: guideLog.data?.ts ?? null },
      recent: recent.data ?? [],
    },
    { headers: { ...cors, 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  )
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(request.headers.get('origin')), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } })
}
