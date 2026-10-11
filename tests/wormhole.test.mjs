import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_WEIGHTS, ProvenanceLog, affectFromBands, buildScene, confidence, match, parseMoments, refine, scenePrompt } from '../src/lib/wormhole.ts'

const mk = (id, over = {}) => ({ id, date: '2026-03-01', time: '08:00', title: 'T ' + id, tags: [], ratings: {}, hormones: {}, day: {}, ...over })
const lake = mk('m1', { time: '08:10', tags: ['lake', 'sunrise', 'calm'], ratings: { arousal: 0.3, valence: 0.8 }, hormones: { cortisol: 'low', melatonin: 'high' }, day: { sleep_hours: 'high' } })
const desk = mk('m2', { time: '22:30', tags: ['desk', 'work', 'tense'], ratings: { arousal: 0.8, valence: 0.3 }, hormones: { cortisol: 'high', melatonin: 'low' }, day: { sleep_hours: 'low' } })
const state = (over = {}) => ({ ratings: {}, minutes: null, hormones: {}, day: {}, guidance: [], ...over })
const APPROVED = ['lake', 'sunrise', 'calm', 'desk', 'work', 'tense', 'energetic', 'tired']

test('a calm morning state matches the calm morning moment, not the late deadline', () => {
  const s = state({ ratings: { arousal: 0.25, valence: 0.8 }, minutes: 8 * 60, hormones: { cortisol: 'low' }, guidance: ['lake'] })
  const m = match(s, [desk, lake])
  assert.equal(m[0].moment.id, 'm1')
  assert.ok(m[0].score > m[1].score + 0.2)
})

test('missing parts of the state are not used, and an empty state matches nothing', () => {
  assert.deepEqual(match(state(), [lake, desk]), [])
  const m = match(state({ guidance: ['desk'] }), [lake, desk])
  assert.equal(m[0].moment.id, 'm2')
  assert.equal(m[0].coverage, DEFAULT_WEIGHTS.tags)
})

test('time of day wraps around midnight', () => {
  const late = mk('m3', { time: '23:50' })
  const m = match(state({ minutes: 10 }), [late])
  assert.ok(m[0].components.time > 0.95)
})

test('confidence is none with no candidates, weak on one clue, higher when much agrees', () => {
  assert.equal(confidence([], 0).state, 'none')
  const one = match(state({ guidance: ['lake'] }), Array.from({ length: 12 }, (_, i) => mk('x' + i, { tags: i ? [] : ['lake'] })))
  assert.equal(confidence(one, 12).state, 'weak')
  const rich = match(state({ ratings: { arousal: 0.3, valence: 0.8 }, minutes: 490, hormones: { cortisol: 'low', melatonin: 'high' }, day: { sleep_hours: 'high' }, guidance: ['lake', 'calm'] }), [lake, desk, ...Array.from({ length: 10 }, (_, i) => mk('y' + i, { tags: ['city'] }))])
  assert.ok(['plausible', 'strong'].includes(confidence(rich, 12).state))
})

test('few logged moments lower confidence', () => {
  const s = state({ ratings: { arousal: 0.3, valence: 0.8 }, minutes: 490, hormones: { cortisol: 'low' }, day: { sleep_hours: 'high' }, guidance: ['lake'] })
  const m = match(s, [lake, desk])
  assert.ok(confidence(m, 2).value < confidence(m, 20).value)
})

test('feedback moves weights and boosts, keeps weights summing to one, and a thumbs down lowers the moment', () => {
  const s = state({ ratings: { arousal: 0.3, valence: 0.8 }, guidance: ['lake'] })
  const best = match(s, [lake, desk])[0]
  const up = refine({ weights: DEFAULT_WEIGHTS, boosts: {} }, best, true)
  assert.ok(Math.abs(Object.values(up.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9)
  assert.ok(up.boosts.m1 > 0)
  const down = refine({ weights: DEFAULT_WEIGHTS, boosts: {} }, best, false)
  assert.ok(down.boosts.m1 < 0)
  assert.ok(match(s, [lake, desk], down.weights, down.boosts)[0].score < best.score)
})

test('scene uses approved words only, never titles or numbers, and ignores weak matches', () => {
  const s = state({ ratings: { arousal: 0.25, valence: 0.8 }, minutes: 490, hormones: { cortisol: 'low', melatonin: 'high' }, day: { sleep_hours: 'high' }, guidance: ['lake', 'unicorn'] })
  const m = match(s, [lake, desk, ...Array.from({ length: 10 }, (_, i) => mk('y' + i))])
  const conf = confidence(m, 12)
  const scene = buildScene(s, m, conf, APPROVED)
  assert.ok(scene.words.includes('lake'))
  assert.ok(!scene.words.includes('unicorn'))
  assert.ok(scene.words.every((w) => APPROVED.includes(w)))
  assert.equal(scene.momentId, 'm1')
  const p = scenePrompt(scene)
  assert.ok(p && !/\d/.test(p) && !p.includes('T m1'))
  const weak = buildScene(state({ guidance: ['desk'] }), match(state({ guidance: ['desk'] }), [lake, desk]), { value: 0.2, state: 'none', why: '' }, APPROVED)
  assert.equal(weak.momentId, null)
  assert.deepEqual(weak.words, ['desk', 'calm'].filter((w) => APPROVED.includes(w)))
})

test('parseMoments drops malformed rows and unsafe words', () => {
  const r = parseMoments({ v: 1, type: 'moments', approved: ['forest', 'BAD WORD!', 7], moments: [
    { id: 'm1', date: '2026-03-01', time: '08:10', title: 'ok', tags: ['lake', 'x;y', 'Z'], ratings: { arousal: 7, valence: 'x' }, hormones: { cortisol: 'low', melatonin: 'huge' }, day: { sleep_hours: 'high', 'bad key!': 'low' } },
    { id: 'm2', date: 'yesterday' }, null,
  ] })
  assert.equal(r.moments.length, 1)
  assert.deepEqual(r.moments[0].tags, ['lake'])
  assert.deepEqual(r.moments[0].ratings, { arousal: 1 })
  assert.deepEqual(r.moments[0].hormones, { cortisol: 'low' })
  assert.deepEqual(r.moments[0].day, { sleep_hours: 'high' })
  assert.deepEqual(r.approved, ['forest'])
  assert.equal(parseMoments({ v: 2 }), null)
})

test('EEG bands give a rough arousal and nothing when empty', () => {
  assert.ok(affectFromBands({ delta: 0.1, theta: 0.1, alpha: 0.1, beta: 0.5, gamma: 0.2 }).arousal > 0.7)
  assert.ok(affectFromBands({ delta: 0.4, theta: 0.2, alpha: 0.35, beta: 0.05, gamma: 0 }).arousal < 0.2)
  assert.deepEqual(affectFromBands({ delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 }), {})
})

test('provenance log chains and detects tampering', async () => {
  const log = new ProvenanceLog()
  await log.append('query', 'state compared with 12 moments', 1)
  await log.append('feedback', 'good on m1', 2)
  await log.append('scene', 'words lake calm', 3)
  assert.equal(await log.verify(), null)
  log.entries[1].detail = 'bad on m1'
  assert.equal(await log.verify(), 1)
})
