import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, PATHWAY_BARS, SEIZURE_PERIOD, pathwayLevel, physioAt, readings } from '../src/lib/body-physiology.ts'
import { SCENARIO_IDS } from '../src/lib/neuro.ts'

test('healthy baseline sits in the normal ranges and every reading says so', () => {
  const p = physioAt('healthy', 5)
  assert.equal(p.heart.bpm, 72); assert.equal(p.lungs.rpm, 14); assert.equal(p.phase, 'baseline')
  for (const r of readings(p)) assert.equal(r.flag, 'normal', r.label)
  for (const b of PATHWAY_BARS) assert.equal(pathwayLevel(p, b.id), 1, b.id)
})

test('a left-hemisphere stroke weakens the RIGHT side of the body', () => {
  const p = physioAt('stroke', 0)
  assert.ok(p.muscle.strengthR < p.muscle.strengthL)
  assert.ok(pathwayLevel(p, 'corticospinal.-1') < pathwayLevel(p, 'corticospinal.1'), 'the left motor tract carries less')
  assert.ok(pathwayLevel(p, 'limb.arm.1') < pathwayLevel(p, 'limb.arm.-1'), 'so the right arm nerves carry less')
  assert.ok(p.esophagus < 0.8 && p.lungs.consolidation > 0.3 && p.heart.irregular > 0.3)
})

test('brain injury raises sympathetic output and stiffens muscle', () => {
  const p = physioAt('tbi', 0)
  assert.ok(p.heart.bpm > 110 && p.lungs.rpm > 22 && p.adrenals > 1.5 && p.cord.autonomic > 1.5 && p.muscle.tone > 1.4 && p.gut < 0.6)
})

test('an occipital lesion costs one half of the visual field and leaves the body alone', () => {
  const p = physioAt('occipital', 0)
  assert.ok(p.visual.rightBrain < 0.2 && p.visual.leftBrain === 1)
  assert.deepEqual(p.heart, BASE.heart); assert.deepEqual(p.muscle, BASE.muscle)
})

test('the seizure repeats: calm, then convulsion with apnea and a racing heart, then weak and recovering', () => {
  const calm = physioAt('epilepsy', 3), ictal = physioAt('epilepsy', 11), post = physioAt('epilepsy', 15.2)
  assert.equal(calm.phase, 'baseline'); assert.ok(calm.heart.bpm < 80 && calm.muscle.spasm < 0.05)
  assert.equal(ictal.phase, 'seizure')
  assert.ok(ictal.heart.bpm > 140 && ictal.lungs.apnea > 0.8 && ictal.muscle.spasm > 0.9 && ictal.bladder.control < 0.1 && ictal.cord.phrenic < 0.4 && ictal.lungs.spo2 < 88)
  assert.equal(post.phase, 'after the seizure'); assert.ok(post.muscle.strengthL < 0.7 && post.lungs.apnea < 0.2 && post.heart.bpm < ictal.heart.bpm)
  assert.deepEqual(physioAt('epilepsy', 3), physioAt('epilepsy', 3 + SEIZURE_PERIOD))
})

test('values stay in believable bounds in every scenario at every moment', () => {
  for (const s of SCENARIO_IDS) for (let t = 0; t < SEIZURE_PERIOD; t += 0.5) {
    const p = physioAt(s, t)
    assert.ok(p.heart.bpm >= 40 && p.heart.bpm <= 190, `${s} ${t} bpm`)
    assert.ok(p.lungs.rpm >= 0 && p.lungs.apnea >= 0 && p.lungs.apnea <= 1 && p.lungs.spo2 >= 70 && p.lungs.spo2 <= 100, `${s} ${t} lungs`)
    for (const v of [p.diaphragm, p.esophagus, p.stomach, p.gut, p.adrenals, p.kidneys, p.muscle.strengthL, p.muscle.strengthR, p.cord.vagal, p.cord.phrenic]) assert.ok(v >= 0 && v <= 3, `${s} ${t}`)
    assert.equal(readings(p).length, 14)
  }
})
