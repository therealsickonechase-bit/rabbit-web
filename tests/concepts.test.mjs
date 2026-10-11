import assert from 'node:assert/strict'
import test from 'node:test'
import { conceptForOrgan, lookupMesh, parseMeshHits, validTerm } from '../src/lib/concepts.ts'
import { bodyModelJson } from '../src/lib/body-api.ts'
import { ORGAN_IDS } from '../src/lib/body.ts'

test('every organ in the model has a MeSH ID that NLM returned', () => {
  for (const id of ORGAN_IDS) {
    const c = conceptForOrgan(id)
    assert.ok(c, `no concept for ${id}`); assert.match(c.mesh.id, /^D\d{6,9}$/); assert.ok(c.mesh.uri.endsWith(c.mesh.id))
    if (c.umls) assert.match(c.umls.cui, /^C\d{7}$/)
  }
  assert.equal(conceptForOrgan('heart').mesh.id, 'D006321')
  assert.equal(bodyModelJson('organs').data.every((o) => o.concepts?.mesh), true)
})

test('terms are validated before they reach NLM', () => {
  assert.equal(validTerm('hippocampus'), true); assert.equal(validTerm('BRCA1'), true); assert.equal(validTerm('type 2 diabetes'), true)
  for (const bad of ['', 'a', 'x'.repeat(81), '<script>', 'a&b=c', 'drop;table', '../etc']) assert.equal(validTerm(bad), false, bad)
})

test('answers from NLM are checked: only real MeSH descriptor URIs are kept', () => {
  const hits = parseMeshHits([{ resource: 'http://id.nlm.nih.gov/mesh/D006624', label: 'Hippocampus' }, { resource: 'http://evil.example/mesh/D1', label: 'x' }, { resource: 'http://id.nlm.nih.gov/mesh/Q000', label: 'q' }, null])
  assert.deepEqual(hits, [{ id: 'D006624', label: 'Hippocampus', uri: 'https://id.nlm.nih.gov/mesh/D006624' }])
  assert.deepEqual(parseMeshHits({ not: 'an array' }), [])
})

test('lookup tries exact then contains, caches, and reports an unreachable service as null', async () => {
  const calls = []
  const fake = async (url) => { calls.push(url); return { ok: true, json: async () => (url.includes('match=exact') ? [] : [{ resource: 'http://id.nlm.nih.gov/mesh/D006624', label: 'Hippocampus' }]) } }
  const a = await lookupMesh('hippo-test', fake, 1000); assert.equal(a[0].id, 'D006624'); assert.equal(calls.length, 2)
  await lookupMesh('hippo-test', fake, 2000); assert.equal(calls.length, 2)
  assert.equal(await lookupMesh('down-term', async () => { throw new Error('offline') }, 1), null)
  assert.deepEqual(await lookupMesh('<bad>', fake), [])
})
