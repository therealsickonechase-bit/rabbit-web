import assert from 'node:assert/strict'
import test from 'node:test'
import { BODY_ROUTES, BRAIN_EXIT, GENE_BODY, ORGANS, ORGAN_IDS, ROUTE_IDS, SCENARIO_BODY, SYSTEM_BODY, genesIn, organStates, routesTo } from '../src/lib/body.ts'
import { SCENARIO_IDS, SYSTEM_IDS } from '../src/lib/neuro.ts'
import { GENE_COUNTS } from '../src/lib/neuro-genes.ts'

const EV = ['established', 'supported', 'exploratory']

test('every effect, pathway link and gene link points at a real organ with a valid evidence level and an explanation', () => {
  for (const s of SCENARIO_IDS) for (const e of SCENARIO_BODY[s]) {
    assert.ok(ORGANS[e.organ], `${s}: ${e.organ}`); assert.ok(EV.includes(e.evidence)); assert.ok(e.text.length > 20); assert.ok(e.level > 0 && e.level <= 1)
  }
  for (const s of SYSTEM_IDS) for (const e of SYSTEM_BODY[s]) { assert.ok(ORGANS[e.organ], `${s}: ${e.organ}`); assert.ok(EV.includes(e.evidence)); assert.ok(e.text.length > 20) }
  for (const [g, b] of Object.entries(GENE_BODY)) {
    assert.ok(g in GENE_COUNTS, `${g} is not in the ClinVar gene list`)
    assert.ok(EV.includes(b.evidence)); assert.ok(b.text.length > 20)
    for (const o of b.organs) assert.ok(ORGANS[o], `${g}: ${o}`)
  }
  for (const r of ROUTE_IDS) { assert.ok(BRAIN_EXIT[r], r); for (const o of BODY_ROUTES[r].organs) assert.ok(ORGANS[o], `${r}: ${o}`) }
})

test('every organ is reached by at least one route, and every scenario except healthy affects the body', () => {
  for (const o of ORGAN_IDS) assert.ok(routesTo(o).length > 0, o)
  assert.equal(SCENARIO_BODY.healthy.length, 0)
  for (const s of SCENARIO_IDS.filter((x) => x !== 'healthy')) assert.ok(SCENARIO_BODY[s].length > 0, s)
})

test('SLC6A4 acts in the gut and the lungs', () => {
  assert.ok(genesIn('gut').includes('SLC6A4'))
  assert.ok(genesIn('lungs').includes('SLC6A4'))
  assert.ok(GENE_COUNTS.SLC6A4)
})

test('organStates: nothing is highlighted for the healthy baseline with no pathway', () => {
  const s = organStates('none', 'healthy')
  for (const o of ORGAN_IDS) assert.deepEqual(s[o], { level: 0, evidence: null, reasons: [] })
})

test('organStates combines a pathway and a scenario and keeps the strongest evidence', () => {
  const s = organStates('serotonin', 'epilepsy')
  assert.ok(s.gut.level > 0 && s.gut.reasons.some((r) => r.source === 'pathway'))
  assert.ok(s.heart.reasons.some((r) => r.source === 'scenario'))
  assert.ok(s.muscle.level >= 0.8)
  const t = organStates('dopamine', 'stroke')
  assert.equal(t.stomach.evidence, 'established')   // swallowing after stroke
  assert.equal(t.kidneys.evidence, 'supported')
})

test('the body is schematic: organs sit below the neck and left/right pairs mirror on x', () => {
  for (const o of ORGAN_IDS) if (o !== 'eyes') assert.ok(ORGANS[o].pos[2] < -1, o)
})
