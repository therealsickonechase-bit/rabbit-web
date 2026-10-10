import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLive, calibrateEmg, eegIndices, emgRatio, isFresh, parseLiveFrame, rrIrregularity } from '../src/lib/live-signals.ts'
import { physioAt, readings } from '../src/lib/body-physiology.ts'

const now = 1_800_000_000_000
const good = { v: 1, t: now, source: 'brainflow:cyton', eeg: { F3: { delta: 0.2, theta: 0.2, alpha: 0.2, beta: 0.3, gamma: 0.1 }, F4: { delta: 0.2, theta: 0.2, alpha: 0.3, beta: 0.2, gamma: 0.1 } }, ecg: { bpm: 63, rr_ms: [950, 940, 960, 955, 945, 950] }, emg: { left_forearm: 12 } }

test('a well-formed frame passes and unknown or hostile fields are dropped', () => {
  const f = parseLiveFrame({ ...good, extra: '<script>', eeg: { ...good.eeg, NOT_A_CHANNEL: { alpha: 0.5 } } })
  assert.equal(f.ecg.bpm, 63); assert.deepEqual(Object.keys(f.eeg).sort(), ['F3', 'F4']); assert.equal('extra' in f, false)
})

test('malformed, out-of-range and oversized frames are rejected', () => {
  const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`F${i}`, { alpha: 0.1 }]))
  for (const bad of [null, 'x', {}, { ...good, v: 2 }, { ...good, t: 5 }, { ...good, source: '<b>' }, { ...good, ecg: { bpm: 900 } }, { ...good, ecg: { bpm: 'fast' } }, { ...good, emg: 7 }, { ...good, resp: { rpm: -1 } }, { ...good, eeg: many }]) {
    assert.equal(parseLiveFrame(bad), null, JSON.stringify(bad).slice(0, 60))
  }
  const f = parseLiveFrame({ ...good, eeg: { F3: { alpha: 5, theta: 'x', beta: 0.3 } } })
  assert.deepEqual(f.eeg.F3, { beta: 0.3 }, 'bad band values are dropped')
})

test('frames older than five seconds are ignored', () => {
  assert.equal(isFresh(good, now + 1000), true); assert.equal(isFresh(good, now + 6000), false); assert.equal(isFresh(null), false)
})

test('a steady beat is regular, an erratic one is not', () => {
  assert.equal(rrIrregularity([950, 940, 960, 955, 945, 950]), 0)
  assert.equal(rrIrregularity([600, 1100, 700, 1300, 500, 1000, 800]) > 0.8, true)
  assert.equal(rrIrregularity([900, 900]), 0, 'too few beats to judge')
})

test('EEG indices come from band shares and are null without data', () => {
  const f = parseLiveFrame(good), i = eegIndices(f)
  assert.equal(i.channels, 2); assert.ok(Math.abs(i.thetaAlpha - 0.2 / 0.25) < 1e-9)
  assert.ok(Math.abs(i.engagement - 0.25 / 0.45) < 1e-9)
  assert.ok(i.frontalAsymmetry > 0 && Math.abs(i.frontalAsymmetry - Math.log(0.3 / 0.2)) < 1e-9)
  assert.equal(i.dominant, 'alpha')
  assert.deepEqual(eegIndices(null), { thetaAlpha: null, engagement: null, frontalAsymmetry: null, dominant: null, channels: 0 })
})

test('measured heart rate and muscle activity replace the model, and the original is untouched', () => {
  const base = calibrateEmg([{ ...good, emg: { left_forearm: 10 } }, { ...good, emg: { left_forearm: 14 } }])
  assert.equal(base.emg.left_forearm, 12)
  const model = physioAt('stroke', 0), before = JSON.stringify(model)
  const busy = parseLiveFrame({ ...good, emg: { left_forearm: 36 } })
  const live = applyLive(model, busy, base, now)
  assert.equal(live.heart.bpm, 63); assert.equal(live.heart.irregular, 0); assert.equal(live.muscle.tone, 2.4 > 3 ? 2.4 : 2.4)
  assert.deepEqual(live.live, { heart: true, muscle: true, breathing: false, eeg: true, source: 'brainflow:cyton' })
  assert.equal(JSON.stringify(model), before, 'the model object is not modified')
  assert.equal(emgRatio(busy, base), 3)
  assert.equal(readings(live).find((r) => r.label === 'Heart rate').measured, true)
  assert.equal(readings(model).find((r) => r.label === 'Heart rate').measured, false)
})

test('stale or missing live data leaves the model alone', () => {
  const model = physioAt('tbi', 0), base = { emg: {} }
  assert.equal(applyLive(model, good, base, now + 60_000), model)
  assert.equal(applyLive(model, null, base, now), model)
  const noBaseline = applyLive(model, parseLiveFrame(good), base, now)
  assert.equal(noBaseline.muscle.tone, model.muscle.tone, 'without a calibrated baseline the muscle numbers stay modelled')
})

test('a brain state from the bridge is validated', () => {
  const f = parseLiveFrame({ ...good, state: { label: 'eyes_closed', confidence: 0.91, model: 'transformer' } })
  assert.deepEqual(f.state, { label: 'eyes_closed', confidence: 0.91, model: 'transformer' })
  for (const bad of [{ label: 'dreaming', confidence: 0.5, model: 'x' }, { label: 'eyes_open', confidence: 2, model: 'x' }, { label: 'eyes_open' }, 'eyes_open', null]) {
    assert.equal(parseLiveFrame({ ...good, state: bad }), null, JSON.stringify(bad))
  }
  assert.equal(parseLiveFrame({ ...good, state: { label: 'eyes_open', confidence: 0.4, model: '<script>' } }).state.model, 'unknown')
  assert.equal(parseLiveFrame(good).state, undefined)
})
