import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { CONUS_Z, LANDMARKS, LAYOUT, RIBS, SUPPLY, VERTEBRAE, cordSegmentZ, ribHalfDepth, ribHalfWidth, sceneOf, spineY, trunkHalfDepth, trunkHalfWidth, vertZ } from '../src/lib/anatomy.ts'
import { buildOrgans } from '../src/lib/body-organs.ts'
import { buildNerves } from '../src/lib/body-nerves.ts'
import { ribcageGeometry, spineGeometry, pelvisGeometry, limbGeometry } from '../src/lib/body-skeleton.ts'

test('vertebral levels run downward and the landmarks match the textbook', () => {
  for (let i = 1; i < VERTEBRAE.length; i++) assert.ok(vertZ(VERTEBRAE[i]) < vertZ(VERTEBRAE[i - 1]), VERTEBRAE[i])
  assert.ok(vertZ('T4') > LANDMARKS.sternalAngle - 6 && vertZ('T4') < LANDMARKS.sternalAngle + 1)
  assert.ok(Math.abs(vertZ('L1') - LANDMARKS.transpyloric) < 2, 'transpyloric plane is at L1')
  assert.ok(Math.abs(vertZ('T9') - LANDMARKS.xiphisternal) < 3, 'xiphisternal joint is at T9')
})

test('the spinal cord ends at L1-L2 and its segments run down in order, shorter than the spine', () => {
  assert.ok(CONUS_Z <= vertZ('L1') && CONUS_Z >= vertZ('L2'))
  const order = []
  for (const [r, n] of [['C', 8], ['T', 12], ['L', 5], ['S', 5]]) for (let k = 1; k <= n; k++) order.push(cordSegmentZ(r, k))
  for (let i = 1; i < order.length; i++) assert.ok(order[i] < order[i - 1], `segment ${i}`)
  assert.ok(order[order.length - 1] > CONUS_Z, 'every segment sits above the conus')
  assert.ok(cordSegmentZ('L', 1) > vertZ('L1'), 'lumbar segments sit at T10-T12, above the lumbar vertebrae')
  assert.ok(cordSegmentZ('S', 1) > vertZ('L1') - 1, 'sacral segments sit at T12-L1')
})

test('organs lie where the textbooks put them', () => {
  const { heart, liver, stomach, spleen, rightKidney, leftKidney, rightAdrenal, bladder, diaphragmRightDome, diaphragmLeftDome, pancreas } = LAYOUT
  assert.ok(heart.c[0] < 0, 'heart is left of the midline')
  assert.ok(heart.c[2] < vertZ('T5') + 1 && heart.c[2] > vertZ('T8'), 'heart is at T5-T8')
  assert.ok(liver.c[0] > 0 && stomach.c[0] < 0 && spleen.c[0] < -8, 'liver right, stomach and spleen left')
  assert.ok(spleen.c[2] < vertZ('T10') + 1 && spleen.c[2] > vertZ('L1') - 1, 'spleen sits at T10-L1')
  assert.ok(rightKidney.c[2] < leftKidney.c[2], 'the right kidney sits lower than the left')
  assert.ok(rightKidney.c[2] < vertZ('T12') && rightKidney.c[2] > vertZ('L3'), 'kidneys at T12-L3')
  assert.ok(rightAdrenal.c[2] > rightKidney.c[2], 'adrenal sits on top of the kidney')
  assert.ok(diaphragmRightDome.c[2] > diaphragmLeftDome.c[2], 'the right dome is higher')
  assert.ok(bladder.c[2] < LANDMARKS.iliacCrest, 'bladder is in the pelvis')
  assert.ok(pancreas.c[2] < vertZ('L1') + 2 && pancreas.c[2] > vertZ('L2') - 2, 'pancreas at L1-L2')
})

test('organ centres are inside the trunk and the ribcage matches the trunk', () => {
  for (const [name, p] of Object.entries(LAYOUT)) {
    const [x, y, z] = p.c
    assert.ok(Math.abs(x) <= trunkHalfWidth(z), `${name} x`)
    assert.ok(Math.abs(y) <= trunkHalfDepth(z), `${name} y`)
  }
  for (const z of [-3, -10, -20, -28]) { assert.ok(ribHalfWidth(z) < trunkHalfWidth(z)); assert.ok(ribHalfDepth(z) < trunkHalfDepth(z)) }
  assert.equal(RIBS.length, 12)
  assert.equal(RIBS.filter((r) => r.attaches === 'sternum').length, 7)
  assert.equal(RIBS.filter((r) => r.attaches === 'margin').length, 3)
  assert.ok(spineY(-10) < spineY(-36) && spineY(0) < spineY(8), 'chest kyphosis and lumbar lordosis')
})

test('every organ with a nerve supply names its spinal levels in order', () => {
  for (const [organ, s] of Object.entries(SUPPLY)) {
    if (!s.sympathetic) continue
    const idx = (l) => (l[0] === 'T' ? Number(l.slice(1)) : 12 + Number(l.slice(1)))
    assert.ok(idx(s.sympathetic[0]) <= idx(s.sympathetic[1]), organ)
    assert.ok(s.note.length > 20 && ['established', 'supported', 'exploratory'].includes(s.evidence), organ)
  }
  assert.deepEqual(SUPPLY.heart.sympathetic, ['T1', 'T4'])
})

const finite = (g) => { const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false; return true }

test('the skeleton geometry is complete and finite', () => {
  for (const g of [ribcageGeometry(), spineGeometry(), pelvisGeometry()]) { assert.ok(g.attributes.position.count > 1000); assert.ok(finite(g)); assert.ok(g.attributes.color) }
  for (const kind of ['arm', 'leg']) for (const side of [-1, 1]) { const l = limbGeometry(kind, side); assert.ok(finite(l.bones) && finite(l.muscle)) }
})

test('organ meshes are finite and sit on the right side of the body', () => {
  const m = buildOrgans()
  const box = (id) => new THREE.Box3().setFromBufferAttribute(m.parts.find((p) => p.id === id).geometry.attributes.position)
  const centre = (id) => box(id).getCenter(new THREE.Vector3())
  for (const p of m.parts) { assert.ok(finite(p.geometry), p.id); assert.ok(p.geometry.attributes.color, p.id) }
  assert.ok(centre('liver').x > 0 && centre('spleen').x < 0 && centre('heart.LV').x < centre('heart.RA').x)
  assert.ok(centre('lung.R.upper').x > 0 && centre('lung.L.upper').x < 0)
  assert.equal(m.parts.filter((p) => p.id.startsWith('lung.R.')).length, 3, 'three right lobes')
  assert.equal(m.parts.filter((p) => p.id.startsWith('lung.L.')).length, 3, 'two left lobes plus the lingula')
  assert.ok(centre('kidney.R').z < centre('kidney.L').z, 'right kidney lower')
  assert.ok(centre('bladder').z < centre('smallBowel').z)
  const z = (zcm) => sceneOf(0, 0, zcm)[2]
  assert.ok(centre('heart.LV').z < z(-4) && centre('heart.LV').z > z(-18), 'ventricle sits between the 2nd rib and the xiphoid')
  assert.ok(box('stomach').min.z < z(-30) && box('stomach').max.z > z(-20), 'stomach spans T10 to L2')
  for (const name of ['aorta', 'ivc', 'esophagus', 'trachea', 'smallBowel', 'colon', 'conduction']) assert.ok(m.paths[name].getLength() > 0.3, name)
  assert.ok(m.paths.smallBowel.getLength() > 10, 'the small bowel is long and coiled')
})

test('nerve pathways start and end where the anatomy says', () => {
  const n = buildNerves()
  const get = (id) => n.pathways.find((p) => p.id === id)
  const ends = (id) => { const c = get(id).curve; return [c.getPoint(0), c.getPoint(1)] }
  for (const p of n.pathways) for (const t of [0, 0.5, 1]) { const q = p.curve.getPoint(t); assert.ok(Number.isFinite(q.x + q.y + q.z), p.id) }
  const [s0, s1] = ends('corticospinal.-1')
  assert.ok(s0.z > 0.5 && s1.z < sceneOf(0, 0, -25)[2], 'motor tract runs from the cortex to the lumbar cord')
  assert.ok(s0.x < 0 && s1.x > 0, 'the left motor tract crosses to the right side of the cord')
  const [v0, v1] = ends('vagus.1'); assert.ok(v0.z > sceneOf(0, 0, 0)[2] && v1.z < sceneOf(0, 0, -25)[2], 'the vagus runs from the brain stem to the abdomen')
  const [, p1] = ends('phrenic.1'); assert.ok(Math.abs(p1.z - sceneOf(0, 0, -17)[2]) < 0.3, 'the phrenic nerve ends at the diaphragm')
  const [, o1] = ends('visual.1'); assert.ok(o1.y < -0.7, 'the visual pathway ends at the occipital pole')
  assert.ok(n.ganglia.length > 40, 'one ganglion per level on each side of the chain plus the prevertebral ganglia')
  for (const part of n.parts) assert.ok(finite(part.geometry), part.id)
  for (const id of ['cord', 'roots.C', 'roots.T', 'roots.L', 'roots.S', 'nerves.intercostal', 'nerves.limbs', 'nerves.sympathetic', 'tracts']) assert.ok(n.parts.some((p) => p.id === id), id)
})
