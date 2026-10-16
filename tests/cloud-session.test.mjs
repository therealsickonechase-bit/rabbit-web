import assert from 'node:assert/strict'
import test from 'node:test'
import { ownerCloudApi, shellCommand } from '../src/lib/cloud-jobs.ts'
import { SESSION_MAX_TIMEOUT, sessionAction, sessionLine, sessionView, shellPayload } from '../src/lib/cloud-session.ts'

const denied = (fn, status = 400) => { try { fn() } catch (e) { assert.equal(e.status, status); return } assert.fail('expected a refusal') }

test('a plain command keeps exactly its old shape, so nothing changes unless a session is asked for', () => {
  assert.deepEqual(shellCommand({ command: 'echo hello', consent: true }), { command: 'echo hello', consent: true })
  assert.deepEqual(shellCommand({ command: 'echo hello', consent: true, session: false }), { command: 'echo hello', consent: true })
  assert.deepEqual(shellPayload('ls', false, 150), { command: 'ls', consent: true })
})

test('a session command carries the session flag and a bounded timeout, and everything else is refused', () => {
  assert.deepEqual(shellCommand({ command: 'npm test', consent: true, session: true }), { command: 'npm test', consent: true, session: true })
  assert.deepEqual(shellCommand({ command: 'npm test', consent: true, session: true, timeoutSeconds: 120 }), { command: 'npm test', consent: true, session: true, timeoutSeconds: 120 })
  for (const bad of [
    { session: 'yes' }, { timeoutSeconds: 60 }, { session: false, timeoutSeconds: 60 }, { session: true, timeoutSeconds: 151 }, { session: true, timeoutSeconds: 0 },
    { session: true, timeoutSeconds: 2.5 }, { session: true, timeoutSeconds: '60' }, { session: true, env: { A: 'b' } },
  ]) denied(() => shellCommand({ command: 'ls', consent: true, ...bad }))
  denied(() => shellCommand({ command: 'ls', consent: false, session: true }))
})

test('the page builds the same payload the backend accepts, and clamps the timeout', () => {
  assert.deepEqual(shellPayload('ls', true, 120), { command: 'ls', consent: true, session: true, timeoutSeconds: 120 })
  assert.equal(shellPayload('ls', true, 9999).timeoutSeconds, SESSION_MAX_TIMEOUT)
  assert.equal(shellPayload('ls', true, 0).timeoutSeconds, 1)
  assert.equal(shellPayload('ls', true, 2.5).timeoutSeconds, 90)
  for (const p of [shellPayload('ls', true), shellPayload('ls', true, 150), shellPayload('ls', false)]) shellCommand(p)      // always valid for the backend
})

test('the session route is reachable only for GET and POST, and the other owner paths are unchanged', () => {
  assert.equal(ownerCloudApi('/api/cloudshell/session', 'GET'), true)
  assert.equal(ownerCloudApi('/api/cloudshell/session', 'POST'), true)
  for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal(ownerCloudApi('/api/cloudshell/session', method), false)
  assert.equal(ownerCloudApi('/api/cloudshell/session/end', 'POST'), false)
  assert.equal(ownerCloudApi('/api/cloudshell/execute', 'POST'), true)
  assert.equal(ownerCloudApi('/api/cloudshell/execute', 'GET'), false)
})

test('session actions need an explicit approval and nothing else', () => {
  assert.equal(sessionAction({ action: 'start', consent: true }), 'start')
  assert.equal(sessionAction({ action: 'end', consent: true }), 'end')
  for (const bad of [null, [], {}, { action: 'start' }, { action: 'start', consent: false }, { action: 'kill', consent: true }, { action: 'end', consent: true, extra: 1 }]) assert.throws(() => sessionAction(bad), undefined, JSON.stringify(bad))
})

test('the Worker reply is reduced to safe fields and anything odd means no session', () => {
  const good = { active: true, startedAt: 1000, lastUsed: 2000, idleExpiresAt: 5000, hardExpiresAt: 9000, secret: 'x' }
  assert.deepEqual(sessionView(good), { active: true, startedAt: 1000, lastUsed: 2000, idleExpiresAt: 5000, hardExpiresAt: 9000 })
  assert.ok(!('secret' in sessionView(good)))
  for (const bad of [null, undefined, 'x', [], {}, { active: false }, { active: true }, { active: true, idleExpiresAt: 'soon', hardExpiresAt: 5 }, { active: true, idleExpiresAt: -1, hardExpiresAt: 5 }]) {
    assert.deepEqual(sessionView(bad), { active: false }, JSON.stringify(bad))
  }
})

test('the status line says what is open, when it ends and why, and never promises more than the limits', () => {
  const now = 1_000_000
  assert.match(sessionLine(null, now), /No session is open/)
  assert.match(sessionLine({ active: false }, now), /No session is open/)
  const idle = sessionLine({ active: true, idleExpiresAt: now + 12 * 60_000, hardExpiresAt: now + 90 * 60_000 }, now)
  assert.match(idle, /about 12 minutes \(idle time\)/)
  const hard = sessionLine({ active: true, idleExpiresAt: now + 30 * 60_000, hardExpiresAt: now + 3 * 60_000 }, now)
  assert.match(hard, /about 3 minutes \(the 2-hour limit\)/)
  assert.match(sessionLine({ active: true, idleExpiresAt: now + 10_000, hardExpiresAt: now + 9_000_000 }, now), /about 1 minute \(/)
  assert.match(sessionLine({ active: true, idleExpiresAt: now - 1, hardExpiresAt: now + 9_000_000 }, now), /expired/)
})
