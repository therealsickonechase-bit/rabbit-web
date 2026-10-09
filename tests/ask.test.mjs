import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAskPrompt, citedIds, keywords, orFilter } from '../src/lib/ask.ts'

test('keywords drops filler words and keeps distinct search terms', () => {
  assert.deepEqual(keywords('What trials are there for BRCA1 and BRCA1 breast cancer?'), ['brca1', 'breast', 'cancer'])
})

test('keywords keeps only letters and digits, so a filter cannot be injected', () => {
  const w = keywords('x,title.eq.1) or (id.neq.0 "; drop table')
  for (const word of w) assert.match(word, /^[a-z0-9]+$/)
  assert.ok(!orFilter('title', w).includes(')'))
})

test('keywords returns at most six terms', () => {
  assert.equal(keywords('alpha bravo charlie delta echo foxtrot golf hotel').length, 6)
})

test('orFilter builds a PostgREST or-list', () => {
  assert.equal(orFilter('title', ['brca1', 'lung']), 'title.ilike.%brca1%,title.ilike.%lung%')
})

test('citedIds returns only ids that were provided and cited', () => {
  const answer = 'BRCA1 is studied [NCT001]. Also [NCT999] and [PMID7].'
  assert.deepEqual(citedIds(answer, ['NCT001', 'PMID7', 'NCT002']), ['NCT001', 'PMID7'])
})

test('the prompt lists records with ids and says when nothing matched', () => {
  const p = buildAskPrompt('q?', [{ id: 'NCT001', source: 'trial', title: 'A trial', meta: { status: 'Recruiting' } }], [])
  assert.match(p, /\[NCT001\] \(trial\) A trial — Recruiting/)
  assert.match(buildAskPrompt('q?', [], []), /\(none matched\)/)
})

test('the prompt includes only the recent conversation and truncates long turns', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn${i} ${'x'.repeat(900)}` }))
  const p = buildAskPrompt('q?', [], history)
  assert.ok(!p.includes('turn3 '))
  assert.ok(p.includes('turn9 '))
  assert.ok(p.length < 6 * 700 + 600)
})
