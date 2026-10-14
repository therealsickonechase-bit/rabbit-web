import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { QUICK_START, cleanKeys, helloFrame, inputChunks, protocols, sessionError, shellBase, wsUrl } from '../src/lib/public-shell.ts'
import { appPage } from '../src/lib/open-access.ts'
import { pageMethodAllowed, publicApiAllowed } from '../src/lib/account-free.ts'

test('shell origin must be https (or local http) and is reduced to its origin', () => {
  assert.equal(shellBase('https://shell.rabbitsoftware.io/path?x=1'), 'https://shell.rabbitsoftware.io')
  assert.equal(shellBase('http://localhost:8807'), 'http://localhost:8807')
  for (const bad of [undefined, null, '', 'not a url', 'http://shell.rabbitsoftware.io', 'javascript:alert(1)', 'ftp://x.example']) assert.equal(shellBase(bad), null)
  assert.equal(wsUrl('https://shell.rabbitsoftware.io'), 'wss://shell.rabbitsoftware.io/ws')
  assert.equal(wsUrl('http://localhost:8807'), 'ws://localhost:8807/ws')
})

test('the session token travels as a subprotocol, never in the URL', () => {
  assert.deepEqual(protocols('tok.en'), ['rabbit-shell.v1', 'tok.en'])
  assert.ok(!wsUrl('https://s.example').includes('tok'))
})

test('only the three API-key names are kept; bad values are refused and keys appear only in the hello frame', () => {
  const ok = cleanKeys({ ANTHROPIC_API_KEY: ' sk-ant-synthetic-0001 ', GEMINI_API_KEY: '', PATH: '/tmp', SUPABASE_SERVICE_ROLE_KEY: 'sk-synthetic-leak-1' })
  assert.deepEqual(ok, { keys: { ANTHROPIC_API_KEY: 'sk-ant-synthetic-0001' }, error: null })
  assert.ok(cleanKeys({ ANTHROPIC_API_KEY: 'has space 12345' }).error)
  assert.ok(cleanKeys({ GEMINI_API_KEY: 'short' }).error)
  assert.deepEqual(JSON.parse(helloFrame(80, 24, ok.keys)), { t: 'hello', cols: 80, rows: 24, keys: { ANTHROPIC_API_KEY: 'sk-ant-synthetic-0001' } })
})

test('large input is split under the Worker frame limit', () => {
  const chunks = inputChunks('x'.repeat(10_000))
  assert.deepEqual(chunks.map((c) => c.length), [4096, 4096, 1808])
  assert.ok(chunks.every((c) => new TextEncoder().encode(JSON.stringify({ t: 'i', d: c })).length < 16 * 1024))
})

test('quick-start buttons only type fixed local commands; errors are readable', () => {
  assert.deepEqual(QUICK_START.map((q) => q.command), ['gemini', 'claude', 'copilot', 'ledger', 'repos'])
  assert.equal(sessionError(503), 'The public sandbox is switched off right now.')
  assert.equal(sessionError(429, 'You already have a live sandbox.'), 'You already have a live sandbox.')
})

test('the page is open and no new API route is opened; the owner shell stays closed', () => {
  assert.equal(appPage('/cloudshell-public'), 'cloudshell-public')
  assert.equal(appPage('/cloudshell'), null)
  assert.equal(pageMethodAllowed('/cloudshell', 'POST'), false)
  assert.equal(publicApiAllowed('/api/cloud-agent/shell', 'POST'), false)
  assert.equal(publicApiAllowed('/api/public-shell', 'POST'), false)
})

test('the page never writes keys to localStorage or the server', () => {
  const page = readFileSync(new URL('../src/components/PublicShell.tsx', import.meta.url), 'utf8')
  assert.ok(!/localStorage/.test(page))
  assert.ok(!/console\.(log|info|warn|error)\([^)]*[kK]ey/.test(page))
})
