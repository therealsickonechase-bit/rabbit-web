import assert from 'node:assert/strict'
import test from 'node:test'
import { LOBE_RGB, hemisphere, lobeAt, lobeWeights, cerebellumGeometry } from '../src/lib/brain-geometry.ts'
import { buildRoutes } from '../src/lib/brain-paths.ts'
import { NUC, SYSTEM_IDS, SCENARIO_IDS } from '../src/lib/neuro.ts'
import { electrodePosition, canonicalChannel } from '../src/lib/brain.ts'

const hemis = [hemisphere(-1), hemisphere(1)]

test('the hemispheres are finite, smooth, and shaped like a brain', () => {
  let minX = 9, maxX = -9, minY = 9, maxY = -9, minZ = 9, maxZ = -9, nearMid = 9, crossed = 0
  for (const [i, h] of hemis.entries()) {
    assert.ok(h.n > 8000)
    for (let v = 0; v < h.n; v++) {
      const x = h.P[v * 3], y = h.P[v * 3 + 1], z = h.P[v * 3 + 2]
      assert.ok(Number.isFinite(x + y + z))
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
      nearMid = Math.min(nearMid, Math.abs(x))
      if ((i === 0 && x > 0.001) || (i === 1 && x < -0.001)) crossed++
    }
    const nr = h.geometry.attributes.normal
    for (let v = 0; v < nr.count; v += 13) assert.ok(Math.abs(Math.hypot(nr.getX(v), nr.getY(v), nr.getZ(v)) - 1) < 0.01)
  }
  assert.equal(crossed, 0, 'a hemisphere crosses the midline')
  assert.ok(nearMid * 2 > 0.05 && nearMid * 2 < 0.2, `fissure ${nearMid * 2}`)
  assert.ok(maxX - minX > 1.7 && maxX - minX < 2.1)            // width
  assert.ok(maxY - minY > 1.9 && maxY - minY < 2.3)            // front to back
  assert.ok(maxZ - minZ > 1.0 && maxZ - minZ < 1.4)            // height
})

test('lobes: front is frontal, back is occipital, low side is temporal, top is parietal, and weights sum to 1', () => {
  assert.equal(lobeAt([0, 0.8, 0.2]), 'frontal')
  assert.equal(lobeAt([0, -0.9, 0.1]), 'occipital')
  assert.equal(lobeAt([0.8, 0.0, -0.2]), 'temporal')
  assert.equal(lobeAt([0.3, -0.1, 0.6]), 'parietal')
  for (const h of hemis) for (let v = 0; v < h.n; v += 31) assert.ok(Math.abs(Object.values(h.lobes[v]).reduce((a, b) => a + b, 0) - 1) < 1e-9)
  const counts = { frontal: 0, parietal: 0, temporal: 0, occipital: 0 }
  for (const h of hemis) for (const w of h.lobes) counts[Object.entries(w).sort((a, b) => b[1] - a[1])[0][0]]++
  for (const [k, n] of Object.entries(counts)) assert.ok(n > 1000, k)
  assert.ok(LOBE_RGB.base.every((c) => c > 0 && c < 256))
})

test('the electrodes sit just outside the cortex with clearance, never inside it', () => {
  for (const name of ['Fp1', 'Fz', 'C3', 'Cz', 'Pz', 'O2', 'T8', 'P7']) {
    const d = electrodePosition(name)
    const ex = d.x * 1.12, ey = d.y * 1.28, ez = d.z * 0.98
    let best = 9
    for (const h of hemis) for (let v = 0; v < h.n; v += 5) best = Math.min(best, Math.hypot(h.P[v * 3] - ex, h.P[v * 3 + 1] - ey, h.P[v * 3 + 2] - ez))
    assert.ok(best > 0.04, `${name} ${best}`)
  }
  assert.equal(canonicalChannel('T3'), 'T7')
})

test('the cerebellum builds', () => {
  const g = cerebellumGeometry()
  assert.ok(g.attributes.position.count > 1000 && g.attributes.color.count === g.attributes.position.count)
  for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v))
})

test('every pathway builds in every scenario with finite geometry and pulses', () => {
  for (const sys of SYSTEM_IDS) for (const sc of SCENARIO_IDS) {
    const routes = buildRoutes(sys, sc)
    assert.ok(routes.length >= 2, `${sys}/${sc}`)
    for (const r of routes) {
      assert.ok(r.live.length >= 4 && r.pulses >= 1)
      for (const p of [...r.live, ...r.rest]) assert.ok(Number.isFinite(p.x + p.y + p.z))
      assert.equal(r.cut, r.rest.length > 0)
    }
  }
})

test('a left temporal stroke cuts acetylcholine routes into the left temporal lobe; nothing is cut when healthy', () => {
  const healthy = buildRoutes('acetylcholine', 'healthy'), stroke = buildRoutes('acetylcholine', 'stroke')
  assert.equal(healthy.filter((r) => r.cut).length, 0)
  const cut = stroke.filter((r) => r.cut)
  assert.ok(cut.length >= 1)
  for (const r of cut) assert.ok(r.side === -1 && r.def.b === 'TC')
  for (const r of cut) assert.ok(r.live.length < healthy[0].live.length + 49)
})

test("Alzheimer's weakens acetylcholine but not dopamine; brain injury weakens dopamine", () => {
  const pulses = (sys, sc) => buildRoutes(sys, sc).reduce((s, r) => s + r.pulses, 0)
  assert.ok(pulses('acetylcholine', 'alz') < pulses('acetylcholine', 'healthy'))
  assert.equal(pulses('dopamine', 'alz'), pulses('dopamine', 'healthy'))
  assert.ok(pulses('dopamine', 'tbi') < pulses('dopamine', 'healthy'))
})

test('midline-to-midline routes are drawn once, lateral ones on both sides, and the adrenal glands lie outside the brain', () => {
  const hpa = buildRoutes('hpa', 'healthy')
  assert.equal(hpa.filter((r) => r.def.a === 'hyp' && r.def.b === 'pit').length, 1)
  assert.equal(hpa.filter((r) => r.def.a === 'hipp').length, 2)
  assert.ok(NUC.adrenal[2] < -0.8)
  const tc = buildRoutes('thalamocortical', 'healthy')
  assert.ok(tc.every((r) => r.bidirectional))
})
