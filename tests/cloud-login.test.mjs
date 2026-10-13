import assert from 'node:assert/strict'
import test from 'node:test'
import { restrictedLogin, restrictedLoginInput } from '../src/lib/cloud-login.ts'
import { ownerCloudApi } from '../src/lib/cloud-jobs.ts'
import { readFile } from 'node:fs/promises'

const config = { CLOUD_TOOLS_ACCESS_MODE: 'supabase', CLOUD_TOOLS_ALLOWED_EMAILS: 'allowed@example.com' }

test('restricted login input is existing allowlist only, exact bounded fields, mode locked', () => {
  assert.deepEqual(restrictedLoginInput({ email: 'ALLOWED@example.com', password: 'password' }, config), { email: 'allowed@example.com', password: 'password' })
  for (const mode of ['local-only', 'cloudflare-access']) assert.throws(() => restrictedLoginInput({ email: 'allowed@example.com', password: 'password' }, { ...config, CLOUD_TOOLS_ACCESS_MODE: mode }), error => error.status === 403)
  assert.throws(() => restrictedLoginInput({ email: 'other@example.com', password: 'password' }, config), error => error.status === 401 && !error.message.includes('other'))
  for (const value of [{ email: 'allowed@example.com', password: '', signup: true }, { email: 'allowed@example.com', password: 'p'.repeat(1025) }, null]) assert.throws(() => restrictedLoginInput(value, config))
})

test('restricted login verifies provider user and confirmation after password, keeps authorization pending', async () => {
  const calls = []
  const client = { auth: {
    signInWithPassword: async input => { calls.push(['signInWithPassword', input.email]); return { error: null } },
    getUser: async () => { calls.push(['getUser']); return { data: { user: { email: 'allowed@example.com', email_confirmed_at: 'confirmed' } }, error: null } },
    signOut: async () => { calls.push(['signOut']) },
  } }
  assert.deepEqual(await restrictedLogin(client, { email: 'allowed@example.com', password: 'password' }, config), { signedIn: true, approvalRequired: true })
  assert.deepEqual(calls.map(call => call[0]), ['signInWithPassword', 'getUser'])
})

test('unconfirmed, unallowlisted, mismatch and failed verification sign out with generic errors', async () => {
  for (const user of [null, { email: 'allowed@example.com' }, { email: 'other@example.com', email_confirmed_at: 'confirmed' }]) {
    let signedOut = 0
    const client = { auth: {
      signInWithPassword: async () => ({ error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => { signedOut++ },
    } }
    await assert.rejects(restrictedLogin(client, { email: 'allowed@example.com', password: 'password' }, config), error => error.status === 401 && error.message === 'Existing confirmed allowlisted account sign-in failed.')
    assert.equal(signedOut, 1)
  }
  for (const failure of ['password', 'verification']) {
    let signedOut = 0
    const client = { auth: {
      signInWithPassword: async () => ({ error: failure === 'password' ? new Error('provider secret') : null }),
      getUser: async () => ({ data: { user: { email: 'allowed@example.com', email_confirmed_at: 'confirmed' } }, error: failure === 'verification' ? new Error('provider secret') : null }),
      signOut: async () => { signedOut++ },
    } }
    await assert.rejects(restrictedLogin(client, { email: 'allowed@example.com', password: 'password' }, config), error => error.status === 401 && !error.message.includes('provider secret'))
    assert.equal(signedOut, 1)
  }
})

test('all approved missing route handlers exist and explicitly use machine guard, legacy auth stays blocked', async () => {
  const routes = [
    ['access/request', 'POST', 'cloudAccessBff(request, true)'],
    ['access/status', 'GET', 'cloudAccessBff(request, true)'],
    ['shell', 'POST', "cloudJobBff(request, 'shell', undefined, false, true)"],
    ['vault/jobs', 'POST', "cloudJobBff(request, 'vault', undefined, false, true)"],
    ['vault/jobs/[id]', 'GET', '.id, false, true)'],
    ['vault/jobs/[id]/result', 'GET', '.id, true, true)'],
  ]
  for (const [path, method, guard] of routes) {
    const source = await readFile(new URL(`../src/app/api/cloud-agent/${path}/route.ts`, import.meta.url), 'utf8')
    assert.equal(source.includes(guard), true)
    assert.equal(ownerCloudApi('/api/cloud-agent/' + path.replace('[id]', 'a'.repeat(64)), method), true)
  }
  const login = await readFile(new URL('../src/app/api/cloud-login/route.ts', import.meta.url), 'utf8')
  assert.equal(login.includes('requireWriteOrigin(request)'), true)
  assert.equal(login.includes('readJson(request, 4096)'), true)
  assert.equal(ownerCloudApi('/api/cloud-login', 'POST'), true)
  assert.equal(ownerCloudApi('/api/auth/login', 'POST'), false)
  assert.equal(ownerCloudApi('/api/cloud-agent/access/approve', 'POST'), false)
})

test('returned and thrown signOut failures explicitly report unconfirmed cleanup without provider secrets', async () => {
  for (const failure of ['returned', 'thrown']) {
    const client = { auth: {
      signInWithPassword: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { email: 'other@example.com', email_confirmed_at: 'confirmed' } }, error: null }),
      signOut: async () => {
        if (failure === 'thrown') throw new Error('provider credential details')
        return { error: new Error('provider credential details') }
      },
    } }
    await assert.rejects(restrictedLogin(client, { email: 'allowed@example.com', password: 'password' }, config),
      error => error.status === 503 && error.message.includes('Session clearance is NOT confirmed') &&
        error.message.includes('checks remain required') && !error.message.includes('provider credential details'))
  }
})
