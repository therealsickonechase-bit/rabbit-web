import assert from 'node:assert/strict'
import test from 'node:test'
import { InnerLife, verb, verbIng } from '../src/lib/avatar-inner.ts'
import { Mind, INTENTS } from '../src/lib/avatar-mind.ts'

const calm = { hour: 14, cortisol: 'typical', melatonin: 'low', eeg: null, heartBpm: null }
const inputs = (t, o = {}) => ({ t, exertion: 0, heart: 72, scenario: 'healthy', cortisol: 'typical', melatonin: 'low', ...o })
const run = (seed, seconds, hooks = {}) => {
  const mind = new Mind(seed), inner = new InnerLife(seed), log = []
  let snap
  for (let t = 0; t < seconds; t += 0.1) {
    const m = mind.step(0.1, calm, inner.biases())
    hooks.before?.(t, inner)
    snap = inner.step(0.1, m, inputs(t, { exertion: ['jog', 'run'].includes(m.intent) ? 0.9 : 0, ...(hooks.inputs?.(t) ?? {}) }))
    log.push(m.intent)
  }
  return { mind, inner, snap, log }
}

test('a mind with an inner life is deterministic for a seed and uses several intents', () => {
  const a = run(5, 400), b = run(5, 400)
  assert.deepEqual(a.log, b.log); assert.deepEqual(a.snap, b.snap)
  assert.ok(new Set(a.log).size >= 3)
})

test('something wins attention, is shared in a small working memory, narrated, and strong moments are remembered', () => {
  const { inner, snap } = run(3, 300)
  assert.ok(snap.narration.length > 0); assert.ok(snap.working.length <= 4); assert.ok(inner.episodes.length > 0 && inner.episodes.length <= 300)
  assert.ok(inner.episodes.every((e) => e.intensity >= 0.6 && Number.isFinite(e.t)))
})

test('a question wins the workspace immediately and can be recalled afterwards', () => {
  const { inner } = run(2, 120, { before: (t, i) => { if (Math.abs(t - 60) < 0.05) i.hear('what does your liver do?') } })
  assert.ok(inner.episodes.some((e) => e.kind === 'question'))
  assert.match(inner.introspect('what do you remember?').text, /ago/)
  assert.match(inner.recall('what was the question you were asked'), /asked me/)
})

test('strong events (a scenario change, a hormone shift) ignite and are remembered', () => {
  const { inner } = run(4, 90, { inputs: (t) => (t > 40 ? { scenario: 'stroke', cortisol: 'high' } : {}) })
  const texts = inner.episodes.map((e) => e.text).join(' ')
  assert.match(texts, /scenario|hormones/)
})

test('needs rise with inactivity or effort and fall with rest, and they bend the choices', () => {
  const i = new InnerLife(1), mind = new Mind(1)
  const snapRest = { ...mind.snapshot(), intent: 'rest', gait: { speed: 0, cycle: 0, swing: 0, lean: 0, slump: 0, moving: false } }
  for (let t = 0; t < 120; t += 0.1) i.step(0.1, { ...snapRest, intent: 'jog', gait: { ...snapRest.gait, moving: true } }, inputs(t, { exertion: 0.9 }))
  const tired = i.drives.rest; assert.ok(tired > 0.6)
  for (let t = 120; t < 240; t += 0.1) i.step(0.1, snapRest, inputs(t))
  assert.ok(i.drives.rest < tired - 0.3)
  i.drives.rest = 1; i.drives.activity = 0; assert.ok(i.biases().rest > 0.3 && i.biases().walk < 0 && i.biases().stroll < 0)
  // a strong rest need makes resting win far more often than a weak one
  const share = (rest) => { let n = 0; const m = new Mind(9); for (let t = 0; t < 1200; t += 0.5) { if (m.step(0.5, calm, { rest }).intent === 'rest') n++ } return n }
  assert.ok(share(0.7) > share(-0.7))
})

test('the self-model learns habits, predicts its next move and tracks its own accuracy', () => {
  const { inner, snap } = run(6, 1500)
  assert.ok(snap.predictionAccuracy === null || (snap.predictionAccuracy >= 0 && snap.predictionAccuracy <= 1))
  assert.ok(snap.predictionAccuracy !== null, 'enough predictions made')
  assert.match(inner.describeSelf(), /spend most of my time/)
  const p = inner.introspect('what will you do next?')
  assert.match(p.text, /expect|not seen enough/)
})

test('it answers questions about attention, memory, needs, itself and consciousness, and is honest about the last', () => {
  const { inner } = run(8, 200)
  for (const [q, topic] of [['what are you aware of?', 'aware'], ['what do you remember from earlier?', 'memory'], ['what do you need?', 'drives'], ['what are you like, what are your habits?', 'self']]) assert.equal(inner.introspect(q).topic, topic, q)
  const c = inner.introspect('Are you conscious?')
  assert.equal(c.topic, 'consciousness'); assert.match(c.text, /not claim to be conscious/); assert.match(c.text, /open question/)
  assert.equal(inner.introspect('what is the capital of France'), null)
  assert.equal(verb('rest'), 'sit and rest'); assert.equal(verbIng('run'), 'running'); assert.equal(INTENTS.length, 9)
})

test('a person sensed by WiFi changes her mood, and arriving, leaving and moving are noticed and remembered', () => {
  const mind = new Mind(3), inner = new InnerLife(3)
  let snap
  for (let t = 0; t < 60; t += 0.1) {
    const present = t > 10 && t < 40, moving = t > 25 && t < 35
    const m = mind.step(0.1, { ...calm, occupant: { present, motion: moving ? 0.8 : present ? 0.1 : 0 } }, inner.biases())
    snap = inner.step(0.1, m, inputs(t, { occupant: { present, motion: moving ? 0.8 : present ? 0.1 : 0, simulated: true } }))
  }
  const texts = inner.episodes.map((e) => e.text).join(' ')
  assert.match(texts, /come into the room/); assert.match(texts, /moving around|empty/); assert.match(texts, /simulated visitor/)
  assert.ok(snap)
})
