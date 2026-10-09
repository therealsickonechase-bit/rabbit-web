import assert from 'node:assert/strict'
import test from 'node:test'
import { applyEdit, guideDigest } from '../src/lib/crispr-sim.ts'

test('the digest matches the one crispr_data.py computes (pinned in both repos)', async () => {
  const rows = [{ id: 'g:1', meta: { transcript: 'T', strand: '+', position: 5, guide: 'A'.repeat(20), pam: 'TGG' } }]
  assert.equal(await guideDigest(rows), '9a7154a950981904764b15e1948c2947b19c9018108f0c95864a6a520c0fd7e7')
})

test('the digest ignores order and changes if a guide changes', async () => {
  const a = { id: 'g:1', meta: { transcript: 'T', strand: '+', position: 5, guide: 'A'.repeat(20), pam: 'TGG' } }
  const b = { id: 'g:2', meta: { transcript: 'T', strand: '-', position: 9, guide: 'C'.repeat(20), pam: 'AGG' } }
  assert.equal(await guideDigest([a, b]), await guideDigest([b, a]))
  assert.notEqual(await guideDigest([a, b]), await guideDigest([a, { ...b, meta: { ...b.meta, position: 10 } }]))
})

// window: 10 nt context + 20 nt guide + 3 nt PAM + 10 nt context
const W = 'AAAAAAAAAA' + 'CCCCCCCCCCGGGGGGGGGG' + 'TGG' + 'TTTTTTTTTT'

test('the cut falls 3 bases before the PAM', () => {
  const r = applyEdit(W, 10, { type: 'none' })
  assert.equal(r.cut, 27)
  assert.equal(W.slice(r.cut, r.cut + 3), 'GGG')   // the 3 bases between the cut and the PAM
  assert.equal(r.after, W)
  assert.equal(r.lengthChange, 0)
})

test('a deletion removes bases after the cut and reports the frame', () => {
  const r = applyEdit(W, 10, { type: 'delete', n: 1 })
  assert.equal(r.after.length, W.length - 1)
  assert.equal(r.keepsFrame, false)
  assert.deepEqual(r.deleted, { start: 27, end: 28 })
  assert.equal(applyEdit(W, 10, { type: 'delete', n: 3 }).keepsFrame, true)
})

test('an insertion adds bases at the cut', () => {
  const r = applyEdit(W, 10, { type: 'insert', bases: 'AT' })
  assert.equal(r.after.slice(27, 29), 'AT')
  assert.equal(r.lengthChange, 2)
  assert.deepEqual(r.inserted, { start: 27, end: 29 })
})

test('bad insertions are refused and deletions are capped', () => {
  assert.throws(() => applyEdit(W, 10, { type: 'insert', bases: 'ACGTX' }))
  assert.throws(() => applyEdit(W, 10, { type: 'insert', bases: '' }))
  assert.equal(applyEdit(W, 10, { type: 'delete', n: 999 }).lengthChange, -10)
})
