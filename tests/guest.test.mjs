import assert from 'node:assert/strict'
import test from 'node:test'
import { ACCESS_DAYS, evaluateRedemption, generateToken, guestEmail, guestPathAllowed, guestState, hashToken, isGuestEmail, timeLeft, tokenShape } from '../src/lib/guest.ts'

const DAY = 86_400_000
const now = Date.parse('2026-10-09T12:00:00Z')
const fresh = (o = {}) => ({ link_expires_at: new Date(now + 14 * DAY).toISOString(), first_used_at: null, access_until: null, uses: 0, max_uses: 5, revoked_at: null, ...o })

test('tokens are random, well-formed and hashed', async () => {
  const a = generateToken(), b = generateToken()
  assert.ok(tokenShape(a))
  assert.notEqual(a, b)
  assert.match(await hashToken(a), /^[0-9a-f]{64}$/)
  assert.notEqual(await hashToken(a), await hashToken(b))
  for (const bad of ['', 'rbg_short', 'rbk_' + 'a'.repeat(32), a + ' ', ' ' + a, a + '!']) assert.equal(tokenShape(bad), false, bad)
})

test('first use starts a 3-day pass', () => {
  const r = evaluateRedemption(fresh(), now)
  assert.equal(r.ok, true)
  assert.equal(r.first, true)
  assert.equal(Date.parse(r.accessUntil) - now, ACCESS_DAYS * DAY)
})

test('later uses keep the original end time and never extend it', () => {
  const until = new Date(now + 2 * DAY).toISOString()
  const r = evaluateRedemption(fresh({ first_used_at: new Date(now - DAY).toISOString(), access_until: until, uses: 2 }), now)
  assert.deepEqual([r.ok, r.first, r.accessUntil], [true, false, until])
})

test('an ended, revoked, expired or over-used pass is refused', () => {
  const used = { first_used_at: new Date(now - 4 * DAY).toISOString() }
  assert.equal(evaluateRedemption(fresh({ ...used, access_until: new Date(now - 1000).toISOString() }), now).reason, 'access_ended')
  assert.equal(evaluateRedemption(fresh({ revoked_at: new Date(now - 1000).toISOString() }), now).reason, 'revoked')
  assert.equal(evaluateRedemption(fresh({ link_expires_at: new Date(now - 1000).toISOString() }), now).reason, 'link_expired')
  assert.equal(evaluateRedemption(fresh({ uses: 5 }), now).reason, 'too_many_uses')
})

test('an unused-link expiry does not cut off a pass that is already running', () => {
  const running = fresh({ link_expires_at: new Date(now - DAY).toISOString(), first_used_at: new Date(now - DAY).toISOString(), access_until: new Date(now + 2 * DAY).toISOString(), uses: 1 })
  assert.equal(evaluateRedemption(running, now).ok, true)
})

test('guest accounts are recognised, and a guest without a valid end fails closed', () => {
  assert.equal(guestState({ app_metadata: {} }, now).isGuest, false)
  assert.equal(guestState(null, now).isGuest, false)
  assert.deepEqual(guestState({ app_metadata: { guest: true, guest_until: new Date(now + 1000).toISOString() } }, now).active, true)
  assert.equal(guestState({ app_metadata: { guest: true, guest_until: new Date(now - 1000).toISOString() } }, now).active, false)
  assert.equal(guestState({ app_metadata: { guest: true } }, now).active, false)
  assert.equal(guestState({ app_metadata: { guest: true, guest_until: 'not a date' } }, now).active, false)
  assert.equal(guestState({ app_metadata: { guest: 'true' } }, now).isGuest, false)    // only a real boolean counts
})

test('guest emails are recognised and cannot be confused with real ones', () => {
  assert.equal(isGuestEmail(guestEmail('abc')), true)
  assert.equal(isGuestEmail('person@gmail.com'), false)
  assert.equal(isGuestEmail('x@guest.rabbitsoftware.io.evil.com'), false)
  assert.equal(isGuestEmail(null), false)
})

test('guests may see only research, CRISPR and the guide', () => {
  for (const p of ['/research', '/crispr', '/guide', '/guest', '/research/x']) assert.equal(guestPathAllowed(p), true, p)
  for (const p of ['/', '/dashboard', '/brain', '/twin', '/keys', '/settings', '/ask', '/collections', '/tasks', '/memory', '/members', '/guests', '/chain', '/agents', '/api/mcp', '/research-evil', '/crisprx']) assert.equal(guestPathAllowed(p), false, p)
})

test('time left reads naturally', () => {
  assert.equal(timeLeft(new Date(now + 2 * DAY + 3 * 3_600_000).toISOString(), now), '2d 3h left')
  assert.equal(timeLeft(new Date(now + 5 * 3_600_000).toISOString(), now), '5h left')
  assert.equal(timeLeft(new Date(now + 90_000).toISOString(), now), '1m left')
  assert.equal(timeLeft(new Date(now - 1).toISOString(), now), 'ended')
  assert.equal(timeLeft(null, now), 'ended')
})
