import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrompt, isFreshSelf, parseSelfFrame, petals } from '../src/lib/self-data.ts'

const dim = (key, value, extra = {}) => ({ key, label: 'x', unit: 'h', value, trend: 0, raw: 6.2, n: 30, ...extra })
const msg = (extra = {}) => ({
  v: 1, type: 'selfdata', t: 1_800_000_000_000,
  profile: { dims: [dim('sleep', 0.2), dim('recovery', 0.9), dim('cardio', null, { n: 0 }), { key: 'evil', value: 1, n: 5 }], synthetic: true, story: ['Sleep: 1 h below your usual.'], labs: { flags: { in_range: 6, high: 1, low: 0 } } },
  flows: { pc: { in_bps: 420000, out_bps: 38000, connections: 40 }, events: [{ dir: 'in', label: 'research feed', bytes: 900 }, { dir: 'x', label: 'bad' }] },
  ...extra,
})

test('frames are validated and unknown dimensions or events dropped', () => {
  const f = parseSelfFrame(msg())
  assert.equal(f.dims.length, 3); assert.equal(f.events.length, 1); assert.equal(f.synthetic, true)
  assert.equal(parseSelfFrame({ ...msg(), v: 2 }), null); assert.equal(parseSelfFrame('x'), null)
})

test('words are recomputed from numbers, not trusted from the message', () => {
  const f = parseSelfFrame(msg({ words: { levels: { sleep: 'far above usual' } } }))
  assert.equal(f.words.levels.sleep, 'below usual'); assert.equal(f.words.levels.recovery, 'far above usual'); assert.equal(f.words.levels.cardio, 'unknown')
  assert.equal(f.words.network.inbound, 'busy'); assert.equal(f.words.network.outbound, 'steady')
})

test('the prompt holds fixed words only: no digits, no raw values, no story text', () => {
  const p = buildPrompt(parseSelfFrame(msg()), 'portrait')
  assert.ok(!/\d/.test(p)); assert.ok(p.includes('sleep below usual')); assert.ok(!p.includes('cardio')); assert.ok(!p.includes('1 h'))
})

test('petals: unknown dimensions are short and faint, values map to length', () => {
  const ps = petals(parseSelfFrame(msg()))
  assert.equal(ps[2].known, false); assert.ok(ps[1].length > ps[0].length); assert.ok(ps[2].length < 0.2)
})

test('freshness', () => {
  const f = parseSelfFrame(msg())
  assert.equal(isFreshSelf(f, f.t + 1000), true); assert.equal(isFreshSelf(f, f.t + 9000), false); assert.equal(isFreshSelf(null), false)
})
