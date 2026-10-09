import assert from 'node:assert/strict'
import test from 'node:test'
import { BATCH, DIMS, embedTexts, recordText, toVectorLiteral } from '../src/lib/embed.ts'

const vec = (seed) => Array.from({ length: DIMS }, (_, i) => (i + seed) / DIMS)
const fakeAi = (log = []) => ({ run: async (model, { text }) => { log.push([model, text.length]); return { shape: [text.length, DIMS], data: text.map((_, i) => vec(i)) } } })

test('record text is the title plus short descriptive fields, capped', () => {
  assert.equal(recordText({ title: 'T', source: 's', meta: { gene: 'BRCA1', journal: 'Nature', junk: 'x', status: 'x'.repeat(200) } }), 'T. BRCA1. Nature')
  assert.equal(recordText({ title: 'Only title', source: 's' }), 'Only title')
  assert.equal(recordText({ title: 'a'.repeat(5000), source: 's' }).length, 1000)
})

test('texts are embedded in batches, in order, using the right model', async () => {
  const log = []
  const out = await embedTexts(fakeAi(log), Array.from({ length: BATCH * 2 + 3 }, (_, i) => `t${i}`))
  assert.equal(out.length, BATCH * 2 + 3)
  assert.deepEqual(log.map((l) => l[1]), [BATCH, BATCH, 3])
  assert.equal(log[0][0], '@cf/baai/bge-base-en-v1.5')
  assert.equal(out[0].length, DIMS)
})

test('malformed AI responses are rejected, not stored', async () => {
  const bad = (data) => ({ run: async () => ({ data }) })
  await assert.rejects(() => embedTexts(bad(undefined), ['a']))
  await assert.rejects(() => embedTexts(bad([vec(0), vec(1)]), ['a']))            // wrong count
  await assert.rejects(() => embedTexts(bad([[1, 2, 3]]), ['a']))                 // wrong size
  await assert.rejects(() => embedTexts(bad([vec(0).map((x, i) => (i === 5 ? NaN : x))]), ['a']))
  await assert.rejects(() => embedTexts(bad([vec(0).map((x, i) => (i === 5 ? 'x' : x))]), ['a']))
})

test('vector literal matches the pgvector text form', () => {
  assert.equal(toVectorLiteral([0.5, -1, 2]), '[0.5,-1,2]')
})
