import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedText, configuredVaultRoots, forwardCloud, ownerCloudApi, readJson, requireWriteOrigin, shellCommand, upstreamConfig, validateVaultResponse, validateVaultResult, vaultJobPath, vaultSnapshot, verifyOwnerIdentity } from '../src/lib/cloud-jobs.ts'
import { createHash } from 'node:crypto'

const shared = '---\ncloud-agent-share: true\n---\nApproved text.'
const snapshot = (notes = [{ path: 'Agents/note.md', content: shared }]) => ({
  mode: 'task', instruction: 'Summarize', notes, consent: true,
})
const denied = (fn, status) => assert.throws(fn, error => error.status === status)

test('only explicit protected routes and methods cross the account-free boundary', () => {
  assert.equal(ownerCloudApi('/api/cloudshell/execute', 'POST'), true)
  assert.equal(ownerCloudApi('/api/vault/jobs', 'POST'), true)
  const id = 'a'.repeat(64)
  assert.equal(ownerCloudApi(`/api/vault/jobs/${id}/result`, 'GET'), true)
  for (const [path, method] of [['/api/cloudshell/execute', 'GET'], ['/api/vault/jobs', 'GET'], [`/api/vault/jobs/${id}/extra`, 'GET'], ['/api/vault/jobs/../other', 'GET'], ['/api/settings', 'POST']]) {
    assert.equal(ownerCloudApi(path, method), false)
  }
})

test('owner identity is a verified user plus exactly true existing owner RPC, never a fallback', () => {
  assert.equal(verifyOwnerIdentity({ id: 'owner' }, null, { data: true, error: null }), 'owner')
  denied(() => verifyOwnerIdentity(null, null, { data: true, error: null }), 401)
  denied(() => verifyOwnerIdentity({ id: 'owner' }, new Error(), { data: true, error: null }), 401)
  denied(() => verifyOwnerIdentity({ id: 'member' }, null, { data: false, error: null }), 403)
  for (const data of [null, undefined, 'true', 1]) denied(() => verifyOwnerIdentity({ id: 'owner' }, null, { data, error: null }), 503)
  denied(() => verifyOwnerIdentity({ id: 'owner' }, null, { data: true, error: new Error() }), 503)
})

test('writes require strict Origin, including rejection of missing/null origin', () => {
  const request = origin => new Request('https://app.example/api/cloudshell/execute', { method: 'POST', headers: { ...(origin === undefined ? {} : { Origin: origin }), 'Content-Type': 'application/json' } })
  requireWriteOrigin(request('https://app.example'))
  for (const origin of [undefined, 'null', 'https://evil.example', 'https://app.example.evil']) denied(() => requireWriteOrigin(request(origin)), 403)
  denied(() => requireWriteOrigin(new Request('https://app.example', { method: 'POST', headers: { Origin: 'https://app.example' } })), 403)
})

test('command consent and UTF-8 byte limits are enforced without altering commands', () => {
  assert.deepEqual(shellCommand({ command: 'echo hello', consent: true }), { command: 'echo hello', consent: true })
  shellCommand({ command: 'é'.repeat(2000), consent: true })
  for (const value of [{ command: 'ls' }, { command: 'ls', consent: false }, { command: ' ', consent: true }, { command: 'ls', consent: true, userId: 'other' }, { command: 'é'.repeat(2001), consent: true }, { command: 'a\0b', consent: true }]) denied(() => shellCommand(value), 400)
})

test('vault snapshots strip consent, check exact share flag, roots, path and count', () => {
  const output = vaultSnapshot(snapshot(), ['Agents/'])
  assert.equal('consent' in output, false)
  assert.deepEqual(output.notes, snapshot().notes)
  denied(() => vaultSnapshot(snapshot(), []), 503)
  for (const path of ['Private/note.md', 'Agents-other/note.md', 'Agents/../note.md', '/Agents/note.md', 'Agents\\note.md', 'Agents/note.txt', 'Agents//note.md']) denied(() => vaultSnapshot(snapshot([{ path, content: shared }]), ['Agents/']), 400)
  for (const content of ['private', '---\ncloud-agent-share: false\n---', '---\ncloud-agent-share: "true"\n---', '---\ncloud-agent-share: true\ncloud-agent-share: false\n---', '---\ncloud-agent-share: true # comment\n---', '---\n nested:\n  cloud-agent-share: true\n---']) denied(() => vaultSnapshot(snapshot([{ path: 'Agents/note.md', content }]), ['Agents/']), 400)
  vaultSnapshot(snapshot([{ path: 'Agents/note.md', content: '---\r\ncloud-agent-share: true  \r\n---\r\ntext' }]), ['Agents/'])
  denied(() => vaultSnapshot({ ...snapshot(), consent: false }, ['Agents/']), 400)
  denied(() => vaultSnapshot({ ...snapshot(), extra: 'secret' }, ['Agents/']), 400)
  denied(() => vaultSnapshot({ ...snapshot(), mode: ['task'] }, ['Agents/']), 400)
  denied(() => vaultSnapshot(snapshot(Array.from({ length: 41 }, (_, i) => ({ path: `Agents/${i}.md`, content: shared }))), ['Agents/']), 400)
  denied(() => vaultSnapshot(snapshot([snapshot().notes[0], snapshot().notes[0]]), ['Agents/']), 400)
})

test('vault bounds actual serialized bytes including JSON escaping', () => {
  denied(() => vaultSnapshot(snapshot([{ path: 'Agents/a.md', content: shared + 'é'.repeat(8000) }]), ['Agents/']), 400)
  const notes = Array.from({ length: 5 }, (_, i) => ({ path: `Agents/${i}.md`, content: shared + '\\'.repeat(7000) }))
  denied(() => vaultSnapshot(snapshot(notes), ['Agents/']), 413)
})

test('bounded request and response readers count streamed bytes', async () => {
  await assert.rejects(readJson(new Request('https://app.example', { method: 'POST', body: JSON.stringify({ x: 'é'.repeat(10) }) }), 10), error => error.status === 413)
  await assert.rejects(boundedText(new Response('a'.repeat(11)).body, 10), error => error.status === 413)
  assert.equal(await boundedText(new Response('é').body, 2), 'é')
})

test('upstream configuration is server controlled HTTPS and redirects are disabled', async () => {
  denied(() => upstreamConfig(undefined, undefined), 503)
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com?token=x', 'https://example.com#x']) denied(() => upstreamConfig(url, 'secret'), 503)
  const config = upstreamConfig('https://worker.example', 'server-secret')
  const data = await forwardCloud(config, '/execute', { command: 'true', consent: true }, async (url, init) => {
    assert.equal(url, 'https://worker.example/execute')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.headers.Authorization, 'Bearer server-secret')
    assert.equal('Origin' in init.headers, false)
    assert.equal('Cookie' in init.headers, false)
    assert.equal(init.cache, 'no-store')
    assert.equal(init.signal instanceof AbortSignal, true)
    return Response.json({ stdout: '', stderr: '', exitCode: 0 })
  })
  assert.equal(data.exitCode, 0)
  await assert.rejects(forwardCloud(config, '/jobs/' + 'a'.repeat(64), undefined, async (_url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined)
    return new Response('contains secret', { status: 403 })
  }), error => error.status === 502 && !error.message.includes('secret'))
  await assert.rejects(forwardCloud(config, '/execute', {}, async () => new Response('x'.repeat(262145))), error => error.status === 413)
  for (const status of [409, 429, 503]) await assert.rejects(forwardCloud(config, '/execute', {}, async () => new Response('private upstream message', { status })), error => error.status === status && !error.message.includes('private'))
  let redirects = 0
  await assert.rejects(forwardCloud(config, '/access/check', {}, async (_url, init) => {
    redirects++
    assert.equal(init.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } })
  }), error => error.status === 502)
  assert.equal(redirects, 1)
})

test('configured roots are exact upstream subsets and invalid mixed configuration fails closed', () => {
  assert.deepEqual(configuredVaultRoots('Agents/, Workers/'), ['Agents/', 'Workers/'])
  for (const roots of [undefined, '', 'Agents', 'Private/', 'Agents/,Private/', 'Agents/Sub/', 'Cloud Agents/Results/']) assert.deepEqual(configuredVaultRoots(roots), [])
  denied(() => vaultSnapshot(snapshot(), ['Private/']), 503)
  denied(() => vaultSnapshot(snapshot(), ['Workers/']), 400)
})

test('vault instruction, credential and Windows path parity is enforced', () => {
  vaultSnapshot({ ...snapshot(), instruction: 'x'.repeat(4000) }, ['Agents/'])
  denied(() => vaultSnapshot({ ...snapshot(), instruction: 'x'.repeat(4001) }, ['Agents/']), 400)
  denied(() => vaultSnapshot({ ...snapshot(), instruction: 'é'.repeat(2001) }, ['Agents/']), 400)
  for (const credential of ['-----BEGIN RSA PRIVATE KEY-----', 'ghp_' + 'a'.repeat(20), 'github_pat_' + 'a'.repeat(20), 'AKIA' + 'A'.repeat(16)]) {
    denied(() => vaultSnapshot(snapshot([{ path: 'Agents/note.md', content: shared + credential }]), ['Agents/']), 400)
  }
  for (const path of ['Agents/.hidden/a.md', 'Agents/folder./a.md', 'Agents/folder /a.md', 'Agents/CON.md', 'Agents/com0.md', 'Agents/lpt9.txt/a.md', 'Agents/a?.md', 'Agents/a*.md', 'Agents/a|b.md', 'Agents/a<b.md', 'Agents/a>b.md', 'Agents/a"b.md']) denied(() => vaultSnapshot(snapshot([{ path, content: shared }]), ['Agents/']), 400)
  const path240 = 'Agents/' + 'a'.repeat(230) + '.md'
  assert.equal(path240.length, 240)
  vaultSnapshot(snapshot([{ path: path240, content: shared }]), ['Agents/'])
  denied(() => vaultSnapshot(snapshot([{ path: path240 + '.md', content: shared }]), ['Agents/']), 400)
  denied(() => vaultSnapshot(snapshot([{ path: 'Agents/a.md', content: shared }, { path: 'Agents/A.md', content: shared }]), ['Agents/']), 400)
  denied(() => vaultSnapshot(snapshot([{ path: 'Agents/a.md', content: shared + '\0' }]), ['Agents/']), 400)
})

test('normalized snapshots have deterministic serialization and hash regardless of input order', () => {
  const notes = [{ path: 'Agents/z.md', content: shared }, { path: 'Agents/a.md', content: shared }]
  const first = vaultSnapshot({ ...snapshot(notes), instruction: '  Summarize \n' }, ['Agents/'])
  const second = vaultSnapshot(snapshot([...notes].reverse()), ['Agents/'])
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  assert.deepEqual(first, second)
  assert.equal(hash(first), hash(second))
  assert.deepEqual(first.notes.map(note => note.path), ['Agents/a.md', 'Agents/z.md'])
})

test('vault upstream submit/status/result URLs use /jobs while browser paths stay unchanged', async () => {
  const id = 'b'.repeat(64)
  const config = upstreamConfig('https://vault.example', 'server-secret')
  for (const [path, payload, method] of [
    [vaultJobPath(), { mode: 'task' }, 'POST'],
    [vaultJobPath(id), undefined, 'GET'],
    [vaultJobPath(id, true), undefined, 'GET'],
  ]) {
    await forwardCloud(config, path, payload, async (url, init) => {
      assert.equal(url, `https://vault.example${method === 'POST' ? '/jobs' : path}`)
      assert.equal(init.method, method)
      assert.equal(url.includes('/vault/jobs'), false)
      return Response.json({ id })
    })
  }
  assert.equal(vaultJobPath(), '/jobs')
  assert.equal(vaultJobPath(id), `/jobs/${id}`)
  assert.equal(vaultJobPath(id, true), `/jobs/${id}/result`)
  assert.equal(ownerCloudApi(`/api/vault/jobs/${id}`, 'GET'), true)
  assert.equal(validateVaultResponse({ id }, id).id, id)
  for (const value of [null, [], 'text', {}, { id: 'bad' }, { id: 'a'.repeat(64) }]) denied(() => validateVaultResponse(value, id), 502)
})

test('vault results require matching id and mode/answer/edits output shape', () => {
  const id = 'c'.repeat(64)
  const valid = { id, mode: 'task', answer: 'Proposal only', edits: [] }
  assert.deepEqual(validateVaultResult(valid, id), valid)
  for (const value of [
    { mode: 'task', answer: '', edits: [] }, { ...valid, id: 'd'.repeat(64) },
    { ...valid, mode: 'other' }, { ...valid, answer: null }, { ...valid, edits: null },
    { ...valid, edits: ['not an edit object'] }, { ...valid, edits: [null] },
  ]) denied(() => validateVaultResult(value, id), 502)
})
