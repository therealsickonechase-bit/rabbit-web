import assert from 'node:assert/strict'
import test from 'node:test'
import { SUGGESTED_QUESTIONS, answer, buildAvatarSystem, cleanQuestion, heartNow } from '../src/lib/avatar-qa.ts'
import { physioAt } from '../src/lib/body-physiology.ts'
import { ownEeg } from '../src/lib/avatar-mind.ts'

const affect = { arousal: 0.5, valence: 0.2, stress: 0.3, fatigue: 0.2, energy: 0.8 }
const ctx = (o = {}) => ({
  affect, emotion: 'content', intent: 'walk', thought: 'I feel content with some energy, so I will walk.', reasons: ['my cortisol is high'],
  hormones: { cortisol: 'typical', melatonin: 'low', label: 'typical daily pattern for the time of day (not measured)' },
  physio: physioAt('healthy', 0), scenario: 'healthy', source: 'simulated twin', eeg: ownEeg(affect), ...o,
})

test('feelings, reasons, EEG and hormones are answered from the avatar state', () => {
  assert.match(answer('How do you feel?', ctx()).text, /content/)
  assert.match(answer('Why are you moving like that?', ctx()).text, /walk/)
  const eeg = answer('what is your EEG showing', ctx())
  assert.match(eeg.text, /alpha|beta/); assert.match(eeg.text, /synthetic/); assert.equal(eeg.evidence, 'exploratory')
  assert.match(answer('tell me about your cortisol', ctx({ hormones: { cortisol: 'high', melatonin: 'low', label: 'levels you chose' } })).text, /keyed up/)
})

test('each organ can be asked about by name or by what it does, and comes with a focus marker', () => {
  for (const [q, organ] of [['what does your liver do?', 'liver'], ['how are your kidneys', 'kidneys'], ['tell me about digestion', 'stomach'], ['how is your gut', 'gut'], ['how is your spinal cord', 'spinalcord'], ['can you see well', 'eyes'], ['how strong are your arms', 'muscle']]) {
    const a = answer(q, ctx()); assert.equal(a.organ, organ, q); assert.ok(a.text.length > 40)
  }
  assert.match(answer('how is your heart', ctx({ intent: 'run' })).text, /\d+ times a minute/)
})

test('running raises the heart rate above resting, and measured data is labelled as such', () => {
  assert.ok(heartNow(ctx({ intent: 'run' })) > heartNow(ctx({ intent: 'rest' })))
  assert.match(answer('heart rate', ctx({ source: 'live signals' })).text, /measured/); assert.match(answer('heart rate', ctx()).text, /model value/)
})

test('the avatar is honest about being a model, knows the gene and the scenario, and never invents answers', () => {
  assert.match(answer('are you conscious?', ctx()).text, /not conscious/)
  const gene = answer('tell me about SLC6A4', ctx()); assert.match(gene.text, /6532/); assert.equal(gene.evidence, 'established')
  assert.match(answer('what scenario is this', ctx({ scenario: 'stroke' })).text, /stroke/i)
  assert.equal(answer('what is the capital of France', ctx()).topic, 'unknown'); assert.equal(answer('', ctx()).topic, 'empty')
  for (const s of SUGGESTED_QUESTIONS) assert.notEqual(answer(s, ctx()).topic, 'unknown', s)
})

test('the Claude system prompt carries words only: no digits from the avatar state', () => {
  const p = buildAvatarSystem({ emotion: 'tense', intent: 'pace', scenario: 'healthy', source: 'simulated twin', cortisol: 'high', melatonin: 'low' })
  assert.match(p, /tense/); assert.match(p, /not a person|model/); assert.match(p, /medical advice/)
  assert.ok(!/\d/.test(p.split('\n')[1]), 'state line has no digits')
})

test('questions are cleaned and bounded', () => {
  assert.equal(cleanQuestion('  hello  ').question, 'hello'); assert.equal(cleanQuestion(5).ok, false); assert.equal(cleanQuestion('x').ok, false); assert.equal(cleanQuestion('a'.repeat(401)).ok, false)
})

import { organSpot } from '../src/lib/avatar-qa.ts'
import { ORGAN_IDS } from '../src/lib/body.ts'

test('organs sit inside the avatar torso on the right side: liver on the right, heart and stomach on the left, bladder low', () => {
  for (const id of ORGAN_IDS) { const [x, y, z] = organSpot(id); assert.ok(Number.isFinite(x + y + z), id); assert.ok(y > 0.5 && y < 1.75, `${id} y ${y}`) }
  assert.ok(organSpot('liver')[0] < 0, 'liver is on the avatar right (negative x)'); assert.ok(organSpot('heart')[0] > 0 && organSpot('stomach')[0] > 0)
  assert.ok(organSpot('bladder')[1] < organSpot('kidneys')[1] && organSpot('kidneys')[1] < organSpot('heart')[1])
  for (const id of ['heart', 'liver', 'stomach', 'kidneys', 'spinalcord']) { const [x, , z] = organSpot(id); assert.ok(Math.abs(x) < 0.17 && Math.abs(z) < 0.12, `${id} inside the torso ${x},${z}`) }
})
