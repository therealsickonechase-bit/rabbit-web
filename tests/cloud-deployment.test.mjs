import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { accessApplication, cloudConsolePolicies, cloudDeployment, ownerConsoles } from '../src/lib/cloud-deployment.ts'
import { deploymentInputs } from '../scripts/deploy-cloud-console.mjs'

test('Access deployment trusts the renamed team domain and preserves the application audience', () => {
  assert.equal(accessApplication.CLOUD_TOOLS_ACCESS_ISSUER, 'https://rsi-helloworld.cloudflareaccess.com')
  assert.equal(accessApplication.CLOUD_TOOLS_ACCESS_AUD, 'c54bc88d3c2d9dacfda3c613f4c8c029a5c0220263524fd4f0fde66968e6581a')
})

test('main/default and two distinct deployments have fixed non-browser auth policies', () => {
  for (const mode of [undefined, 'production', 'development', 'local-primary']) {
    assert.deepEqual(cloudDeployment(mode), { name: 'rabbit-web', accessMode: 'local-only', isolated: false })
  }
  assert.deepEqual(cloudDeployment('cloud-supabase'), { name: 'rabbit-web-cloud-supabase', accessMode: 'supabase', isolated: true })
  assert.deepEqual(cloudDeployment('cloud-access'), { name: 'rabbit-web-cloud-access', accessMode: 'cloudflare-access', isolated: true })
  for (const mode of ['preview', 'cloud-supabse', 'supabase', 'cloudflare-access']) assert.throws(() => cloudDeployment(mode))
  assert.notEqual(cloudConsolePolicies.supabase, cloudConsolePolicies['cloudflare-access'])
  assert.equal(cloudConsolePolicies.supabase.CLOUD_TOOLS_ALLOWED_EMAILS, 'ringquistchase@gmail.com')
  assert.equal(cloudConsolePolicies['cloudflare-access'].CLOUD_TOOLS_ALLOWED_EMAILS, 'ringquistchase@gmail.com')
  for (const policy of Object.values(cloudConsolePolicies)) {
    assert.equal(policy.CLOUD_TOOLS_AGENT_ID, 'local-vault-agent')
    assert.equal(policy.CLOUD_TOOLS_AGENT_SCOPES, 'shell.execute,vault.submit,vault.read')
    assert.equal(policy.RABBIT_CLOUDSHELL_URL, 'https://rabbitsoftware-cloudshell.rabbitsoftware-gateway.workers.dev')
  }
})

test('owner console links point at the two isolated Workers over HTTPS, one per remote mode', () => {
  assert.deepEqual(ownerConsoles.map(item => item.accessMode), ['supabase', 'cloudflare-access'])
  for (const item of ownerConsoles) {
    const url = new URL(item.url)
    assert.equal(url.protocol, 'https:')
    assert.equal(url.host, `${cloudDeployment(item.accessMode === 'supabase' ? 'cloud-supabase' : 'cloud-access').name}.rabbitsoftware-gateway.workers.dev`)
    assert.equal(url.search + url.hash, '')
  }
})

test('deployment transfers only caller/backend/note credentials and refuses unapproved providers or invalid origins', () => {
  const publicConfig = { NEXT_PUBLIC_SUPABASE_URL: 'https://public-synthetic.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-synthetic-publishable' }
  const shell = { RABBIT_CLOUDSHELL_TOKEN: 'public-synthetic-backend'.padEnd(40, 'x'), RABBIT_AGENT_APPROVAL_TOKEN: 'must-not-transfer' }
  const provider = { type: 'cloudflare-jobs', allowRemote: true, url: 'https://note.example', token: 'public-synthetic-note'.padEnd(40, 'x') }
  const agent = 'public-synthetic-caller'.padEnd(40, 'x')
  const result = deploymentInputs('cloud-supabase', publicConfig, shell, provider, agent)
  assert.deepEqual(Object.keys(result.secrets).sort(), ['CLOUD_TOOLS_AGENT_TOKEN', 'RABBIT_CLOUDSHELL_TOKEN', 'VAULT_AGENT_TOKEN'])
  assert.equal(result.env.VAULT_AGENT_URL, provider.url)
  const access = deploymentInputs('cloud-access', { ...publicConfig, CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME: 'synthetic-service.access' }, shell, provider, agent)
  assert.equal(access.env.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME, 'synthetic-service.access')
  assert.deepEqual(Object.keys(access.secrets).sort(), Object.keys(result.secrets).sort())
  assert.throws(() => deploymentInputs('cloud-access', publicConfig, shell, provider, agent), /exact Access service Client ID/)
  assert.throws(() => deploymentInputs('local-primary', publicConfig, shell, provider, agent))
  assert.throws(() => deploymentInputs('cloud-supabase', publicConfig, shell, undefined, agent), /authorized cloud note provider/)
  assert.throws(() => deploymentInputs('cloud-supabase', publicConfig, shell, { ...provider, allowRemote: false }, agent))
  assert.throws(() => deploymentInputs('cloud-supabase', publicConfig, shell, { ...provider, url: 'http://note.example' }, agent))
})

test('isolated cloud configs do not inherit main secrets or production data/service bindings', async () => {
  const source = await readFile(new URL('../cloudflare.config.ts', import.meta.url), 'utf8')
  const isolated = source.slice(source.indexOf('if (target.isolated)'), source.indexOf('name: target.name', source.indexOf('name: target.name') + 1))
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'INGEST_SHARED_SECRET', 'KEY_ENCRYPTION_SECRET', 'SEND_EMAIL_HOOK_SECRET', 'CONTACT_HASH_KEY', 'bindings.ai()', 'bindings.sendEmail(']) assert.equal(isolated.includes(name), false)
  for (const name of ['CLOUD_TOOLS_AGENT_TOKEN', 'RABBIT_CLOUDSHELL_TOKEN', 'VAULT_AGENT_TOKEN']) assert.ok(isolated.includes(`${name}: bindings.secret()`))
  assert.equal(source.includes('RABBIT_AGENT_APPROVAL_TOKEN'), false)
  assert.ok(isolated.includes('"global_fetch_strictly_public"'))
  assert.ok(source.includes('CLOUD_TOOLS_ACCESS_MODE: bindings.text("local-only")'))
})
