import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLinks, canonicalChannel, dominantBand, electrodePosition, latestByChannel, regionOf, termsIn } from '../src/lib/brain.ts'

test('10-20 names, aliases and regions', () => {
  assert.equal(canonicalChannel('fp1'), 'Fp1')
  assert.equal(canonicalChannel('T3'), 'T7')
  assert.equal(canonicalChannel('T6'), 'P8')
  assert.equal(canonicalChannel('Channel 1'), null)
  assert.equal(regionOf('Fp2'), 'frontal')
  assert.equal(regionOf('Cz'), 'central')
  assert.equal(regionOf('PO7'), 'occipital')
  assert.equal(regionOf('Pz'), 'parietal')
  assert.equal(regionOf('T8'), 'temporal')
})

test('electrode positions sit on the unit sphere with sensible sides', () => {
  for (const n of ['Fp1', 'Fz', 'C3', 'Cz', 'Pz', 'O2', 'T8', 'PO8']) {
    const p = electrodePosition(n)
    assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-9, n)
  }
  assert.ok(electrodePosition('Cz').z > 0.99)
  assert.ok(electrodePosition('C3').x < 0 && electrodePosition('C4').x > 0)       // left negative, right positive
  assert.ok(electrodePosition('Fz').y > 0 && electrodePosition('Pz').y < 0)        // front positive
  assert.equal(electrodePosition('nope'), null)
})

test('latestByChannel keeps the newest sample and ignores unknown channels or bands', () => {
  const m = latestByChannel([
    { channel: 'C3', band: 'alpha', power: 1, rel_power: 0.2, ts: '2026-10-09T10:00:00Z' },
    { channel: 'C3', band: 'alpha', power: 5, rel_power: 0.4, ts: '2026-10-09T10:00:02Z' },
    { channel: 'C3', band: 'omega', power: 9, rel_power: 0.9, ts: '2026-10-09T10:00:03Z' },
    { channel: 'XX', band: 'beta', power: 9, rel_power: 0.9, ts: '2026-10-09T10:00:03Z' },
  ])
  assert.equal(m.size, 1)
  assert.equal(m.get('C3').alpha.power, 5)
  assert.equal(m.get('C3').omega, undefined)
})

test('dominantBand uses relative power, falling back to power', () => {
  assert.equal(dominantBand({ alpha: { power: 1, rel: 0.5 }, beta: { power: 9, rel: 0.2 } }), 'alpha')
  assert.equal(dominantBand({ theta: { power: 3, rel: null }, delta: { power: 2, rel: null } }), 'theta')
  assert.equal(dominantBand({}), null)
})

const vocab = { chemicals: ['dopamine', 'GABA', 'cortisol'], genes: ['BRCA1', 'COMT'] }

test('terms need whole words, and bands/regions need an EEG or brain context', () => {
  const t = (title, meta) => termsIn({ id: 'x', source: 's', title, meta }, vocab).map((x) => `${x.kind}:${x.name}`)
  assert.deepEqual(t('Frontal alpha oscillations and dopamine in EEG'), ['chemical:dopamine', 'band:alpha', 'region:frontal'])
  assert.deepEqual(t('Alpha-particle therapy for frontal tumours'), [])        // no brain/EEG word
  assert.deepEqual(t('Cortical γ-synchrony in EEG and dopamine'), ['chemical:dopamine', 'band:gamma'])   // Greek letters
  assert.deepEqual(t('GABAergic signalling'), [])                              // not a whole word
  assert.deepEqual(t('Something', { gene: 'BRCA1, LOC1' }), ['gene:BRCA1'])
  assert.deepEqual(t('COMT genotype and cortisol'), ['chemical:cortisol', 'gene:COMT'])
})

test('buildLinks counts co-mentions between different kinds only', () => {
  const g = buildLinks([
    { id: 'a', source: 'pubmed', title: 'Dopamine and beta oscillations in the cortex' },
    { id: 'b', source: 'pubmed', title: 'Dopamine, beta rhythm, EEG' },
    { id: 'c', source: 'pubmed', title: 'COMT and dopamine' },
  ], vocab)
  assert.deepEqual(g.mentions.get('chemical:dopamine'), ['a', 'b', 'c'])
  const top = g.edges[0]
  assert.equal(top.records.length, 2)
  assert.deepEqual([top.a.name, top.b.name].sort(), ['beta', 'dopamine'])
  assert.ok(g.edges.every((e) => e.a.kind !== e.b.kind))
})
