import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { FORBIDDEN_KEY, GENESIS_HEAD, LEDGER_TABLE_NAMES, buildEvents, isClean, makeDraft, planRestore, publicEvent, verifyChain } from '../src/lib/chain-ledger.ts'
import { MAXWELL_FORBIDDEN, MAXWELL_ZERO, MAX_BLOCK_BYTES, validateMaxwellBlock } from '../src/lib/maxwell-block.ts'
import { MAX_BLOCKS_PER_CALL, MAX_BODY_BYTES, neededIndexes, parseMirrorBody, planMaxwellMirror, statusFor } from '../src/lib/maxwell-mirror.ts'
import { verifySignature } from '../src/lib/ingest.ts'

const h = (s) => createHash('sha256').update(s).digest('hex')
const block = (index, prev, extra = {}) => ({
  index, timestamp: 1791531395.73 + index, previous_hash: prev, nonce: index * 7, hash: h(`b${index}${prev}`),
  transactions: [{ sender: 'MAXWELL_GENESIS', recipient: 'NETWORK', amount: 0, note: 'hello world' }], ...extra,
})
function makeChain(n) {
  const out = []
  let prev = MAXWELL_ZERO
  for (let i = 0; i < n; i++) { const b = block(i, prev); out.push(b); prev = b.hash }
  return out
}
const mirroredOf = (blocks) => new Map(blocks.map((b) => [b.index, b.hash]))

test('a valid block passes and is reduced to the six keys', () => {
  const v = validateMaxwellBlock(block(0, MAXWELL_ZERO))
  assert.equal(v.ok, true)
  assert.deepEqual(Object.keys(v.block).sort(), ['hash', 'index', 'nonce', 'previous_hash', 'timestamp', 'transactions'])
})

test('validation refuses extra keys, bad hashes, bad types and oversize blocks', () => {
  const g = block(0, MAXWELL_ZERO)
  const bad = (patch, re) => { const v = validateMaxwellBlock({ ...g, ...patch }); assert.equal(v.ok, false); assert.match(v.reason, re) }
  bad({ extra: 1 }, /unexpected field/)
  bad({ hash: 'ABC' }, /hash/)
  bad({ hash: 'a'.repeat(63) }, /hash/)
  bad({ previous_hash: 'g'.repeat(64) }, /previous_hash/)
  bad({ index: -1 }, /index/)
  bad({ index: 1.5 }, /index/)
  bad({ nonce: '3' }, /nonce/)
  bad({ timestamp: Infinity }, /timestamp/)
  bad({ transactions: 'x' }, /transactions/)
  bad({ transactions: Array.from({ length: 21 }, () => ({ a: 1 })) }, /at most 20/)
  bad({ transactions: [{ note: null }] }, /string or a number/)
  bad({ transactions: [{ note: { deep: 1 } }] }, /string or a number/)
  bad({ transactions: [{ note: true }] }, /string or a number/)
  bad({ transactions: [[1]] }, /object/)
  bad({ transactions: [{ 'bad key': 1 }] }, /field names/)
  bad({ transactions: [{ note: 'x'.repeat(1001) }] }, /too long/)
  bad({ transactions: Array.from({ length: 20 }, () => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, 'y'.repeat(900)]))) }, /larger than/)
  bad({ previous_hash: h('x') }, /block 0/)
  const missing = { ...g }; delete missing.nonce
  assert.equal(validateMaxwellBlock(missing).ok, false)
  assert.equal(validateMaxwellBlock(null).ok, false)
  assert.equal(validateMaxwellBlock([]).ok, false)
  assert.ok(MAX_BLOCK_BYTES <= 20_000)
})

test('protected fields are refused, not silently dropped', () => {
  for (const k of ['password', 'api_key', 'secret', 'subject_dob', 'private_key']) {
    const v = validateMaxwellBlock(block(0, MAXWELL_ZERO, { transactions: [{ [k]: 'x' }] }))
    assert.equal(v.ok, false, k)
    assert.throws(() => makeDraft('maxwell_chain', 'insert', block(0, MAXWELL_ZERO, { transactions: [{ [k]: 'x' }] })), /maxwell_chain/)
  }
  assert.equal(MAXWELL_FORBIDDEN.source, FORBIDDEN_KEY.source)
  assert.equal(MAXWELL_FORBIDDEN.flags, FORBIDDEN_KEY.flags)
  assert.equal(validateMaxwellBlock({ ...block(0, MAXWELL_ZERO), __proto__x: 1 }).ok, false)
  assert.equal(validateMaxwellBlock(JSON.parse('{"__proto__": {"a": 1}}')).ok, false)
})

test('the ledger accepts maxwell_chain only in the strict shape', async () => {
  assert.ok(LEDGER_TABLE_NAMES.includes('maxwell_chain'))
  const g = block(0, MAXWELL_ZERO)
  const d = makeDraft('maxwell_chain', 'insert', { ...g })
  assert.equal(d.row_id, '0')
  assert.deepEqual(d.payload, g)
  const [ev] = await buildEvents(GENESIS_HEAD, [d])
  assert.equal(isClean(ev), true)
  assert.deepEqual(publicEvent(ev).payload, g)
  assert.equal(isClean({ ...ev, payload: { ...g, extra: 1 } }), false)
  assert.equal(isClean({ ...ev, row_id: '5' }), false)
  assert.equal(publicEvent({ ...ev, payload: { ...g, extra: 1 } }), null)
  assert.equal((await verifyChain([ev])).ok, true)
  // there is no live table behind it, so restore never plans it
  assert.deepEqual(planRestore([ev]), [])
  assert.deepEqual(planRestore([ev], ['maxwell_chain']), [])
})

test('body parsing: size cap, shape, count cap', () => {
  assert.equal(parseMirrorBody('{bad').status, 400)
  assert.equal(parseMirrorBody('[]').status, 400)
  assert.equal(parseMirrorBody('{"blocks":[]}').status, 400)
  assert.equal(parseMirrorBody('{"blocks":[{}],"x":1}').status, 400)
  assert.equal(parseMirrorBody(JSON.stringify({ blocks: [{}], pad: 'x'.repeat(MAX_BODY_BYTES) })).status, 413)
  assert.equal(parseMirrorBody(JSON.stringify({ blocks: makeChain(MAX_BLOCKS_PER_CALL + 1) })).status, 400)
  const ok = parseMirrorBody(JSON.stringify({ blocks: makeChain(MAX_BLOCKS_PER_CALL) }))
  assert.equal(ok.ok, true)
  assert.equal(ok.blocks.length, MAX_BLOCKS_PER_CALL)
})

test('linkage: a whole new chain is accepted in index order, whatever the order sent', () => {
  const chain = makeChain(4)
  const plan = planMaxwellMirror([chain[2], chain[0], chain[3], chain[1]], new Map())
  assert.deepEqual(plan.accepted.map((b) => b.index), [0, 1, 2, 3])
  assert.equal(plan.skipped, 0)
  assert.deepEqual(plan.rejected, [])
  assert.equal(statusFor(plan), 200)
})

test('linkage: a new batch must continue the mirrored head', () => {
  const chain = makeChain(5)
  const plan = planMaxwellMirror(chain.slice(3), mirroredOf(chain.slice(0, 3)))
  assert.deepEqual(plan.accepted.map((b) => b.index), [3, 4])
})

test('linkage: broken previous_hash, a gap and a bad genesis are rejected', () => {
  const chain = makeChain(4)
  const broken = { ...chain[1], previous_hash: h('wrong') }
  let plan = planMaxwellMirror([chain[0], broken], new Map())
  assert.equal(plan.rejected[0].code, 'link')
  assert.equal(statusFor(plan), 422)
  plan = planMaxwellMirror([chain[2]], mirroredOf(chain.slice(0, 1)))
  assert.equal(plan.rejected[0].code, 'gap')
  assert.equal(statusFor(plan), 422)
  plan = planMaxwellMirror([chain[1]], new Map())
  assert.equal(plan.rejected[0].code, 'gap')
  plan = planMaxwellMirror([{ ...chain[0], previous_hash: h('x') }], new Map())
  assert.equal(plan.rejected[0].code, 'invalid')
  assert.equal(statusFor(plan), 400)
})

test('idempotency: blocks already mirrored with the same hash are skipped', () => {
  const chain = makeChain(4)
  const plan = planMaxwellMirror(chain, mirroredOf(chain.slice(0, 2)))
  assert.equal(plan.skipped, 2)
  assert.deepEqual(plan.accepted.map((b) => b.index), [2, 3])
  const again = planMaxwellMirror(chain, mirroredOf(chain))
  assert.equal(again.skipped, 4)
  assert.equal(again.accepted.length, 0)
  assert.equal(statusFor(again), 200)
})

test('conflict: the same index with a different hash is rejected (409) and never accepted', () => {
  const chain = makeChain(3)
  const forged = { ...chain[1], hash: h('forged') }
  const plan = planMaxwellMirror([forged], mirroredOf(chain))
  assert.equal(plan.rejected[0].code, 'conflict')
  assert.equal(plan.accepted.length, 0)
  assert.equal(statusFor(plan), 409)
  // a conflict wins over other problems
  const mixed = planMaxwellMirror([forged, { ...chain[2], previous_hash: h('z') }], mirroredOf(chain.slice(0, 2)))
  assert.equal(statusFor(mixed), 409)
})

test('the same index twice in one call is rejected', () => {
  const chain = makeChain(2)
  const plan = planMaxwellMirror([chain[0], chain[0]], new Map())
  assert.equal(plan.rejected[0].code, 'duplicate')
})

test('neededIndexes lists each block and its predecessor', () => {
  assert.deepEqual(neededIndexes([{ index: 3 }, { index: 0 }, { index: 'x' }, null]), [0, 2, 3])
})

test('signature scheme is the existing ingest HMAC: hex HMAC-SHA256(secret, `${ts}.${body}`)', async () => {
  const { createHmac } = await import('node:crypto')
  const body = JSON.stringify({ blocks: makeChain(1) })
  const ts = String(Date.now())
  const sig = createHmac('sha256', 's3cret').update(`${ts}.${body}`).digest('hex')
  assert.equal(await verifySignature('s3cret', ts, body, sig), true)
  assert.equal(await verifySignature('s3cret', ts, body + ' ', sig), false)
  assert.equal(await verifySignature('other', ts, body, sig), false)
})

test('route wiring: signed, rate limited, ledger via recordWrite, no payload logging, never overwrites', () => {
  const src = readFileSync(new URL('../src/app/api/ingest/maxwell-chain/route.ts', import.meta.url), 'utf8')
  assert.match(src, /INGEST_SHARED_SECRET/)
  assert.match(src, /verifySignature\(/)
  assert.match(src, /createLimiter\(/)
  assert.match(src, /recordWrite\(MAXWELL_TABLE, 'insert'/)
  assert.ok(src.indexOf('verifySignature(') < src.indexOf('parseMirrorBody('))
  assert.ok(src.indexOf('statusFor(plan)') < src.indexOf('recordWrite('))
  assert.ok(!/\.(update|upsert|delete)\(/.test(src))
  assert.ok(!/console\.\w+\([^)]*(body|blocks|payload)/.test(src.replace(/parsed\.blocks/g, '')), 'logs must not include payloads')
})

test('RabbitNet module and migration know the new table', () => {
  const psm1 = readFileSync(new URL('../scripts/powershell/RabbitNet.psm1', import.meta.url), 'utf8')
  const line = psm1.split('\n').find((l) => l.includes('$script:LedgerTables'))
  for (const t of LEDGER_TABLE_NAMES) assert.ok(line.includes(`'${t}'`), `${t} missing from RabbitNet.psm1`)
  const sql = readFileSync(new URL('../supabase/migrations/20261014010000_chain_ledger_maxwell.sql', import.meta.url), 'utf8')
  assert.match(sql, /'maxwell_chain'/)
  assert.match(sql, /pg_get_constraintdef/)
  assert.match(sql, /drop constraint/)
  for (const t of LEDGER_TABLE_NAMES) assert.ok(sql.includes(`'${t}'`), `${t} missing from the migration check`)
  const chainPull = new URL('../../research-agents/chain_pull.py', import.meta.url)
  if (existsSync(chainPull)) {
    const py = readFileSync(chainPull, 'utf8')
    const stale = LEDGER_TABLE_NAMES.filter((t) => !py.includes(`"${t}"`))
    if (stale.length) console.warn('research-agents/chain_pull.py TABLES is missing:', stale.join(', '))
  }
})
