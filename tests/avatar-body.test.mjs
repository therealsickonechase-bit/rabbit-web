import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { BONE_NAMES, BUILDS, HEIGHT, buildSurface, chainWeights, createAvatar, prof } from '../src/lib/avatar-body.ts'
import { computePose } from '../src/lib/avatar-motion.ts'
import { gaitFor } from '../src/lib/avatar-mind.ts'

test('the skeleton has the 21 bones with the right parents', () => {
  const a = createAvatar('neutral')
  assert.equal(BONE_NAMES.length, 21)
  for (const n of BONE_NAMES) assert.ok(a.bones[n], n)
  assert.equal(a.bones.head.parent, a.bones.neck); assert.equal(a.bones.footL.parent, a.bones.shinL); assert.equal(a.bones.handR.parent, a.bones.foreR)
  a.dispose()
})

test('every build is about 1.72 m tall, stands on the floor, and is left-right symmetric', () => {
  for (const build of BUILDS) {
    const g = buildSurface(build).skin
    g.computeBoundingBox()
    const bb = g.boundingBox
    assert.ok(Math.abs(bb.max.y - 1.77) < 0.05, `${build} top ${bb.max.y}`); assert.ok(bb.min.y > -0.01 && bb.min.y < 0.05, `${build} floor ${bb.min.y}`)
    assert.ok(Math.abs(bb.max.x + bb.min.x) < 0.01, `${build} symmetric`)
    assert.ok(bb.max.x - bb.min.x > 0.5 && bb.max.x - bb.min.x < 0.75, `${build} width ${bb.max.x - bb.min.x}`)
    assert.ok(bb.max.z - bb.min.z < 0.4)
  }
})

test('skin weights are normalised, use at most four bones, and every vertex is finite', () => {
  const { skin, shirt, shorts } = buildSurface('feminine')
  for (const g of [skin, shirt, shorts]) {
    const w = g.getAttribute('skinWeight'), idx = g.getAttribute('skinIndex'), pos = g.getAttribute('position'), nor = g.getAttribute('normal')
    assert.ok(pos.count > 500)
    for (let i = 0; i < w.count; i++) {
      assert.ok(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < 1e-5, `weights ${i}`)
      for (const k of [0, 1, 2, 3]) assert.ok(idx.getComponent(i, k) < BONE_NAMES.length)
      assert.ok(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i) + nor.getX(i)))
    }
  }
})

test('chain weights hand over smoothly from one bone to the next across a joint', () => {
  const j = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 0, 0)], bones = ['thighL', 'shinL']
  const at = (y) => Object.fromEntries(chainWeights(new THREE.Vector3(0, y, 0), j, bones, 0.06).map(([b, w]) => [b, w]))
  const thigh = BONE_NAMES.indexOf('thighL'), shin = BONE_NAMES.indexOf('shinL')
  assert.ok(at(0.8)[thigh] > 0.99); assert.ok(at(0.2)[shin] > 0.99)
  const mid = at(0.5); assert.ok(Math.abs(mid[thigh] - 0.5) < 0.05 && Math.abs(mid[shin] - 0.5) < 0.05)
  assert.ok(Math.abs(prof([1, 2, 3])(0.5) - 2) < 1e-9)
})

test('posing moves the right bones: running bends a knee, sitting folds the hips, the head follows a turn', () => {
  const a = createAvatar('neutral'), affect = { arousal: 0.8, valence: 0.3, stress: 0.1, fatigue: 0.05, energy: 1 }
  const st = (intent, o = {}) => ({ intent, gait: gaitFor(intent, affect), phase: 0.5, t: 1, sit: 0, stretch: 0, look: 0, breathRpm: 14, breathDepth: 1, fatigue: 0.1, tremor: 0, strengthL: 1, strengthR: 1, ...o })
  a.apply(computePose(st('stand')))
  const rest = a.bones.shinL.quaternion.clone()
  a.apply(computePose(st('run', { phase: Math.PI * 1.9 })))
  assert.ok(a.bones.shinL.quaternion.angleTo(rest) > 0.3 || a.bones.shinR.quaternion.angleTo(rest) > 0.3)
  a.apply(computePose(st('rest', { sit: 1 }))); assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(a.bones.thighL.quaternion, 'YXZ').x + 1.5) < 0.05); assert.ok(a.root.children[0].position.y < -0.3)
  a.apply(computePose(st('look', { look: 1 }))); assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(a.bones.head.quaternion, 'YXZ').y) > 0.3)
  a.tint(1, 0); assert.ok(a.materials.skin.color.r > 0.5)
  a.dispose()
})
