import assert from 'node:assert/strict'
import test from 'node:test'
import { legacyRedirect, machineApi, pageMethodAllowed, publicApiAllowed, workspaceSection } from '../src/lib/account-free.ts'
import { emptyWorkspace, publicLink, readWorkspace, researchContext } from '../src/lib/workspace.ts'

test('all workspace sections are explicit and never include account administration', () => {
  for (const name of ['dashboard', 'ask', 'brain', 'research', 'settings', 'memory', 'collections', 'tasks']) assert.equal(workspaceSection(name), name)
  for (const name of ['members', 'keys', 'guests', '../members', 'research/private']) assert.equal(workspaceSection(name), null)
})

test('account APIs and writes stay disabled', () => {
  for (const path of ['/api/settings', '/api/keys', '/api/members', '/api/auth/send-email', '/api/packages/upload']) {
    for (const method of ['GET', 'POST', 'DELETE']) assert.equal(publicApiAllowed(path, method), false)
    assert.equal(machineApi(path), false)
  }
  assert.equal(publicApiAllowed('/api/public/research-feed', 'GET'), true)
  assert.equal(publicApiAllowed('/api/public/research-feed', 'POST'), false)
  assert.equal(publicApiAllowed('/api/chain/restore', 'POST'), true)
  assert.equal(publicApiAllowed('/api/chain/restore', 'GET'), false)
  assert.equal(publicApiAllowed('/api/chain/import', 'POST'), false)
  assert.equal(publicApiAllowed('/api/avatar/ask', 'POST'), true)
  assert.equal(publicApiAllowed('/api/avatar/ask', 'GET'), false)
  assert.equal(machineApi('/api/ingest'), true)
  assert.equal(machineApi('/api/agent/heartbeat'), true)
  assert.equal(machineApi('/api/agents'), false)
})

test('browser workspace round-trips with no account id or credentials', () => {
  const value = emptyWorkspace()
  value.messages.push({ role: 'user', text: 'Hello' })
  value.items.push({ id: 'one', kind: 'note', text: 'Local only', done: false })
  assert.deepEqual(readWorkspace(JSON.stringify(value)), value)
  assert.deepEqual(readWorkspace(null), emptyWorkspace())
  assert.throws(() => readWorkspace('{broken'))
  assert.throws(() => readWorkspace(JSON.stringify({ ...value, user_id: 'owner' })))
  assert.throws(() => readWorkspace('x'.repeat(2000001)))
})

test('a maximum-sized valid workspace can be reloaded after saving', () => {
  const value = emptyWorkspace()
  value.messages = Array.from({ length: 100 }, () => ({ role: 'assistant', text: 'x'.repeat(12000) }))
  value.items = Array.from({ length: 100 }, (_, index) => ({ id: String(index), kind: 'note', text: 'x'.repeat(4000), done: false }))
  assert.deepEqual(readWorkspace(JSON.stringify(value)), value)
})

test('research pointers reject executable URLs and bound supplied context', () => {
  assert.equal(publicLink('javascript:alert(1)'), null)
  assert.equal(publicLink('https://pubmed.ncbi.nlm.nih.gov/1/'), 'https://pubmed.ncbi.nlm.nih.gov/1/')
  const feed = { recent: Array.from({ length: 20 }, (_, index) => ({ title: `BRCA1 ${index}`, source: 'pubmed', url: 'javascript:alert(1)' })) }
  const context = researchContext(feed, 'BRCA1')
  assert.equal(context.split('\n').length, 4)
  assert.equal(context.includes('javascript:'), false)
})

test('the three formerly owner-only routes are open, with only the methods they implement', () => {
  assert.equal(publicApiAllowed('/api/brain/live', 'GET'), true)
  assert.equal(publicApiAllowed('/api/brain/live', 'POST'), false)
  assert.equal(publicApiAllowed('/api/brain/illustrate', 'POST'), true)
  assert.equal(publicApiAllowed('/api/brain/illustrate', 'GET'), false)
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal(publicApiAllowed('/api/self/daily', method), true)
  assert.equal(publicApiAllowed('/api/self/daily', 'PUT'), false)
  assert.equal(publicApiAllowed('/api/__proto__', 'GET'), false)
})

test('server actions (POST) are allowed on app pages only, never on legacy account paths', () => {
  for (const path of ['/ask', '/tasks', '/collections', '/research', '/memory', '/connections']) assert.equal(pageMethodAllowed(path, 'POST'), true)
  for (const path of ['/login', '/signup', '/keys', '/members', '/guests', '/settings', '/auth/confirm', '/downloads', '/']) assert.equal(pageMethodAllowed(path, 'POST'), false)
  assert.equal(pageMethodAllowed('/ask', 'DELETE'), false)
  assert.equal(pageMethodAllowed('/anything', 'GET'), true)
  for (const path of ['/login', '/signup', '/guest', '/members', '/guests', '/keys', '/auth/confirm']) assert.equal(legacyRedirect(path), true)
  assert.equal(legacyRedirect('/dashboard'), false)
})
