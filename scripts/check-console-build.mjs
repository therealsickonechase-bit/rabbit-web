import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { cloudDeployment } from '../src/lib/cloud-deployment.ts'

const mode = process.argv[2]
const target = cloudDeployment(mode)
const root = new URL('../.cloudflare/output/v0/', import.meta.url)
const context = JSON.parse(await readFile(new URL('config.json', root), 'utf8'))
const worker = JSON.parse(await readFile(new URL('workers/default/worker.config.json', root), 'utf8'))
assert.equal(context.buildContext.mode, mode)
assert.equal(worker.name, target.name)
assert.deepEqual(worker.env.CLOUD_TOOLS_ACCESS_MODE, { type: 'text', value: target.accessMode })
if (target.isolated) {
  assert.equal(context.accountId, 'f78fa7ea6c63f95d9512053554416e32')
  assert.equal(worker.workersDev, true)
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'AI', 'EMAIL', 'INGEST_SHARED_SECRET', 'RABBIT_AGENT_APPROVAL_TOKEN']) {
    assert.equal(name in worker.env, false)
  }
  for (const name of ['CLOUD_TOOLS_AGENT_TOKEN', 'RABBIT_CLOUDSHELL_TOKEN', 'VAULT_AGENT_TOKEN']) {
    assert.equal(worker.env[name].type, 'secret')
  }
}
console.log(`Verified built console target ${target.name}: ${target.accessMode}; no deployment performed.`)
