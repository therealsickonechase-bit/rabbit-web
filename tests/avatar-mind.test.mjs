import assert from 'node:assert/strict'
import test from 'node:test'
import { INTENTS, Mind, emotionWord, gaitFor, intentScores, makeRng, ownEeg, pickIntent, targetAffect, thoughtFor } from '../src/lib/avatar-mind.ts'

const calm = (extra = {}) => ({ hour: 14, cortisol: 'typical', melatonin: 'low', eeg: null, heartBpm: null, ...extra })

test('hormones and time of day move the mood in the textbook direction', () => {
  const day = targetAffect(calm()).affect, stressed = targetAffect(calm({ cortisol: 'high' })).affect, night = targetAffect(calm({ hour: 23, melatonin: 'high' })).affect
  assert.ok(stressed.stress > day.stress && stressed.arousal > day.arousal)
  assert.ok(night.fatigue > day.fatigue && night.arousal < day.arousal && night.energy < day.energy)
  for (const a of [day, stressed, night]) for (const v of Object.values(a)) assert.ok(v >= -1 && v <= 1)
})

test('EEG and heart inputs change arousal, and the reasons are listed', () => {
  const base = targetAffect(calm()).affect.arousal
  const engaged = targetAffect(calm({ eeg: { engagement: 1.2, thetaAlpha: null, asymmetry: null } }))
  assert.ok(engaged.affect.arousal > base); assert.ok(engaged.reasons.some((r) => r.includes('EEG')))
  assert.ok(targetAffect(calm({ heartBpm: 110 })).affect.arousal > base)
  assert.ok(targetAffect(calm({ eeg: { engagement: null, thetaAlpha: 2, asymmetry: null } })).affect.fatigue > targetAffect(calm()).affect.fatigue)
})

test('emotion words follow arousal and valence', () => {
  const a = (o) => ({ arousal: 0.5, valence: 0, stress: 0.2, fatigue: 0.1, energy: 0.8, ...o })
  assert.equal(emotionWord(a({ fatigue: 0.8 })), 'sleepy'); assert.equal(emotionWord(a({ arousal: 0.8, valence: 0.5 })), 'excited')
  assert.equal(emotionWord(a({ arousal: 0.8, valence: -0.4, stress: 0.8 })), 'anxious'); assert.equal(emotionWord(a({ arousal: 0.2, valence: 0.5 })), 'relaxed')
  assert.equal(emotionWord(a({})), 'neutral')
})

test('a tired avatar prefers to rest, an energetic wound-up one runs, a stressed one paces', () => {
  const best = (a) => { const s = intentScores(a, 'stand', 0); return INTENTS.reduce((x, y) => (s[y] > s[x] ? y : x)) }
  assert.equal(best({ arousal: 0.2, valence: 0, stress: 0.1, fatigue: 0.85, energy: 0.2 }), 'rest')
  assert.equal(best({ arousal: 0.9, valence: 0.6, stress: 0.1, fatigue: 0.05, energy: 1 }), 'run')
  assert.equal(best({ arousal: 0.8, valence: -0.4, stress: 0.9, fatigue: 0.2, energy: 0.6 }), 'pace')
})

test('choices are seeded, varied and not locked to one intent', () => {
  const s = intentScores({ arousal: 0.5, valence: 0.2, stress: 0.2, fatigue: 0.3, energy: 0.7 }, 'walk', 0)
  const pick = (seed) => { const r = makeRng(seed); return Array.from({ length: 200 }, () => pickIntent(s, r)) }
  assert.deepEqual(pick(4), pick(4)); assert.ok(new Set(pick(4)).size > 1)
})

test('gait: faster intents move faster and lean more; tiredness slows and slumps', () => {
  const a = { arousal: 0.6, valence: 0.2, stress: 0.2, fatigue: 0.1, energy: 0.9 }
  assert.ok(gaitFor('run', a).speed > gaitFor('jog', a).speed && gaitFor('jog', a).speed > gaitFor('walk', a).speed && gaitFor('walk', a).speed > gaitFor('stroll', a).speed)
  assert.ok(gaitFor('run', a).lean > gaitFor('walk', a).lean); assert.equal(gaitFor('rest', a).moving, false)
  const tired = gaitFor('walk', { ...a, fatigue: 0.9, energy: 0.2, valence: -0.5 })
  assert.ok(tired.speed < gaitFor('walk', a).speed && tired.slump > gaitFor('walk', a).slump)
})

test('own EEG shares add to one, with alpha up when calm and beta up when aroused', () => {
  const calmEeg = ownEeg({ arousal: 0.1, valence: 0.3, stress: 0.1, fatigue: 0.1, energy: 1 }), busy = ownEeg({ arousal: 0.95, valence: -0.2, stress: 0.8, fatigue: 0.1, energy: 1 })
  for (const e of [calmEeg, busy]) assert.ok(Math.abs(Object.values(e).reduce((x, y) => x + y, 0) - 1) < 1e-9)
  assert.ok(calmEeg.alpha > busy.alpha && busy.beta > calmEeg.beta)
})

test('the running mind decides by itself, explains why, and stays inside its bounds', () => {
  const m = new Mind(7)
  const seen = new Set()
  let snap
  for (let t = 0; t < 600; t += 0.1) { snap = m.step(0.1, calm({ cortisol: t > 300 ? 'high' : 'typical' })); seen.add(snap.intent) }
  assert.ok(seen.size >= 3, `only ${[...seen]}`)
  for (const v of Object.values(snap.affect)) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1)
  assert.ok(snap.thought.length > 10 && snap.simulated === true)
  assert.ok(thoughtFor('run', snap.affect, ['my cortisol is high']).includes('cortisol'))
  assert.equal(new Mind(7).step(0.1, calm({ eeg: { engagement: 0.6, thetaAlpha: 1, asymmetry: 0 } })).simulated, false)
})

test('a person moving about nearby raises arousal and is named as a reason; an empty room does not', () => {
  const base = targetAffect(calm()).affect.arousal
  const busy = targetAffect(calm({ occupant: { present: true, motion: 0.9 } }))
  assert.ok(busy.affect.arousal > base); assert.ok(busy.reasons.some((r) => /moving about nearby/.test(r)))
  assert.ok(targetAffect(calm({ occupant: { present: true, motion: 0.05 } })).reasons.some((r) => /in the room with me/.test(r)))
  assert.equal(targetAffect(calm({ occupant: { present: false, motion: 0 } })).affect.arousal <= base, true)
})
