#!/usr/bin/env node
// Terminal research search: asks the RabbitOS Hub (MCP over HTTP) for `research_link` and prints a readable answer.
// Searches public sources live, then shows what RabbitOS stores, whether the Maxwell research anchor covers it, and the Google Cloud copies.
// Read only. No keys needed (the Hub's research tools are public).
//
//   node scripts/research-search.mjs antigravity
//   node scripts/research-search.mjs "antihydrogen gravity" --sources openalex,inspirehep --limit 6
//   node scripts/research-search.mjs antigravity --json
export const HUB = 'https://rabbitos-hub-mcp-vxx5lz7c5a-wl.a.run.app/mcp'

export function parseArgs(argv) {
  const out = { words: [], sources: undefined, limit: undefined, json: false, hub: process.env.RABBIT_HUB_URL || HUB }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--sources') out.sources = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--hub') out.hub = String(argv[++i] ?? '')
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else out.words.push(a)
  }
  out.query = out.words.join(' ').trim()
  if (out.query.length < 2 || out.query.length > 120) throw new Error('give a search of 2 to 120 characters, e.g. node scripts/research-search.mjs antigravity')
  if (out.limit !== undefined && !(Number.isInteger(out.limit) && out.limit >= 1 && out.limit <= 8)) throw new Error('--limit must be 1 to 8')
  if (!/^https:\/\//.test(out.hub)) throw new Error('the Hub URL must be https')
  return out
}

export function format(report) {
  const lines = [`Research on "${report.query}"`, '']
  for (const l of report.live) {
    lines.push(l.error ? `${l.name}: ${l.error}` : `${l.name}: ${l.items.length} result(s)`)
    for (const it of l.items) lines.push(`  - ${it.title}${it.date ? ` (${it.date})` : ''}${it.inRabbitOS ? '  [already in RabbitOS]' : ''}`, `    ${it.url ?? ''}`.trimEnd())
  }
  lines.push('', `RabbitOS stores ${report.rabbitos.records.length} matching record(s)${report.rabbitos.error ? ` (${report.rabbitos.error})` : ''}:`)
  for (const r of report.rabbitos.records) lines.push(`  - ${r.title}  [Maxwell: ${r.maxwell.status === 'covered' ? `block ${r.maxwell.block}` : r.maxwell.status}]`)
  const a = report.maxwell.latestResearchAnchor
  lines.push('', a ? `Maxwell: block ${a.block} anchors ${a.count} public records (mined ${a.time}).` : 'Maxwell: anchor not readable right now.')
  lines.push(report.googleCloud.unavailable ? 'Google Cloud: live file not readable right now.' : `Google Cloud: ${report.googleCloud.publicRecords} public records, refreshed ${report.googleCloud.refreshedAt}.`)
  lines.push('', report.caution)
  return lines.join('\n')
}

export async function search(opts, fetchImpl = fetch) {
  const args = { query: opts.query, ...(opts.sources ? { sources: opts.sources } : {}), ...(opts.limit ? { limit: opts.limit } : {}) }
  const res = await fetchImpl(opts.hub, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'research_link', arguments: args } }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`the Hub returned ${res.status}`)
  const raw = await res.text()
  const body = JSON.parse(raw.startsWith('event:') || raw.startsWith('data:') ? raw.split('\n').find((l) => l.startsWith('data:')).slice(5) : raw)
  const result = body.result
  if (!result) throw new Error(body.error?.message ?? 'no result from the Hub')
  if (result.isError) throw new Error(result.content?.[0]?.text ?? 'the Hub refused the search')
  return JSON.parse(result.content[0].text)
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    const report = await search(opts)
    console.log(opts.json ? JSON.stringify(report, null, 2) : format(report))
  } catch (e) {
    console.error(`research-search: ${e.message}`)
    process.exitCode = 1
  }
}
