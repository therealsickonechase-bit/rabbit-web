import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireUser } from '@/lib/auth/session'
import GuideEditor, { type GuideChoice } from '@/components/GuideEditor'
import { guideDigest, type GuideRow } from '@/lib/crispr-sim'
import { Badge, Card, PageHeader, Stat, Table, Td, ago, short, when } from '@/components/ui'

const LIT_LABEL: Record<string, string> = { crispr_trial: 'Trial', crispr_paper: 'Paper', crispr_preprint: 'Preprint' }

export default async function CrisprPage() {
  await requireUser()
  const sb = await createClient()

  const [guideRes, litRes] = await Promise.all([
    sb.from('research_records').select('id, title, url, meta, first_seen_at').eq('source', 'crispr_guide').limit(500),
    sb.from('research_records').select('id, source, title, url, meta, first_seen_at').in('source', Object.keys(LIT_LABEL)).order('first_seen_at', { ascending: false }).limit(100),
  ])
  const rows = (guideRes.data ?? []) as (GuideRow & { title: string; url: string | null; first_seen_at: string })[]
  const lit = litRes.data ?? []

  // Proof: the agents log a digest of the guide set to the hash-chained audit trail. Recompute it from the rows
  // stored here and compare. Only this one derived entry is read, with the server key, so members can see the result.
  const latest = await createAdminClient().from('audit_entries').select('seq, hash, ts, details').eq('module', 'crispr_data').order('seq', { ascending: false }).limit(1).maybeSingle()
  const logged = (latest.data?.details as { guide_digest?: string; guides?: number } | null) ?? null
  const mine = rows.length ? await guideDigest(rows) : null
  const verdict = !logged?.guide_digest ? 'unlogged' : mine === logged.guide_digest ? 'match' : 'differs'

  const choices: GuideChoice[] = rows
    .filter((r) => typeof r.meta?.window === 'string')
    .map((r) => {
      const m = r.meta as Record<string, unknown>
      return {
        id: r.id, gene: String(m.gene), transcript: String(m.transcript), strand: String(m.strand), position: Number(m.position),
        guide: String(m.guide), pam: String(m.pam), gc: Number(m.gc_content), score: Number(m.score),
        window: String(m.window), offset: Number(m.window_guide_offset),
      }
    })
    .sort((a, b) => a.gene.localeCompare(b.gene) || b.score - a.score)

  const byGene = new Map<string, number>()
  for (const c of choices) byGene.set(c.gene, (byGene.get(c.gene) ?? 0) + 1)

  return (
    <>
      <PageHeader title="CRISPR Explorer" sub="Real reference sequences, guide candidates and live CRISPR research" />
      <div className="space-y-6">
        <p role="note" className="text-sm rounded-md border border-warn/40 text-warn px-3 py-2">
          Education and research planning only, on text. Scores are a simple heuristic, not a validated efficiency or off-target prediction.
          This page gives no lab procedures and nothing here is for use on a person.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Guide candidates" value={choices.length} sub={`${byGene.size} genes`} />
          <Stat label="CRISPR papers" value={lit.filter((l) => l.source === 'crispr_paper').length} />
          <Stat label="Preprints" value={lit.filter((l) => l.source === 'crispr_preprint').length} />
          <Stat label="Trials" value={lit.filter((l) => l.source === 'crispr_trial').length} sub="recruiting, cancer" />
        </div>

        <Card title="Edit preview">
          <GuideEditor guides={choices} />
        </Card>

        <Card title="Proof: is this the data the agents logged?">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={verdict === 'match' ? 'ok' : verdict === 'differs' ? 'bad' : 'muted'}>
              {verdict === 'match' ? 'Matches the audit chain' : verdict === 'differs' ? 'Differs from the audit chain' : 'Not logged yet'}
            </Badge>
            {latest.data && <span className="text-muted">audit entry #{latest.data.seq} · {when(latest.data.ts)} · {logged?.guides ?? '?'} guides logged · {rows.length} stored</span>}
          </div>
          <dl className="grid sm:grid-cols-2 gap-3 mt-3 text-xs">
            <div><dt className="text-muted">Digest recomputed here</dt><dd className="font-mono break-all">{mine ?? '—'}</dd></div>
            <div><dt className="text-muted">Digest the agent logged (chain entry {short(latest.data?.hash, 16)})</dt><dd className="font-mono break-all">{logged?.guide_digest ?? '—'}</dd></div>
          </dl>
          <p className="text-xs text-muted mt-3">
            The agent hashes the guide list when it downloads the sequences and writes that hash into the hash-chained audit trail. This page hashes what is stored and compares.
            A mismatch means the stored guides changed after they were logged.
          </p>
        </Card>

        <Card title="Guide candidates" flush>
          <Table head={['Gene', 'Strand · pos', 'Guide (5′→3′)', 'PAM', 'GC', 'Score', 'Transcript']} empty="No guides yet.">
            {choices.map((c) => (
              <tr key={c.id}>
                <Td>{c.gene}</Td>
                <Td mono>{c.strand}{c.position}</Td>
                <Td mono>{c.guide}</Td>
                <Td mono>{c.pam}</Td>
                <Td mono>{Math.round(c.gc * 100)}%</Td>
                <Td mono>{c.score.toFixed(2)}</Td>
                <Td><a className="text-info hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.ncbi.nlm.nih.gov/nuccore/${c.transcript}`}>{c.transcript}</a></Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="CRISPR research the agents found" flush>
          <Table head={['Type', 'Title', 'Topic', 'Found']} empty="No CRISPR literature yet.">
            {lit.map((l) => (
              <tr key={l.id}>
                <Td><Badge tone="accent">{LIT_LABEL[l.source]}</Badge></Td>
                <Td className="max-w-lg">{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{l.title}</a> : l.title}</Td>
                <Td>{String((l.meta as Record<string, unknown>)?.topic ?? '—')}</Td>
                <Td>{ago(l.first_seen_at)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  )
}
