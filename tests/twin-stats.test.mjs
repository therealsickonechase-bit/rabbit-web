import assert from 'node:assert/strict'
import test from 'node:test'
import { bandShares, groupVariants, isConcerning, linearTrend, primaryGene, variantClass, zBand } from '../src/lib/twin-stats.ts'

test('linearTrend recovers an exact line and projects forward', () => {
  const t = linearTrend([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }])
  assert.ok(t)
  assert.ok(Math.abs(t.slope - 2) < 1e-9 && Math.abs(t.intercept - 1) < 1e-9)
  assert.ok(Math.abs(t.at(10) - 21) < 1e-9)
})

test('linearTrend refuses to fit too few or identical-x points', () => {
  assert.equal(linearTrend([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null)
  assert.equal(linearTrend([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]), null)
})

test('zBand and bandShares', () => {
  assert.equal(zBand(0.5), 'within')
  assert.equal(zBand(-1.5), 'watch')
  assert.equal(zBand(2.4), 'outside')
  assert.equal(zBand(null), 'unknown')
  const s = bandShares([0, 0.2, 1.5, 3, null])
  assert.deepEqual(s.counts, { within: 2, watch: 1, outside: 1, unknown: 1 })
  assert.equal(s.pct('within'), 50)
  assert.equal(bandShares([]).pct('within'), 0)
})

test('variant classes and genes are normalised', () => {
  assert.equal(variantClass('likely PATHOGENIC'), 'Likely pathogenic')
  assert.equal(variantClass('something else'), 'Other')
  assert.equal(primaryGene('brca1, LOC111589215'), 'BRCA1')
  assert.equal(primaryGene(undefined), 'UNKNOWN')
  assert.equal(isConcerning('Pathogenic'), true)
  assert.equal(isConcerning('Likely benign'), false)
})

test('groupVariants counts per gene and orders by size', () => {
  const rows = [
    { id: 'a', title: 'a', meta: { gene: 'BRCA2', classification: 'Likely benign' } },
    { id: 'b', title: 'b', meta: { gene: 'BRCA1', classification: 'Pathogenic' } },
    { id: 'c', title: 'c', meta: { gene: 'BRCA1, LOC1', classification: 'Likely benign' } },
  ]
  const g = groupVariants(rows)
  assert.equal(g[0].gene, 'BRCA1')
  assert.equal(g[0].total, 2)
  assert.equal(g[0].counts.Pathogenic, 1)
  assert.equal(g[1].gene, 'BRCA2')
})
