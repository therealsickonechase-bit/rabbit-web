import assert from 'node:assert/strict'
import test from 'node:test'
import { PUBLIC_SOURCES, corsHeaders } from '../src/lib/public-feed.ts'

test('only rabbitsoftware.io may read the feed from a browser', () => {
  assert.equal(corsHeaders('https://rabbitsoftware.io')['Access-Control-Allow-Origin'], 'https://rabbitsoftware.io')
  assert.equal(corsHeaders('https://www.rabbitsoftware.io')['Access-Control-Allow-Origin'], 'https://www.rabbitsoftware.io')
  for (const o of ['https://evil.example', 'http://rabbitsoftware.io', 'https://rabbitsoftware.io.evil.example', null]) {
    assert.equal(corsHeaders(o)['Access-Control-Allow-Origin'], undefined, String(o))
  }
})

test('the feed never exposes private data sources', () => {
  for (const s of ['crispr_guide', 'topic_summary', 'chat', 'notes', 'twin']) assert.ok(!PUBLIC_SOURCES.includes(s), s)
  assert.ok(PUBLIC_SOURCES.includes('clinvar') && PUBLIC_SOURCES.includes('crispr_paper'))
})
