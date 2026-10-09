import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { buildLevels, leafHash, merkleProof, merkleRoot, verifyProof } from '../src/lib/merkle.ts'

const sha = (...bufs) => createHash('sha256').update(Buffer.concat(bufs)).digest('hex')
const items = (n) => Array.from({ length: n }, (_, i) => sha(Buffer.from(`entry-${i}`)))

test('leaf and node hashes match an independent implementation', async () => {
  const [a, b] = items(2)
  const la = sha(Buffer.from([0]), Buffer.from(a)), lb = sha(Buffer.from([0]), Buffer.from(b))
  assert.equal(await leafHash(a), la)
  assert.equal(await merkleRoot([a, b]), sha(Buffer.from([1]), Buffer.from(la, 'hex'), Buffer.from(lb, 'hex')))
})

test('every entry of every batch size has a valid proof', async () => {
  for (const n of [1, 2, 3, 5, 8, 9, 16, 33]) {
    const e = items(n)
    const root = await merkleRoot(e)
    for (let i = 0; i < n; i++) assert.equal(await verifyProof(e[i], await merkleProof(e, i), root), true, `n=${n} i=${i}`)
  }
})

test('proofs are short (logarithmic)', async () => {
  const e = items(256)
  assert.equal((await merkleProof(e, 100)).length, 8)
})

test('changing, adding, removing or reordering any entry changes the root', async () => {
  const e = items(9), root = await merkleRoot(e)
  const changed = [...e]; changed[4] = sha(Buffer.from('tampered'))
  assert.notEqual(await merkleRoot(changed), root)
  assert.notEqual(await merkleRoot([...e, sha(Buffer.from('extra'))]), root)
  assert.notEqual(await merkleRoot(e.slice(0, 8)), root)
  assert.notEqual(await merkleRoot([e[1], e[0], ...e.slice(2)]), root)
})

test('a proof fails for the wrong entry, the wrong root, or a tampered sibling', async () => {
  const e = items(10), root = await merkleRoot(e), p = await merkleProof(e, 3)
  assert.equal(await verifyProof(e[4], p, root), false)
  assert.equal(await verifyProof(e[3], p, sha(Buffer.from('x'))), false)
  assert.equal(await verifyProof(e[3], [{ ...p[0], sibling: sha(Buffer.from('y')) }, ...p.slice(1)], root), false)
  assert.equal(await verifyProof(e[3], [{ ...p[0], sibling: 'zz' }, ...p.slice(1)], root), false)
})

test('odd batches do not collide (no CVE-2012-2459 duplication)', async () => {
  const e = items(3)
  assert.notEqual(await merkleRoot(e), await merkleRoot([...e, e[2]]))
})

test('an inner node cannot be passed off as an entry (domain separation)', async () => {
  const e = items(4)
  const levels = await buildLevels(e)
  const fakeEntry = levels[1][0]                    // an inner node hash
  const root = await merkleRoot(e)
  assert.equal(await verifyProof(fakeEntry, [{ sibling: levels[1][1], side: 'right' }], root), false)
})

test('empty batches and bad indexes are refused', async () => {
  await assert.rejects(() => merkleRoot([]))
  await assert.rejects(() => merkleProof(items(3), 3))
})
