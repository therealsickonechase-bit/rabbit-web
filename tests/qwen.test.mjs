import assert from 'node:assert/strict'
import test from 'node:test'
import { askQwen, QwenError, QWEN_ENDPOINT } from '../src/lib/qwen.ts'

test('Qwen sends only approved prompt and system to a fixed gateway', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args)
    return Response.json({ choices: [{ message: { content: 'A source-backed answer.' } }] })
  })
  assert.equal(await askQwen('Question', 'Research instructions'), 'A source-backed answer.')
  assert.equal(calls[0][0], QWEN_ENDPOINT)
  assert.equal(calls[0][1].redirect, 'error')
  assert.equal(calls[0][1].headers.Origin, 'https://app.rabbitsoftware.io')
  assert.deepEqual(JSON.parse(calls[0][1].body).messages, [
    { role: 'system', content: 'Research instructions' }, { role: 'user', content: 'Question' },
  ])
})

test('quota rejection and empty replies fail explicitly without other-provider requests', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ error: 'Daily limit reached.' }, { status: 429 })
  })
  await assert.rejects(askQwen('Question', 'System'), error => error instanceof QwenError && error.status === 429)
  assert.equal(calls, 1)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [] }))
  await assert.rejects(askQwen('Question', 'System'), /no answer/)
})
