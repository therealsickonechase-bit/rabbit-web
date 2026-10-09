import { createAdminClient } from '@/lib/supabase/admin'
import { corsHeaders } from '@/lib/public-feed'
import { merkleProof } from '@/lib/merkle'

// Public inclusion proof: shows that one audit entry's hash belongs to a sealed batch whose root can be published
// elsewhere. Reveals only the entry hash and sibling hashes, nothing about what the entry contains.
// Verify offline: rebuild with leaf = SHA-256(0x00 || entry_hash as text), node = SHA-256(0x01 || left || right).
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'))
  const seqParam = new URL(request.url).searchParams.get('seq') ?? ''
  if (!/^\d{1,9}$/.test(seqParam)) return Response.json({ error: 'seq must be a whole number' }, { status: 400, headers: cors })
  const seq = Number(seqParam)

  const sb = createAdminClient()
  const batch = await sb.from('merkle_batches').select('id, from_seq, to_seq, root, anchor_tx, anchor_ledger, created_at').lte('from_seq', seq).gte('to_seq', seq).maybeSingle()
  if (batch.error) return Response.json({ error: 'unavailable' }, { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })
  if (!batch.data) return Response.json({ seq, status: 'not_yet_sealed' }, { headers: { ...cors, 'Cache-Control': 'public, max-age=60' } })

  const rows = await sb.from('audit_entries').select('seq, hash').gte('seq', batch.data.from_seq).lte('seq', batch.data.to_seq).order('seq')
  const hashes = (rows.data ?? []).map((e) => e.hash)
  if (rows.error || hashes.length !== batch.data.to_seq - batch.data.from_seq + 1) return Response.json({ error: 'unavailable' }, { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })

  const index = seq - batch.data.from_seq
  return Response.json(
    { seq, status: 'sealed', entry_hash: hashes[index], batch: batch.data, proof: await merkleProof(hashes, index) },
    { headers: { ...cors, 'Cache-Control': 'public, max-age=300, s-maxage=600' } },
  )
}
