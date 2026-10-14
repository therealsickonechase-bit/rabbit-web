import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CLI_PACKAGES, run } from '../scripts/verify-ai-providers.mjs'
import { findEntry } from '../src/lib/command-catalog.ts'

const G = 'AIzaSyFAKEKEYFORTESTING0123456789abcdef'
const A = 'sk-ant-fake-key-for-testing-0123456789'
const C = 'github_pat_fake_token_for_testing_0123456789'
const okView = () => ({ ok: true, version: '1.2.3' })

function router(table) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    const hit = table.find(([prefix]) => url.startsWith(prefix))
    const [, status, json] = hit ?? ['', 500, {}]
    return { ok: status < 300, status, json: async () => json }
  }
  fn.calls = calls
  return fn
}

test('with no keys only the npm checks run and nothing touches the network', async () => {
  const fetcher = async () => { throw new Error('network must not be used') }
  const lines = []
  const out = await run({ env: {}, fetcher, view: okView, print: (l) => lines.push(l) })
  assert.deepEqual(out.map((r) => r.status), ['SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED', 'PASS', 'PASS', 'PASS'])
  assert.deepEqual(out.filter((r) => r.name.startsWith('npm ')).map((r) => r.name), CLI_PACKAGES.map((p) => `npm ${p}`))
  assert.equal(lines.length, out.length)
})

test('all providers pass with the right requests, and no key is ever printed', async () => {
  const fetcher = router([
    ['https://generativelanguage.googleapis.com/v1beta/models?', 200, { models: [{ name: 'models/gemini-x-flash', supportedGenerationMethods: ['generateContent'] }] }],
    ['https://generativelanguage.googleapis.com/v1beta/models/gemini-x-flash:generateContent', 200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }],
    ['https://api.anthropic.com/v1/messages', 200, { content: [{ type: 'text', text: 'OK' }] }],
    ['https://api.github.com/user', 200, { login: 'someone' }],
  ])
  const lines = []
  const out = await run({ env: { GEMINI_API_KEY: G, ANTHROPIC_API_KEY: A, COPILOT_GITHUB_TOKEN: C }, fetcher, view: okView, print: (l) => lines.push(l) })
  assert.ok(out.every((r) => r.status === 'PASS'), JSON.stringify(out))
  const text = lines.join('\n') + JSON.stringify(out)
  for (const secret of [G, A, C]) assert.ok(!text.includes(secret))
  const claude = fetcher.calls.find((c) => c.url.includes('anthropic'))
  assert.equal(claude.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(claude.init.headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.equal(JSON.parse(claude.init.body).max_tokens, 16)
  const gen = fetcher.calls.find((c) => c.url.endsWith(':generateContent'))
  assert.equal(gen.init.headers['x-goog-api-key'], G)
})

test('failures are reported by status only, never with a body or key, and 403/404 on models.list fail', async () => {
  for (const status of [403, 404]) {
    const fetcher = router([['https://generativelanguage.googleapis.com', status, { error: { message: `bad key ${G}` } }]])
    const lines = []
    const out = await run({ env: { GEMINI_API_KEY: G }, fetcher, view: () => ({ ok: false, error: 'npm view failed' }), print: (l) => lines.push(l) })
    assert.equal(out[0].status, 'FAIL'); assert.equal(out[1].status, 'SKIPPED')
    assert.ok(out.filter((r) => r.name.startsWith('npm ')).every((r) => r.status === 'FAIL'))
    assert.ok(!lines.join('\n').includes(G))
  }
  const out = await run({ env: { ANTHROPIC_API_KEY: A, COPILOT_GITHUB_TOKEN: C }, fetcher: router([]), skipNpm: true, print: () => {} })
  assert.deepEqual(out.map((r) => r.status).slice(0, 4), ['SKIPPED', 'SKIPPED', 'FAIL', 'FAIL'])
})

test('verify:ai is wired: npm script, catalog entry (owner, network, names only)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['verify:ai'], 'node scripts/verify-ai-providers.mjs')
  assert.match(pkg.scripts['test:auth'], /tests\/verify-ai\.test\.mjs/)
  const e = findEntry('web-verify-ai')
  assert.equal(e.scope, 'owner'); assert.equal(e.risk, 'network'); assert.equal(e.command, 'npm run verify:ai')
  assert.deepEqual(e.needs, ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'COPILOT_GITHUB_TOKEN'])
})
