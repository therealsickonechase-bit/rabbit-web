import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import test from 'node:test'
import { verifyStandardWebhook } from '../src/lib/webhook.ts'
import { renderAuthEmail } from '../src/lib/email-templates.ts'

const keyBytes = randomBytes(32)
const secret = `v1,whsec_${keyBytes.toString('base64')}`
const body = JSON.stringify({ user: { email: 'a@example.com' }, email_data: { token_hash: 'abc' } })

function sign(id, ts, payload, key = keyBytes) {
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')}`
}
const now = Date.now()
const ts = String(Math.floor(now / 1000))
const headers = (over = {}) => ({ id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body), ...over })

test('accepts a correctly signed request', async () => {
  assert.equal(await verifyStandardWebhook(secret, headers(), body, 300, now), true)
})

test('accepts when any one of several signatures is valid', async () => {
  const sig = `v1,${Buffer.from('nope').toString('base64')} ${sign('msg_1', ts, body)}`
  assert.equal(await verifyStandardWebhook(secret, headers({ signature: sig }), body, 300, now), true)
})

test('rejects a tampered body, wrong secret, wrong id and missing headers', async () => {
  assert.equal(await verifyStandardWebhook(secret, headers(), body + ' ', 300, now), false)
  assert.equal(await verifyStandardWebhook(`v1,whsec_${randomBytes(32).toString('base64')}`, headers(), body, 300, now), false)
  assert.equal(await verifyStandardWebhook(secret, headers({ id: 'msg_2' }), body, 300, now), false)
  assert.equal(await verifyStandardWebhook(secret, headers({ signature: null }), body, 300, now), false)
  assert.equal(await verifyStandardWebhook(secret, { id: null, timestamp: null, signature: null }, body, 300, now), false)
})

test('rejects stale and future timestamps (replay protection)', async () => {
  const old = String(Math.floor(now / 1000) - 3600)
  assert.equal(await verifyStandardWebhook(secret, { id: 'msg_1', timestamp: old, signature: sign('msg_1', old, body) }, body, 300, now), false)
  const future = String(Math.floor(now / 1000) + 3600)
  assert.equal(await verifyStandardWebhook(secret, { id: 'msg_1', timestamp: future, signature: sign('msg_1', future, body) }, body, 300, now), false)
  assert.equal(await verifyStandardWebhook(secret, headers({ timestamp: 'abc' }), body, 300, now), false)
})

test('a malformed secret or signature never throws, it just fails', async () => {
  assert.equal(await verifyStandardWebhook('not base64 !!!', headers(), body, 300, now), false)
  assert.equal(await verifyStandardWebhook(secret, headers({ signature: 'garbage v2,xx v1,' }), body, 300, now), false)
})

test('signup email links to our confirm page with an encoded token and no raw HTML', () => {
  const mail = renderAuthEmail({ type: 'signup', appUrl: 'https://app.rabbitsoftware.io', tokenHash: 'a b&c"<d>' })
  assert.match(mail.subject, /Confirm/)
  assert.ok(mail.text.includes('https://app.rabbitsoftware.io/auth/confirm?token_hash=a%20b%26c%22%3Cd%3E&type=signup&next=%2F'))
  assert.ok(!mail.html.includes('<d>'), 'token must be escaped in the HTML')
  assert.ok(!mail.html.includes('"<d'), 'quotes must be escaped in the HTML')
})

test('recovery email just signs the person in (there are no passwords and no reset-password page)', () => {
  const mail = renderAuthEmail({ type: 'recovery', appUrl: 'https://app.rabbitsoftware.io/console', tokenHash: 'x' })
  assert.ok(mail.text.includes('https://app.rabbitsoftware.io/console/auth/confirm?token_hash=x&type=recovery&next=%2F'))
  assert.ok(!mail.text.includes('reset-password'))
  assert.match(mail.html, /Sign in/)
  assert.ok(!/Reset password/i.test(mail.html))
})

test('reauthentication email shows the code and no link', () => {
  const mail = renderAuthEmail({ type: 'reauthentication', appUrl: 'https://x.test', tokenHash: 'h', token: '123456' })
  assert.ok(mail.text.includes('123456'))
  assert.ok(!mail.text.includes('auth/confirm'))
})
