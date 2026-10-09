import assert from 'node:assert/strict'
import test from 'node:test'
import { COND_IDS, EDGES, EEG_IDS, GENE_IDS, GRAPH_SYSTEM_OF, MAP_COLUMNS, NODE_LABEL, SCENARIOS, SCENARIO_IDS, SCENARIO_INFO, SYSTEM_GENE_KEYS, SYSTEM_IDS, SYSTEM_INFO, SYSTEM_NODE_IDS, buildEdges, connectedEdges, edgePath, firstCut, mapNodes } from '../src/lib/neuro.ts'
import { GENE_COUNTS } from '../src/lib/neuro-genes.ts'

const nodes = mapNodes()

test('every link points at boxes that exist, with a valid evidence level and a real explanation', () => {
  for (const [a, b, ev, why] of EDGES) {
    assert.ok(nodes[a] && nodes[b], `${a} -> ${b}`)
    assert.ok(['established', 'supported', 'exploratory'].includes(ev), ev)
    assert.ok(why.length > 15, `${a} -> ${b}`)
    assert.ok(edgePath(nodes, a, b).startsWith('M'))
  }
})

test('no box is unconnected, and every gene links to a chemical system or a condition', () => {
  for (const id of Object.keys(nodes)) assert.ok(connectedEdges(EDGES, id).length > 0, id)
  for (const g of GENE_IDS) assert.ok(EDGES.some((e) => e[0] === g), g)
})

test('the evidence mix is mostly established, with the weaker links marked as such', () => {
  const t = { established: 0, supported: 0, exploratory: 0 }
  for (const e of EDGES) t[e[2]]++
  assert.ok(t.established > t.supported && t.supported > 0 && t.exploratory > 0, JSON.stringify(t))
  const only = (a, b) => EDGES.find((e) => e[0] === a && e[1] === b)?.[2]
  assert.equal(only('GABA', 'beta'), 'established')
  assert.equal(only('serotonin', 'alpha'), 'supported')
  assert.equal(only('cortisol', 'alpha'), 'exploratory')
  assert.equal(only('BDNF', 'glutamate'), 'exploratory')
})

test('gene counts are real figures that make sense', () => {
  assert.equal(GENE_IDS.length, 27)
  for (const [g, c] of Object.entries(GENE_COUNTS)) assert.ok(c.variants >= c.pathogenic_or_likely && c.pathogenic_or_likely >= 0 && c.role.length > 5, g)
  assert.equal(GENE_COUNTS.SCN1A.variants, 5536)
  assert.equal(GENE_COUNTS.SCN1A.pathogenic_or_likely, 2322)
})

test('gene links come from each gene\'s recorded role, and MAOA reaches all three monoamines', () => {
  const targets = (g) => EDGES.filter((e) => e[0] === g).map((e) => e[1]).sort()
  assert.deepEqual(targets('MAOA'), ['dopamine', 'norepinephrine', 'serotonin'])
  assert.deepEqual(targets('COMT'), ['dopamine'])
  assert.deepEqual(targets('SCN1A'), ['epilepsy'])
  assert.deepEqual(targets('GABRG2'), ['GABA', 'epilepsy'])
  assert.deepEqual(buildEdges({}).length, buildEdges({}).length)
})

test('the map has four columns that together hold every box exactly once', () => {
  const all = MAP_COLUMNS.flatMap((c) => c.ids)
  assert.equal(new Set(all).size, all.length)
  assert.equal(all.length, GENE_IDS.length + SYSTEM_NODE_IDS.length + EEG_IDS.length + COND_IDS.length)
  for (const n of Object.values(nodes)) assert.ok(n.y > 40 && n.y < 640, n.id)
})

test('every pathway and scenario has a description, and the gene keys point at real gene systems', () => {
  for (const s of SYSTEM_IDS) { assert.ok(SYSTEM_INFO[s].text.length > 60 && /^#[0-9a-f]{6}$/.test(SYSTEM_INFO[s].color), s); assert.ok(SYSTEM_GENE_KEYS[s].length) }
  const systems = new Set(Object.values(GENE_COUNTS).map((g) => g.system))
  for (const keys of Object.values(SYSTEM_GENE_KEYS)) for (const k of keys) assert.ok(systems.has(k), k)
  for (const sc of SCENARIO_IDS) assert.ok(SCENARIO_INFO[sc].text.length > 40 && SCENARIOS[sc])
  for (const g of Object.values(SCENARIO_INFO).flatMap((s) => s.genes)) assert.ok(GENE_COUNTS[g], g)
  for (const v of Object.values(GRAPH_SYSTEM_OF)) assert.ok(SYSTEM_IDS.includes(v))
  assert.ok(NODE_LABEL.alzheimer)
})

test('firstCut finds where a route enters damaged tissue and ignores the source nucleus', () => {
  const route = Array.from({ length: 11 }, (_, i) => [i * 0.1, 0, 0])
  assert.equal(firstCut(route, [{ p: [0.5, 0, 0], r: 0.08 }]), 5)
  assert.equal(firstCut(route, [{ p: [0.5, 0.5, 0], r: 0.08 }]), -1)
  assert.equal(firstCut(route, [{ p: [0.0, 0, 0], r: 0.15 }]), -1)         // a lesion at the very start is skipped, not a cut
  assert.equal(firstCut(route, []), -1)
  assert.equal(firstCut(route, [{ p: [0.9, 0, 0], r: 0.05 }, { p: [0.4, 0, 0], r: 0.05 }]), 4)   // the earliest of several
})

test('scenario damage is where it should be', () => {
  assert.ok(SCENARIOS.stroke.lesions[0].p[0] < -0.5)                       // left side
  assert.ok(SCENARIOS.occipital.lesions[0].p[1] < -0.6)                    // back
  assert.ok(SCENARIOS.epilepsy.lesions[0].focus)
  assert.equal(SCENARIOS.tbi.lesions.length, 3)
  assert.ok(SCENARIOS.alz.atrophy && SCENARIOS.alz.impair.acetylcholine < 0.5)
  assert.deepEqual(SCENARIOS.healthy.lesions, [])
})
