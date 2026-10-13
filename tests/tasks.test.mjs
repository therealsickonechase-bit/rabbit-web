import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRequestSchema, checkProposal, parseTaskParams } from '../src/lib/tasks.ts'

test('task parameters are validated per kind', () => {
  assert.equal(parseTaskParams('research_topic', { topic: 'breast cancer', biomarker: 'PARP1' }).ok, true)
  assert.equal(parseTaskParams('crispr_guides', { gene: 'BRCA1' }).params.top, 5)
  assert.equal(parseTaskParams('brain_search', { query: 'EEG alpha dopamine' }).ok, true)
})

test('bad kinds, genes, characters and extra fields are refused', () => {
  assert.equal(parseTaskParams('delete_everything', {}).ok, false)
  assert.equal(parseTaskParams('crispr_guides', { gene: 'TP53; DROP' }).ok, false)
  assert.equal(parseTaskParams('crispr_guides', { gene: 'BRCA1', top: 99 }).ok, false)
  assert.equal(parseTaskParams('research_topic', { topic: '<script>alert(1)</script>' }).ok, false)
  assert.equal(parseTaskParams('research_topic', { topic: 'ok topic', extra: 1 }).ok, false)
  assert.equal(parseTaskParams('brain_search', { query: 'a' }).ok, false)
})

const rec = (o = {}) => ({ id: 'pubmed:1', source: 'pubmed', title: 'A paper', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', meta: {}, ...o })

test('a proposal may only contain sources allowed for that task', () => {
  assert.equal(checkProposal('research_topic', { summary: 's', records: [rec()] }).ok, true)
  assert.equal(checkProposal('research_topic', { summary: 's', records: [rec({ source: 'clinvar' })] }).ok, false)
  assert.equal(checkProposal('crispr_guides', { summary: 's', records: [rec()] }).ok, false)
})

test('proposals reject non-http links, duplicate ids and oversize batches', () => {
  assert.equal(checkProposal('research_topic', { summary: 's', records: [rec({ url: 'javascript:alert(1)' })] }).ok, false)
  assert.equal(checkProposal('research_topic', { summary: 's', records: [rec(), rec()] }).ok, false)
  const many = Array.from({ length: 51 }, (_, i) => rec({ id: `pubmed:${i}` }))
  assert.equal(checkProposal('research_topic', { summary: 's', records: many }).ok, false)
  assert.equal(checkProposal('research_topic', { records: [] }).ok, false)
})

test('agent requests are one of claim, submit or fail', () => {
  assert.equal(agentRequestSchema.safeParse({ action: 'claim', agent: { node_id: 'a' } }).data.lease_seconds, 600)
  assert.equal(agentRequestSchema.safeParse({ action: 'submit', agent: { node_id: 'a' }, task_id: 'nope', result: {} }).success, false)
  assert.equal(agentRequestSchema.safeParse({ action: 'drop', agent: { node_id: 'a' } }).success, false)
})

test('proposal links require a parseable absolute HTTP URL, not just a prefix', () => {
  for (const url of ['https://', 'http://', 'http:example.org', 'https:/example.org', 'https://exa mple.org/paper', 'https://[invalid]/paper']) {
    const result = checkProposal('research_topic', { summary: 's', records: [rec({ url })] })
    assert.equal(result.ok, false, url)
    assert.ok(result.error.length > 0)
  }
  for (const url of ['https://example.org/paper?q=EEG#results', 'HTTPS://example.org/paper', 'http://localhost:8788/paper', null, undefined]) {
    assert.equal(checkProposal('research_topic', { summary: 's', records: [rec({ url })] }).ok, true)
  }
})
