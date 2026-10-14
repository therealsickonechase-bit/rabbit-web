import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { publicApiAllowed } from '../src/lib/account-free.ts'
import {
  DATASETS, MAX_LIMIT, NEVER_IN_HUB, SECRET_LIKE, buildManifest, buildPage, cleanSearch, csvCell, curlCommand, decodeCursor, encodeCursor,
  getDataset, memoryRows, parseQuery, publicRow, queryMemory, stripSecretLike, toCsv, toNdjson,
} from '../src/lib/data-hub.ts'
import { APP_PAGES, COLS, OPEN_READ_TABLES, PROTECTED_TABLES, TWIN_PUBLIC_COLUMNS } from '../src/lib/open-access.ts'

const q = (s) => new URLSearchParams(s)
const ids = DATASETS.map((d) => d.id)

test('the registry lists exactly the approved datasets', () => {
  assert.deepEqual([...ids].sort(), ['agents', 'audit_entries', 'chain_blocks', 'commands', 'ledger', 'merkle_batches', 'node_scores', 'research_records', 'research_runs', 'research_summaries', 'research_topics'])
  assert.equal(new Set(ids).size, ids.length)
})

test('personal and protected tables are not in the registry', () => {
  for (const name of [...NEVER_IN_HUB, ...PROTECTED_TABLES]) {
    assert.ok(!ids.includes(name), name)
    assert.ok(!DATASETS.some((d) => d.table === name), name)
    assert.equal(getDataset(name), null)
  }
  for (const name of ['chat_threads', 'chat_messages', 'notes', 'collections', 'kg_edges', 'eeg_band_samples', 'self_daily']) {
    assert.ok(NEVER_IN_HUB.includes(name), name)
    assert.ok(!DATASETS.some((d) => d.table === name || d.id === name), name)
  }
})

test('every database dataset is an opened table (or the ledger) and its columns are explicit and not secret-like', () => {
  for (const d of DATASETS) {
    assert.ok(d.columns.length > 0 && !d.columns.includes('*'), d.id)
    assert.equal(new Set(d.columns).size, d.columns.length, d.id)
    for (const c of d.columns) {
      assert.match(c, /^[a-z_]+$/, `${d.id}.${c}`)
      assert.ok(!SECRET_LIKE.test(c), `${d.id}.${c} looks secret`)
    }
    for (const list of [d.searchable, d.sortable, d.filterable, d.json ?? [], [d.key], [d.defaultSort.column]]) for (const c of list) assert.ok(d.columns.includes(c), `${d.id}: ${c} is not a declared column`)
    if (d.kind === 'table') {
      assert.ok(OPEN_READ_TABLES.includes(d.table), d.table)
      assert.ok(!PROTECTED_TABLES.includes(d.table), d.table)
    }
  }
  const agents = getDataset('agents')
  for (const c of agents.columns) assert.ok(COLS.agents.split(', ').includes(c), c)
  assert.ok(!agents.columns.includes('twin_id'))
  for (const c of getDataset('audit_entries').columns) assert.ok(COLS.audit.split(', ').includes(c), c)
  for (const t of TWIN_PUBLIC_COLUMNS) assert.ok(!getDataset('agents').columns.includes(t) || t === 'id')
})

test('the ledger dataset carries hashes only, never payloads or row ids', () => {
  const l = getDataset('ledger')
  assert.deepEqual(l.columns, ['seq', 'tbl', 'op', 'prev_hash', 'hash', 'created_at'])
  assert.ok(!l.columns.includes('payload') && !l.columns.includes('row_id'))
})

test('rows are cut to declared columns and secret-like keys are removed at any depth', () => {
  const ds = getDataset('research_records')
  const row = publicRow(ds, { id: 'a', source: 'pubmed', title: 't', user_id: 'u', api_key: 'k', email: 'e@x', meta: { journal: 'J', token: 'x', nested: [{ secret: 1, ok: 2 }, { Password: 3 }] }, extra: 1 })
  assert.deepEqual(Object.keys(row), ['id', 'source', 'title', 'meta'])
  assert.deepEqual(row.meta, { journal: 'J', nested: [{ ok: 2 }, {}] })
  assert.deepEqual(stripSecretLike({ a: { user_id: 1, userId: 2, created_by: 3, e_mail: 4, b: 5 } }), { a: { e_mail: 4, b: 5 } })
})

test('param validation: limit, sort, format, cursor, filters', () => {
  const ds = getDataset('research_records')
  const ok = parseQuery(ds, q(''))
  assert.equal(ok.ok, true)
  assert.deepEqual([ok.query.limit, ok.query.offset, ok.query.sort, ok.query.dir, ok.query.format], [50, 0, 'first_seen_at', 'desc', 'json'])
  assert.equal(parseQuery(ds, q('limit=5000')).query.limit, MAX_LIMIT)
  assert.equal(parseQuery(ds, q('limit=200')).query.limit, 200)
  for (const bad of ['limit=0', 'limit=-1', 'limit=abc', 'limit=1.5', 'limit=1;drop', 'sort=password', 'sort=title;drop', 'sort=-user_id', 'format=xml', 'cursor=!!!', 'cursor=' + 'a'.repeat(70), 'user_id=1', 'nonsense=1', 'title=x', 'topic_id=abc']) {
    const r = parseQuery(ds, q(bad))
    assert.equal(r.ok, false, bad); assert.equal(r.status, 400, bad)
  }
  const s = parseQuery(ds, q('sort=-title&format=CSV&source=pubmed&topic_id=7&download=1'))
  assert.deepEqual([s.query.sort, s.query.dir, s.query.format, s.query.filters, s.query.download], ['title', 'desc', 'csv', { source: 'pubmed', topic_id: '7' }, true])
  assert.equal(parseQuery(ds, q('sort=title')).query.dir, 'asc')
  assert.equal(parseQuery(getDataset('merkle_batches'), q('sort=created_at')).ok, true)
})

test('search text can not carry filter syntax or wildcards', () => {
  assert.equal(cleanSearch('a,b.ilike.%x%_(y)"z" \\ * ;'), 'a b ilike x y z')
  assert.equal(cleanSearch('BRCA1 trial-2: ok'), 'BRCA1 trial-2: ok')
  assert.ok(cleanSearch('x'.repeat(500)).length <= 80)
  assert.equal(parseQuery(getDataset('research_records'), q("q=a%2Cb)'--")).query.q, 'a b --')
})

test('cursor round trip and rejection of forged cursors', () => {
  for (const n of [0, 1, 50, 99_999, 100_000]) assert.equal(decodeCursor(encodeCursor(n)), n)
  assert.equal(parseQuery(getDataset('agents'), q('cursor=' + encodeCursor(150))).query.offset, 150)
  assert.match(encodeCursor(123456), /^[A-Za-z0-9_-]+$/)
  for (const bad of ['', 'abc', btoa('{"o":-1}'), btoa('{"o":1.5}'), btoa('{"o":"1"}'), btoa('{"o":100001}'), btoa('not json'), 'e30']) assert.equal(decodeCursor(bad), null, bad)
})

test('csv escaping and formula injection', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"')
  for (const f of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx', '|calc', '%x']) assert.ok(csvCell(f).replace(/^"/, '').startsWith("'"), f)
  assert.equal(csvCell(-5), '-5')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"')
  assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"')
  assert.equal(toCsv(['a', 'b'], [{ a: 1, b: '=x' }, { a: 'q,r' }]), "a,b\r\n1,'=x\r\n\"q,r\",\r\n")
  assert.equal(toNdjson([{ a: 1 }, { a: 2 }]), '{"a":1}\n{"a":2}\n')
  assert.equal(toNdjson([]), '')
})

test('a page asks for limit+1 rows, reports a next cursor and never exceeds the cap', () => {
  const ds = getDataset('agents')
  const query = parseQuery(ds, q('limit=2')).query
  const rows = [1, 2, 3].map((n) => ({ node_id: 'n' + n, kind: 'research', created_at: 't', last_seen_at: null, twin_id: 'secret-twin' }))
  const p = buildPage(ds, rows, query)
  assert.equal(p.count, 2)
  assert.equal(decodeCursor(p.nextCursor), 2)
  assert.ok(!JSON.stringify(p).includes('secret-twin'))
  assert.equal(buildPage(ds, rows.slice(0, 2), query).nextCursor, null)
  const big = parseQuery(ds, q('limit=999')).query
  assert.equal(big.limit, 200)
  assert.equal(buildPage(ds, Array.from({ length: 300 }, (_, i) => ({ node_id: 'n' + i })), big).count, 200)
})

test('commands dataset: public entries only, searchable, no env names', () => {
  const ds = getDataset('commands')
  const all = memoryRows(ds)
  assert.ok(all.length > 20)
  assert.ok(all.every((r) => Object.keys(r).join() === ds.columns.join()))
  assert.ok(!all.some((r) => /deploy|SERVICE_ROLE/.test(String(r.command))))
  const hit = queryMemory(ds, all, parseQuery(ds, q('q=data hub&limit=5')).query)
  assert.ok(hit.length > 0 && hit.length <= 6)
  assert.equal(memoryRows(getDataset('agents')).length, 0)
})

test('manifest shape', () => {
  const m = buildManifest(Object.fromEntries(ids.map((i) => [i, 3])), { length: 9, headHash: 'h', updatedAt: null })
  assert.equal(m.readOnly, true); assert.equal(m.maxLimit, 200)
  assert.deepEqual(m.datasets.map((d) => d.id), ids)
  for (const d of m.datasets) {
    assert.equal(d.endpoint, `/api/data/${d.id}`); assert.equal(d.rows, 3)
    assert.deepEqual(d.formats, ['json', 'csv', 'ndjson'])
    assert.ok(Array.isArray(d.columns) && d.columns.length)
  }
  assert.equal(buildManifest({}, null).datasets[0].rows, null)
  assert.equal(m.ledgerHead.length, 9)
  assert.ok(!JSON.stringify(m).match(/chat_|kg_edges|eeg_band|self_daily|contact_records/))
  assert.equal(curlCommand('agents'), 'curl -fsS "$ORIGIN/api/data/agents?limit=50" | jq')
})

test('routes: GET, HEAD and OPTIONS only, only /api/data and /api/data/<name>', () => {
  for (const p of ['/api/data', '/api/data/research_records', '/api/data/ledger']) {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal(publicApiAllowed(p, m), true, p + m)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(publicApiAllowed(p, m), false, p + m)
  }
  for (const p of ['/api/data/', '/api/data/a/b', '/api/data/../self/daily', '/api/data/x?y', '/api/database', '/api/datax', '/api/data/Notes', '/api/data/%2e%2e']) assert.equal(publicApiAllowed(p, 'GET'), false, p)
  assert.ok(APP_PAGES.includes('data'))
})

test('route files exist, are GET-only and use no wildcard selects', () => {
  for (const f of ['src/app/api/data/route.ts', 'src/app/api/data/[dataset]/route.ts']) {
    const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)|export const (POST|PUT|PATCH|DELETE)/.test(s), f)
    assert.match(s, /GET/); assert.match(s, /OPTIONS/)
  }
  const db = readFileSync(new URL('../src/lib/data-hub-db.ts', import.meta.url), 'utf8')
  assert.ok(!/select\('\*'\)|select\("\*"\)/.test(db))
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(db))
  assert.ok(existsSync(new URL('../src/app/(app)/data/page.tsx', import.meta.url)))
})
