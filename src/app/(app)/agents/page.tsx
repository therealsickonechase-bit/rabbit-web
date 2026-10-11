import { requireViewer, viewerClient } from '@/lib/auth/session'
import { Badge, Card, PageHeader, Table, Td, ago, short } from '@/components/ui'

const ONLINE_MS = 15 * 60 * 1000

export default async function AgentsPage() {
  const { isOwner } = await requireViewer()
  const sb = await viewerClient(isOwner)
  const [agents, blocks, scores] = await Promise.all([
    sb.from('agents').select('*').order('last_seen_at', { ascending: false, nullsFirst: false }),
    sb.from('chain_blocks').select('node_id, das_score').limit(5000),
    sb.from('node_scores').select('node_id, mos, balance, ts').order('ts', { ascending: false }).limit(500),
  ])

  const blockStats = new Map<string, { n: number; sum: number }>()
  for (const b of blocks.data ?? []) {
    const s = blockStats.get(b.node_id) ?? { n: 0, sum: 0 }
    s.n++
    s.sum += Number(b.das_score)
    blockStats.set(b.node_id, s)
  }
  const latestScore = new Map<string, { mos: number | null; balance: number | null }>()
  for (const s of scores.data ?? []) if (!latestScore.has(s.node_id)) latestScore.set(s.node_id, s)

  const now = new Date().getTime()

  return (
    <>
      <PageHeader title="Agents" sub="Nodes that report into RabbitOS through the ingest endpoint" />
      <Card flush>
        <Table head={['Node', 'Kind', 'Status', 'Last seen', 'Blocks', 'Avg DAS', 'MOS', 'Score']} empty="No agents have reported yet.">
          {(agents.data ?? []).map((a) => {
            const online = a.last_seen_at && now - new Date(a.last_seen_at).getTime() < ONLINE_MS
            const b = blockStats.get(a.node_id)
            const s = latestScore.get(a.node_id)
            return (
              <tr key={a.node_id}>
                <Td mono>{short(a.node_id, 16)}</Td>
                <Td>{a.kind}</Td>
                <Td><Badge tone={online ? 'ok' : 'muted'}>{online ? 'Online' : 'Offline'}</Badge></Td>
                <Td>{ago(a.last_seen_at)}</Td>
                <Td mono>{b?.n ?? 0}</Td>
                <Td mono>{b ? (b.sum / b.n).toFixed(2) : '—'}</Td>
                <Td mono>{s?.mos != null ? Number(s.mos).toFixed(2) : '—'}</Td>
                <Td mono>{s?.balance != null ? Number(s.balance).toFixed(2) : '—'}</Td>
              </tr>
            )
          })}
        </Table>
      </Card>
      <p className="text-xs text-muted mt-3">
        Online means a sync arrived in the last 15 minutes. DAS is the 0–6 block quality score; MOS is the 1–5 node rollup;
        Score is the internal contribution balance (not a currency).
      </p>
    </>
  )
}
