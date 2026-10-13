import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'
import { accessHumanIdentity, accessMode, checkCloudGrant, checkCloudJob, linkCloudJob, machineIdentity, requestedScopes, requireGrant, requireRemoteMode, supabaseIdentity, verifiedAccessJwt } from '../src/lib/cloud-access.ts'

const base = {
  CLOUD_TOOLS_ACCESS_MODE: 'supabase',
  CLOUD_TOOLS_ALLOWED_EMAILS: 'owner@example.com, invited@example.com',
  CLOUD_TOOLS_AGENT_TOKEN: 't'.repeat(32), CLOUD_TOOLS_AGENT_ID: 'local-vault',
  CLOUD_TOOLS_AGENT_SCOPES: 'vault.submit,vault.read',
  RABBIT_CLOUDSHELL_URL: 'https://broker.example', RABBIT_CLOUDSHELL_TOKEN: 'b'.repeat(32),
}
const denied = (fn, status) => assert.throws(fn, error => error.status === status)
const identity = { subject: 'email:owner@example.com', scopes: ['shell.execute', 'vault.read'], machine: false }

test('all three modes fail closed, default local-only blocks humans and machines', async () => {
  assert.equal(accessMode({}), 'local-only')
  denied(() => requireRemoteMode({}), 403)
  denied(() => requireRemoteMode({ CLOUD_TOOLS_ACCESS_MODE: 'other' }), 503)
  assert.equal(requireRemoteMode(base), 'supabase')
  assert.equal(requireRemoteMode({ CLOUD_TOOLS_ACCESS_MODE: 'cloudflare-access' }), 'cloudflare-access')
  await assert.rejects(machineIdentity(new Request('https://app.example'), {}), error => error.status === 403)
  denied(() => supabaseIdentity(null, base), 401)
  denied(() => supabaseIdentity({ email: 'owner@example.com' }, base), 401)
  denied(() => supabaseIdentity({ email: 'outsider@example.com', email_confirmed_at: 'today' }, base), 403)
  denied(() => supabaseIdentity({ email: 'owner@example.com', email_confirmed_at: 'today' }, {}), 403)
  assert.equal(supabaseIdentity({ email: 'OWNER@example.com', email_confirmed_at: 'today', user_metadata: { owner: true } }, base).subject, 'email:owner@example.com')
})

test('pending, expired, revoked and scope-crossing grants never authorize', () => {
  const now = 1000
  const approved = { approved: true, scopes: ['shell.execute'], expiresAt: now + 3600_000 }
  requireGrant(approved, identity, 'shell.execute', now)
  for (const grant of [null, { ...approved, approved: false }, { ...approved, expiresAt: now }, { ...approved, expiresAt: now + 3600_001 }, { ...approved, scopes: ['vault.read'] }, { ...approved, subject: 'email:other@example.com' }]) denied(() => requireGrant(grant, identity, 'shell.execute', now), 403)
  denied(() => requireGrant({ ...approved, scopes: ['vault.submit'] }, identity, 'vault.submit', now), 403)
  denied(() => requestedScopes(['shell.execute'], ['vault.read']), 403)
  denied(() => requestedScopes(['vault.read', 'vault.read']), 403)
})

test('grant check sends authenticated subject to authoritative broker every operation', async () => {
  let calls = 0
  const fetcher = async (url, init) => {
    calls++
    assert.equal(url, 'https://broker.example/access/check')
    assert.deepEqual(JSON.parse(init.body), { subject: identity.subject })
    assert.equal('Origin' in init.headers, false)
    return Response.json({ approved: calls === 1, scopes: ['shell.execute'], expiresAt: Date.now() + 3599_000 })
  }
  await checkCloudGrant(identity, 'shell.execute', base, fetcher)
  await assert.rejects(checkCloudGrant(identity, 'shell.execute', base, fetcher), error => error.status === 403)
  assert.equal(calls, 2)
})

test('machine subject/scopes are configuration-derived and browser Origin is always denied', async () => {
  const request = origin => new Request('https://app.example/api/cloud-agent/access/status', {
    headers: { Authorization: `Bearer ${base.CLOUD_TOOLS_AGENT_TOKEN}`, ...(origin === undefined ? {} : { Origin: origin }) },
  })

  assert.deepEqual(await machineIdentity(request(), base), { subject: 'agent:local-vault', scopes: ['vault.read', 'vault.submit'], machine: true })
  for (const origin of ['https://app.example', 'null', '']) await assert.rejects(machineIdentity(request(origin), base), error => error.status === 403)
  await assert.rejects(machineIdentity(new Request('https://app.example'), base), error => error.status === 401)
  await assert.rejects(machineIdentity(request(), { ...base, CLOUD_TOOLS_AGENT_ID: '../other' }), error => error.status === 503)
  await assert.rejects(machineIdentity(request(), { ...base, CLOUD_TOOLS_AGENT_SCOPES: '' }), error => error.status === 403)
})

test('job linkage prevents cross-person/cross-agent IDs and expired grant reads', async () => {
    const jobId = 'a'.repeat(64)
    let linkedSubject
    let expired = false
    const fetcher = async (url, init) => {
      const value = JSON.parse(init.body)
      assert.equal('Origin' in init.headers, false)
      if (url.endsWith('/access/link-job')) {
        linkedSubject = value.subject
        return Response.json({ linked: true, jobId: value.jobId })
      }
      assert.equal(url, 'https://broker.example/access/check-job')
      return Response.json({
        approved: value.subject === linkedSubject && value.jobId === jobId && !expired,
        expiresAt: expired ? Date.now() - 1 : Date.now() + 3599_000,
      })
    }
    await linkCloudJob(identity, jobId, base, fetcher)
    await checkCloudJob(identity, jobId, base, fetcher)
    for (const subject of ['email:invited@example.com', 'agent:local-vault', 'agent:other-agent']) {
      await assert.rejects(checkCloudJob({ ...identity, subject }, jobId, base, fetcher), error => error.status === 403)
    }
    await assert.rejects(checkCloudJob(identity, 'b'.repeat(64), base, fetcher), error => error.status === 403)
    expired = true
    await assert.rejects(checkCloudJob(identity, jobId, base, fetcher), error => error.status === 403)
    await assert.rejects(linkCloudJob(identity, jobId, base, async () => new Response('', { status: 403 })),
      error => error.status === 502 && error.message.includes(jobId) && error.message.includes('not a successful'))
})

test('Access rejects forged/expired/wrong issuer or audience JWTs, validates human and service subjects separately', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'local-test'
  const key = createLocalJWKSet({ keys: [jwk] })
  const config = { ...base, CLOUD_TOOLS_ACCESS_MODE: 'cloudflare-access', CLOUD_TOOLS_ACCESS_ISSUER: 'https://team.cloudflareaccess.com', CLOUD_TOOLS_ACCESS_AUD: 'app-aud', CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME: 'synthetic-service.access' }
  const sign = (claims = {}, signingKey = privateKey) => new SignJWT({ type: 'app', email: 'owner@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test' }).setSubject('service-sub')
    .setIssuer(config.CLOUD_TOOLS_ACCESS_ISSUER).setAudience(config.CLOUD_TOOLS_ACCESS_AUD)
    .setIssuedAt().setExpirationTime('1h').sign(signingKey)
  const valid = await sign()
  const payload = await verifiedAccessJwt(valid, config, key)
  assert.equal(accessHumanIdentity(payload, config).subject, 'email:owner@example.com')
  denied(() => accessHumanIdentity({ ...payload, email: 'not-allowed@example.com' }, config), 403)
  const expired = await new SignJWT({ type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'local-test' })
    .setSubject('service-sub').setIssuer(config.CLOUD_TOOLS_ACCESS_ISSUER).setAudience('app-aud')
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(privateKey)
  const forgedKey = (await generateKeyPair('RS256')).privateKey
  for (const token of [null, 'forged', expired, await sign({}, forgedKey)]) await assert.rejects(verifiedAccessJwt(token, config, key), error => error.status === 401)
  await assert.rejects(verifiedAccessJwt(valid, { ...config, CLOUD_TOOLS_ACCESS_AUD: 'wrong' }, key), error => error.status === 401)
  await assert.rejects(verifiedAccessJwt(valid, { ...config, CLOUD_TOOLS_ACCESS_ISSUER: 'https://other.cloudflareaccess.com' }, key), error => error.status === 401)
  await assert.rejects(verifiedAccessJwt(valid, { ...config, CLOUD_TOOLS_ACCESS_ISSUER: 'https://evil.example' }, key), error => error.status === 503)
  const service = await new SignJWT({ type: 'app', common_name: config.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test' }).setSubject('')
    .setIssuer(config.CLOUD_TOOLS_ACCESS_ISSUER).setAudience(config.CLOUD_TOOLS_ACCESS_AUD)
    .setIssuedAt().setExpirationTime('1h').sign(privateKey)
  const machineRequest = new Request('https://app.example', { headers: { Authorization: `Bearer ${base.CLOUD_TOOLS_AGENT_TOKEN}`, 'Cf-Access-Jwt-Assertion': service } })
  assert.equal((await machineIdentity(machineRequest, config, key)).subject, 'agent:local-vault')
  await assert.rejects(machineIdentity(machineRequest, { ...config, CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME: 'wrong.access' }, key), error => error.status === 403)
  const humanHeaders = new Headers(machineRequest.headers)
  humanHeaders.set('Cf-Access-Jwt-Assertion', valid)
  const humanRequest = new Request(machineRequest, { headers: humanHeaders })
  await assert.rejects(machineIdentity(humanRequest, config, key), error => error.status === 403)
})

test('shared human/machine vault read bridge checks same-grant job authorization before upstream fetch', async () => {
  const source = await readFile(new URL('../src/lib/cloud-job-bff.ts', import.meta.url), 'utf8')
  const check = source.indexOf('await checkCloudJob(identity, id, process.env)')
  const fetch = source.indexOf('await forwardCloud(config, vaultJobPath(id, result))')
  assert.ok(check >= 0 && fetch > check)
  assert.ok(source.includes('result ? validateVaultResult(output, id) : validateVaultResponse(output, id)'))
})
