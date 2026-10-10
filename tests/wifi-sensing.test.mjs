import assert from 'node:assert/strict'
import test from 'node:test'
import { describeWifi, isFreshWifi, occupantFrom, parseWifiFrame } from '../src/lib/wifi-sensing.ts'

const base = { v: 1, type: 'wifisense', t: 1_800_000_000_000, source: 'ruview:wifi', presence: true, persons: 1, motion: 0.15, breathing: { bpm: 16.2, confidence: 0.87 }, heart: { bpm: 72.1, confidence: 0.2 }, signal_quality: 0.7, pose: null, validated: false }

test('a good frame is accepted and always marked unvalidated', () => {
  const f = parseWifiFrame(base)
  assert.equal(f.presence, true); assert.equal(f.persons, 1); assert.equal(f.motion, 0.15); assert.equal(f.validated, false); assert.equal(f.simulated, false)
  assert.equal(parseWifiFrame({ ...base, validated: true }).validated, false)       // never trusted from the message
  assert.equal(parseWifiFrame({ ...base, source: 'bridge:simulated' }).simulated, true)
})

test('malformed, hostile or out-of-range values are rejected or dropped', () => {
  for (const bad of [null, 'x', 5, { ...base, v: 2 }, { ...base, type: 'eeg' }, { ...base, t: 'now' }, { ...base, source: '<script>' }, { ...base, source: 'a'.repeat(50) }]) assert.equal(parseWifiFrame(bad), null)
  const f = parseWifiFrame({ ...base, motion: 7, persons: 500, breathing: { bpm: 900, confidence: 1 }, heart: { bpm: 10, confidence: 1 }, presence: 'yes' })
  assert.equal(f.motion, null); assert.equal(f.persons, null); assert.equal(f.breathing, null); assert.equal(f.heart, null); assert.equal(f.presence, null)
})

test('keypoints need exactly 17 sane points', () => {
  const pts = Array.from({ length: 17 }, (_, i) => ({ x: 0.5, y: i / 20, c: 0.9 }))
  assert.equal(parseWifiFrame({ ...base, pose: pts }).pose.length, 17)
  assert.equal(parseWifiFrame({ ...base, pose: pts.slice(0, 16) }).pose, null)
  assert.equal(parseWifiFrame({ ...base, pose: [...pts.slice(0, 16), { x: 9, y: 0, c: 1 }] }).pose, null)
})

test('the avatar only uses vitals the sensor is reasonably confident about', () => {
  const o = occupantFrom(parseWifiFrame(base))
  assert.equal(o.breathingBpm, 16.2); assert.equal(o.heartBpm, null)           // heart confidence 0.2 is below the bar
  assert.equal(occupantFrom(null), null)
})

test('freshness and plain-words description', () => {
  const f = parseWifiFrame(base)
  assert.equal(isFreshWifi(f, f.t + 1000), true); assert.equal(isFreshWifi(f, f.t + 60_000), false); assert.equal(isFreshWifi(null), false)
  const d = describeWifi(f); assert.match(d, /someone in range/); assert.match(d, /breathing about 16/); assert.match(d, /unvalidated/)
  assert.match(describeWifi(parseWifiFrame({ ...base, presence: false, breathing: null, heart: null })), /nobody in range/)
})
