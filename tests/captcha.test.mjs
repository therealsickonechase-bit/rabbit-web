import assert from 'node:assert/strict'
import test from 'node:test'
import { captchaSubmissionReady, usableCaptchaToken } from '../src/lib/auth/captcha.ts'

test('missing, blank, non-string and oversized tokens cannot be submitted', () => {
  for (const token of [undefined, null, '', '  ', 1, {}, 'x'.repeat(2049)]) {
    assert.equal(usableCaptchaToken(token), false)
    assert.equal(captchaSubmissionReady(token, false), false)
  }
})

test('fresh tokens permit submission only while no request is pending', () => {
  const token = 'synthetic-token'
  assert.equal(usableCaptchaToken(token), true)
  assert.equal(captchaSubmissionReady(token, false), true)
  assert.equal(captchaSubmissionReady(token, true), false)
  assert.equal(captchaSubmissionReady('', false), false)
})
