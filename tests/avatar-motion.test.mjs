import assert from 'node:assert/strict'
import test from 'node:test'
import { LEG, blinkAt, computePose, swingAmplitude } from '../src/lib/avatar-motion.ts'
import { gaitFor } from '../src/lib/avatar-mind.ts'

const affect = { arousal: 0.6, valence: 0.2, stress: 0.2, fatigue: 0.1, energy: 0.9 }
const state = (intent, o = {}) => ({ intent, gait: gaitFor(intent, affect), phase: 0, t: 1, sit: 0, stretch: 0, look: 0, breathRpm: 14, breathDepth: 1, fatigue: 0.1, tremor: 0, strengthL: 1, strengthR: 1, ...o })

test('the swing is sized so the planted foot moves back as fast as the body moves forward', () => {
  for (const intent of ['stroll', 'walk', 'jog', 'run']) {
    const g = gaitFor(intent, affect), theta = swingAmplitude(g.speed, g.cycle)
    const halfCycle = 1 / (2 * g.cycle), footTravel = 2 * LEG * Math.sin(theta)      // from +theta to -theta during stance
    assert.ok(Math.abs(footTravel - g.speed * halfCycle) / (g.speed * halfCycle) < 0.02, intent)
  }
  assert.equal(swingAmplitude(0, 1), 0)
})

test('legs and arms alternate, and arms swing against the legs', () => {
  const a = computePose(state('walk', { phase: Math.PI / 2 }))
  assert.ok(a.hipL > 0.1 && a.hipR < -0.1)                       // left leg forward, right leg back
  assert.ok(a.shoulderL < 0 && a.shoulderR > 0)                  // left arm back, right arm forward
  const b = computePose(state('walk', { phase: -Math.PI / 2 }))
  assert.ok(b.hipL < -0.1 && b.hipR > 0.1)
})

test('running swings further, bends the knees and elbows more, and leans forward more than walking', () => {
  const w = computePose(state('walk', { phase: 0.4 })), r = computePose(state('run', { phase: 0.4 }))
  assert.ok(Math.abs(r.hipL) > Math.abs(w.hipL) * 1.2 || Math.abs(r.hipR) > Math.abs(w.hipR) * 1.2)
  assert.ok(Math.max(r.kneeL, r.kneeR) > Math.max(w.kneeL, w.kneeR)); assert.ok(r.elbowL > w.elbowL); assert.ok(r.spineFlex > w.spineFlex)
})

test('standing still keeps the legs straight and the body breathing', () => {
  const p = computePose(state('stand')), q = computePose(state('stand', { t: 3 }))
  assert.ok(Math.abs(p.hipL) < 0.05 && p.kneeL < 0.1)
  assert.notEqual(p.chestBreath, q.chestBreath)
})

test('sitting bends the hips and knees and lowers the pelvis; stretching raises the arms', () => {
  const s = computePose(state('rest', { sit: 1 }))
  assert.ok(s.hipL > 1.3 && s.kneeL > 1.3 && s.rootY < -0.3)
  const e = computePose(state('stretch', { stretch: 0.5 }))
  assert.ok(e.abdL > 2.4 && e.abdR > 2.4)
})

test('a tired, slumped avatar rounds its back, drops its head and lowers its eyelids; weakness and tremor show', () => {
  const tired = { arousal: 0.2, valence: -0.4, stress: 0.2, fatigue: 0.9, energy: 0.2 }
  const a = computePose(state('stand', { gait: gaitFor('stand', tired), fatigue: 0.9 })), b = computePose(state('stand'))
  assert.ok(a.spineFlex > b.spineFlex && a.neckFlex > b.neckFlex && a.lid > b.lid)
  const weak = computePose(state('walk', { phase: Math.PI / 2, strengthL: 0.4 }))
  assert.ok(weak.hipL < computePose(state('walk', { phase: Math.PI / 2 })).hipL)
  const t0 = computePose(state('stand', { t: 0.013 })), t1 = computePose(state('stand', { t: 0.013, tremor: 1 }))
  assert.notEqual(t0.shoulderL, t1.shoulderL)
})

test('blinks are short and periodic, and every pose value is a finite number', () => {
  assert.equal(blinkAt(1, 0), 0); assert.ok(blinkAt(0.08, 0) > 0.9); assert.ok(blinkAt(4.2 + 0.08, 0) > 0.9)
  for (const intent of ['rest', 'stand', 'look', 'stroll', 'walk', 'pace', 'jog', 'run', 'stretch']) for (const phase of [0, 1, 2, 3, 4, 5]) for (const v of Object.values(computePose(state(intent, { phase, look: 0.5, stretch: 0.3 })))) assert.ok(Number.isFinite(v), `${intent} ${phase}`)
})

import { ARENA, STOOL, newWorld, stepWorld } from '../src/lib/avatar-motion.ts'
import { makeRng } from '../src/lib/avatar-mind.ts'

test('walking: the avatar crosses the room at its gait speed, turns toward goals, and never leaves the room', () => {
  const w = newWorld(), rng = makeRng(3), g = gaitFor('walk', affect)
  let travelled = 0, last = { x: w.x, z: w.z }, maxR = 0, maxStep = 0
  for (let t = 0; t < 120; t += 0.05) {
    stepWorld(w, 0.05, 'walk', g, rng)
    const d = Math.hypot(w.x - last.x, w.z - last.z); travelled += d; maxStep = Math.max(maxStep, d); last = { x: w.x, z: w.z }; maxR = Math.max(maxR, Math.hypot(w.x, w.z))
  }
  assert.ok(maxR <= ARENA + 1e-6); assert.ok(maxStep <= g.speed * 0.05 + 1e-6)
  assert.ok(travelled > g.speed * 120 * 0.5, `travelled ${travelled}`)                   // it keeps moving, with only some time lost to turning
  assert.ok(w.phase > 10)
})

test('running covers more ground than strolling in the same time', () => {
  const go = (intent) => { const w = newWorld(), rng = makeRng(5), g = gaitFor(intent, affect); let d = 0, p = { x: 0, z: 0 }; for (let t = 0; t < 60; t += 0.05) { stepWorld(w, 0.05, intent, g, rng); d += Math.hypot(w.x - p.x, w.z - p.z); p = { x: w.x, z: w.z } } return d }
  assert.ok(go('run') > go('stroll') * 2)
})

test('resting walks to the stool, faces it, and sits; getting up again is quicker than sitting down', () => {
  const w = newWorld(), rng = makeRng(2)
  for (let t = 0; t < 40; t += 0.05) stepWorld(w, 0.05, 'rest', gaitFor('rest', affect), rng)
  assert.ok(Math.hypot(w.x - STOOL.x, w.z - STOOL.z) < 0.2); assert.ok(w.sit > 0.99)
  let t = 0; while (w.sit > 0.01 && t < 20) { stepWorld(w, 0.05, 'stand', gaitFor('stand', affect), rng); t += 0.05 }
  assert.ok(t < 2)
})

test('standing still keeps the figure in place; stretching builds up then relaxes; looking sweeps both ways', () => {
  const w = newWorld(), rng = makeRng(1)
  for (let t = 0; t < 10; t += 0.05) stepWorld(w, 0.05, 'stand', gaitFor('stand', affect), rng)
  assert.equal(w.x, 0); assert.equal(w.z, 0)
  for (let t = 0; t < 5; t += 0.05) stepWorld(w, 0.05, 'stretch', gaitFor('stretch', affect), rng)
  assert.ok(w.stretch > 0.9)
  const seen = new Set(); for (let t = 0; t < 12; t += 0.05) { stepWorld(w, 0.05, 'look', gaitFor('look', affect), rng); seen.add(Math.sign(Math.round(w.look * 10))) }
  assert.ok(seen.has(1) && seen.has(-1))
})
