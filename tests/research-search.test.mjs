import assert from 'node:assert/strict'
import test from 'node:test'
import { format, parseArgs, search } from '../scripts/research-search.mjs'

const report = {
  query: 'antigravity',
  live: [{ source: 'openalex', name: 'OpenAlex', items: [{ title: 'Antigravity: A crazy idea?', date: '1979', url: 'https://doi.org/10.1/x', inRabbitOS: true }] }, { source: 'inspirehep', name: 'INSPIRE-HEP', items: [], error: 'INSPIRE-HEP returned 503' }],
  rabbitos: { records: [{ title: 'Antigravity: A crazy idea?', maxwell: { status: 'covered', block: 7 } }, { title: 'New one', maxwell: { status: 'not yet' } }] },
  maxwell: { latestResearchAnchor: { block: 7, count: 918, time: '2026-10-16T16:43:32.000Z' } },
  googleCloud: { publicRecords: 1309, refreshedAt: '2026-10-16T20:21:29Z' },
  caution: 'Results are pointers, not endorsements.',
}

test('arguments are parsed and checked', () => {
  const o = parseArgs(['anti', 'gravity', '--sources', 'openalex,inspirehep', '--limit', '3'])
  assert.deepEqual([o.query, o.sources, o.limit], ['anti gravity', ['openalex', 'inspirehep'], 3])
  for (const bad of [[], ['x'], ['ok query', '--limit', '99'], ['ok query', '--nope'], ['ok query', '--hub', 'http://x']]) assert.throws(() => parseArgs(bad))
})

test('the report is readable and shows Maxwell coverage and failures', () => {
  const t = format(report)
  assert.match(t, /OpenAlex: 1 result\(s\)[\s\S]*\[already in RabbitOS\]/)
  assert.match(t, /INSPIRE-HEP: INSPIRE-HEP returned 503/)
  assert.match(t, /\[Maxwell: block 7\]/)
  assert.match(t, /\[Maxwell: not yet\]/)
  assert.match(t, /Maxwell: block 7 anchors 918/)
  assert.match(t, /Google Cloud: 1309 public records/)
})

test('search calls research_link on the Hub and unwraps the answer, including event-stream replies and errors', async () => {
  let sent
  const ok = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(report) }] } })) }
  const r = await search(parseArgs(['antigravity', '--sources', 'openalex']), ok)
  assert.equal(r.query, 'antigravity')
  assert.deepEqual([sent.params.name, sent.params.arguments.sources], ['research_link', ['openalex']])
  const sse = async () => new Response('event: message\ndata: ' + JSON.stringify({ result: { content: [{ text: JSON.stringify(report) }] } }) + '\n\n')
  assert.equal((await search(parseArgs(['antigravity']), sse)).googleCloud.publicRecords, 1309)
  const refused = async () => new Response(JSON.stringify({ result: { isError: true, content: [{ text: 'bad source' }] } }))
  await assert.rejects(search(parseArgs(['antigravity']), refused), /bad source/)
  await assert.rejects(search(parseArgs(['antigravity']), async () => new Response('', { status: 502 })), /502/)
})
