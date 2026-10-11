import assert from 'node:assert/strict'
import test from 'node:test'
import { CONNECTIONS, STATUS_LABEL, ageText, judge, merge, summary } from '../src/lib/connections.ts'

test('every connection says where it runs, what it is used for, what leaves the computer and how to start it', () => {
  assert.equal(new Set(CONNECTIONS.map((c) => c.id)).size, CONNECTIONS.length)
  for (const c of CONNECTIONS) for (const k of ['name', 'where', 'uses', 'leaves', 'start']) assert.ok(c[k].length > 8, `${c.id}.${k}`)
  for (const id of ['openbci', 'selfdata', 'wifi']) assert.match(CONNECTIONS.find((c) => c.id === id).leaves, /^Nothing/)
  assert.match(CONNECTIONS.find((c) => c.id === 'qwen').leaves, /Never EEG/)
})

test('unreported sources are off, the server is ready, and reports fill in status and detail', () => {
  const none = merge({})
  assert.equal(none.find((c) => c.id === 'wifi').status, 'off'); assert.equal(none.find((c) => c.id === 'server').status, 'idle')
  const some = merge({ wifi: { status: 'live', detail: 'someone in range', lastAt: 1000 } })
  assert.equal(some.find((c) => c.id === 'wifi').detail, 'someone in range'); assert.equal(some.find((c) => c.id === 'wifi').lastAt, 1000)
})

test('the twin relay launch instructions retain the Windows directory separator', () => {
  assert.equal(CONNECTIONS.find((c) => c.id === 'relay').start, 'research-agents\\start-twinnet.ps1 -Relay, then Connect Twin A in the Twin network panel')
})

test('account-free connections never load saved provider keys or send portrait summaries to an account', () => {
  assert.match(CONNECTIONS.find((c) => c.id === 'claude').leaves, /keys are never loaded/)
  assert.match(CONNECTIONS.find((c) => c.id === 'selfdata').leaves, /browser only/)
  assert.match(CONNECTIONS.find((c) => c.id === 'server').leaves, /No account session/)
})

test('a live feed that goes quiet is shown as quiet, not live', () => {
  assert.equal(judge('live', 1000, 3000), 'live'); assert.equal(judge('live', 1000, 20_000), 'stale'); assert.equal(judge('off', 1000, 20_000), 'off'); assert.equal(judge('live', null, 20_000), 'live')
})

test('ages and the summary line read plainly', () => {
  assert.equal(ageText(null, 5), 'never'); assert.equal(ageText(1000, 1500), 'just now'); assert.equal(ageText(0, 5000), '5 s ago'); assert.equal(ageText(0, 150_000), '3 min ago'); assert.equal(ageText(0, 7_300_000), '2 h ago')
  const s = summary(merge({ openbci: { status: 'live' }, wifi: { status: 'live' }, qwen: { status: 'idle' } }))
  assert.match(s, /2 of 3 local data feeds live; 2 connections live in all/)
  assert.equal(STATUS_LABEL.stale, 'quiet')
})

test('the wormhole, twin relay and Supabase are listed, with honest "leaves" text and sensible defaults', () => {
  for (const id of ['wormhole', 'relay', 'supabase']) assert.ok(CONNECTIONS.some((c) => c.id === id), id)
  assert.match(CONNECTIONS.find((c) => c.id === 'wormhole').leaves, /^Nothing/)
  assert.match(CONNECTIONS.find((c) => c.id === 'relay').leaves, /ciphertext/)
  assert.match(CONNECTIONS.find((c) => c.id === 'supabase').leaves, /Raw EEG, wearable and lab data stay on this computer/)
  const m = merge({})
  assert.equal(m.find((c) => c.id === 'supabase').status, 'idle'); assert.equal(m.find((c) => c.id === 'relay').status, 'off')
})
