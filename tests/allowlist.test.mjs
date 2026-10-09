import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedDashboardEmail } from '../src/lib/auth/allowlist.ts'

test('requires an exact email match from the comma-separated allowlist', () => {
  assert.equal(isAllowedDashboardEmail('Owner@example.com', 'owner@example.com, collaborator@example.com'), true)
  assert.equal(isAllowedDashboardEmail('owner+other@example.com', 'owner@example.com'), false)
  assert.equal(isAllowedDashboardEmail('owner@example.com.attacker.test', 'owner@example.com'), false)
  assert.equal(isAllowedDashboardEmail('attacker@owner@example.com', 'owner@example.com'), false)
})

test('fails closed when the email or allowlist is empty', () => {
  assert.equal(isAllowedDashboardEmail(undefined, 'owner@example.com'), false)
  assert.equal(isAllowedDashboardEmail('owner@example.com', ''), false)
  assert.equal(isAllowedDashboardEmail('owner@example.com', ' , '), false)
})

test('trims whitespace around addresses and allowlist entries', () => {
  assert.equal(isAllowedDashboardEmail(' owner@example.com ', ' owner@example.com , '), true)
})

test('a missing environment variable allows nobody', () => {
  const saved = process.env.DASHBOARD_ALLOWED_EMAILS
  delete process.env.DASHBOARD_ALLOWED_EMAILS
  try {
    assert.equal(isAllowedDashboardEmail('owner@example.com'), false)
  } finally {
    if (saved !== undefined) process.env.DASHBOARD_ALLOWED_EMAILS = saved
  }
})
