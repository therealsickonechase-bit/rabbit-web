import assert from 'node:assert/strict'
import test from 'node:test'
import { cortisolLevel, hormoneAt, levelsFrom, melatoninLevel, parseHormoneCsv } from '../src/lib/hormone-context.ts'
import { buildWords, describeWords, validSpaceId } from '../src/lib/hf-generator.ts'
import { parseLiveFrame } from '../src/lib/live-signals.ts'

const now = 1_800_000_000_000
const frame = (extra = {}) => parseLiveFrame({ v: 1, t: now, source: 'brainflow:cyton', eeg: { F3: { delta: 0.1, theta: 0.1, alpha: 0.6, beta: 0.1, gamma: 0.05 }, O1: { delta: 0.1, theta: 0.1, alpha: 0.6, beta: 0.1, gamma: 0.05 } }, ...extra })

test('hormone CSVs are parsed strictly and interpolated', () => {
  const ok = parseHormoneCsv('time,cortisol,melatonin\n08:00,12,\n12:00,6,\n22:30,,38\n')
  assert.equal(ok.ok, true); assert.equal(ok.rows.length, 3)
  assert.equal(hormoneAt(ok.rows, 10, 'cortisol'), 9)
  assert.equal(hormoneAt(ok.rows, 3, 'cortisol'), 12, 'holds the first value before the first sample')
  assert.equal(hormoneAt(ok.rows, 23, 'melatonin'), 38)
  assert.equal(hormoneAt(parseHormoneCsv('time,cortisol\n8,10').rows, 8, 'melatonin'), null)
  for (const bad of ['', 'time\n8', 'cortisol\n9', 'time,cortisol\nnoon,9', 'time,cortisol\n8,-3', 'time,melatonin\n8,9000', 'time,cortisol\n25,9']) assert.equal(parseHormoneCsv(bad).ok, false, bad)
  assert.equal(parseHormoneCsv('time,cortisol\n' + '8,9\n'.repeat(2500)).ok, false, 'too many rows')
})

test('hormone numbers become words and the label says where they came from', () => {
  assert.deepEqual([cortisolLevel(14), cortisolLevel(7), cortisolLevel(2)], ['high', 'typical', 'low'])
  assert.deepEqual([melatoninLevel(60), melatoninLevel(10), melatoninLevel(2)], ['high', 'typical', 'low'])
  assert.deepEqual(levelsFrom({ kind: 'clock' }, 8), { cortisol: 'high', melatonin: 'typical', label: 'typical daily pattern for the time of day (not measured)' })
  assert.equal(levelsFrom({ kind: 'manual', cortisol: 'low', melatonin: 'high' }, 8).melatonin, 'high')
  const csv = { kind: 'csv', name: 'my.csv', rows: [{ hour: 8, cortisol: 3, melatonin: null }] }
  const l = levelsFrom(csv, 8)
  assert.equal(l.cortisol, 'low'); assert.equal(l.melatonin, 'typical', 'a missing hormone falls back to the clock pattern'); assert.match(l.label, /measured values from my\.csv/)
})

test('the Space request is words and a seed only, with the state source stated', () => {
  const b = buildWords(frame({ state: { label: 'eyes_closed', confidence: 0.9, model: 'transformer' }, ecg: { bpm: 52 }, emg: { arm: 30 } }), { kind: 'clock' }, 8, 42, 1024, 5)
  assert.deepEqual(b.words, { state: 'eyes_closed', rhythm: 'alpha', arousal: 'low', cortisol: 'high', melatonin: 'typical', confident: true, seed: 42, resolution: 1024, heart: 'slow', muscle: 'tense' })
  assert.equal(b.stateSource, 'transformer (local bridge)'); assert.deepEqual(b.measured, { heart: true, muscle: true, eeg: true })
  const json = JSON.stringify(b.words)
  assert.ok(!/52|30|0\.6/.test(json.replace('1024', '').replace('42', '')), 'no ECG, EMG or band numbers in the request')
  for (const v of Object.values(b.words)) assert.ok(['string', 'boolean', 'number'].includes(typeof v))
})

test('without a transformer state the alpha share decides, and without any frame the words are neutral', () => {
  const rule = buildWords(frame(), { kind: 'manual', cortisol: 'typical', melatonin: 'high' }, 22, 7, 768)
  assert.equal(rule.words.state, 'eyes_closed'); assert.equal(rule.stateSource, 'alpha-share rule'); assert.equal(rule.words.melatonin, 'high')
  const open = buildWords(frame({ eeg: { F3: { alpha: 0.1, beta: 0.4, theta: 0.2, delta: 0.2, gamma: 0.1 } } }), { kind: 'clock' }, 12, 1, 1024)
  assert.equal(open.words.state, 'eyes_open')
  const none = buildWords(null, { kind: 'clock' }, 3, 9, 999)
  assert.equal(none.stateSource, 'default'); assert.equal(none.words.resolution, 1024, 'an unknown size falls back'); assert.equal(none.words.heart, 'steady'); assert.equal(none.words.muscle, 'still')
  assert.deepEqual(none.measured, { heart: false, muscle: false, eeg: false })
  assert.equal(buildWords(null, { kind: 'clock' }, 3, -5.7, 1024).words.seed, 5)
  assert.match(describeWords(none.words), /eyes open/)
})

test('only well-formed Space ids are accepted', () => {
  assert.equal(validSpaceId('Therealsickonechase-bit/rabbitos-eeg-qwen-image'), true)
  for (const bad of ['', 'no-slash', 'a/b/c', 'https://evil.example/x', '../x/y', 'a b/c', '/x', 'x/']) assert.equal(validSpaceId(bad), false, bad)
})
