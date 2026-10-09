import { createAdminClient } from '@/lib/supabase/admin'
import { RATE_LIMIT_PER_MINUTE, bearerFrom, handleRpc, hashKey, keyUsable, originAllowed, type Scope } from '@/lib/mcp'
import { makeDb } from '@/lib/mcp-db'

// RabbitOS MCP endpoint (streamable HTTP, JSON-RPC over POST). Authenticated by an API key: Authorization: Bearer rbk_...
const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...extra } })

export async function POST(request: Request) {
  if (!originAllowed(request.headers.get('origin'))) return json({ error: 'origin not allowed' }, 403)

  const key = bearerFrom(request.headers.get('authorization'))
  if (!key) return json({ error: 'missing or malformed API key' }, 401, { 'WWW-Authenticate': 'Bearer realm="rabbitos"' })

  const sb = createAdminClient()
  const row = await sb.from('api_keys').select('id, user_id, scopes, revoked_at, expires_at').eq('key_hash', await hashKey(key)).maybeSingle()
  if (row.error) { console.error('mcp key lookup failed', row.error.message); return json({ error: 'unavailable' }, 503) }
  if (!row.data || !keyUsable(row.data)) return json({ error: 'invalid, expired or revoked API key' }, 401, { 'WWW-Authenticate': 'Bearer realm="rabbitos", error="invalid_token"' })

  const recent = await sb.from('api_key_calls').select('id', { count: 'exact', head: true }).eq('key_id', row.data.id).gte('called_at', new Date(Date.now() - 60_000).toISOString())
  if ((recent.count ?? 0) >= RATE_LIMIT_PER_MINUTE) return json({ error: 'rate limit: 60 calls per minute' }, 429, { 'Retry-After': '30' })

  let body: unknown
  try { body = await request.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }
  if (Array.isArray(body)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported' } }, 400)

  const ctx = { userId: row.data.user_id as string, scopes: row.data.scopes as Scope[], db: makeDb() }
  const out = await handleRpc(body, ctx, async (tool, ok) => {
    await sb.from('api_key_calls').insert({ key_id: row.data!.id, tool, ok })
    await sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.data!.id)
  })
  return out === null ? new Response(null, { status: 202, headers: NO_STORE }) : json(out)
}

// No server-initiated streams: the spec lets a server answer GET with 405.
export function GET() {
  return new Response('Use POST with a JSON-RPC body.', { status: 405, headers: { Allow: 'POST', ...NO_STORE } })
}
