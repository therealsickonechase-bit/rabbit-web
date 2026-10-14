import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_LABEL, AGENT_PROVIDERS, AGENT_TERMINALS, COPILOT_API_NOTE, apiProviderFor, checkProviderConfig, completeWithProvider, fetchGeminiModels,
  initialMessages, listModelsRequest, modelListError, normalizeDefaultAgent, parseModelList, readDefaultAgent, writeDefaultAgent,
} from '../src/lib/coding-assistant.ts'

const KEY = 'AIzaSyFAKEKEYFORTESTING0123456789abcdef'

function fakeFetch(status, json) {
  const calls = []
  const fn = async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => json } }
  fn.calls = calls
  return fn
}

test('Gemini generate contract: exact URL, method, headers and body; reply parsed', async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }, { text: 'x' }] } }] })
  const msgs = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }]
  const out = await completeWithProvider({ provider: 'gemini', apiKey: ` ${KEY} `, model: 'some-model' }, msgs, f)
  assert.equal(out, '{"a":1}x')
  const { url, init } = f.calls[0]
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/some-model:generateContent')
  assert.equal(init.method, 'POST')
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', 'x-goog-api-key': KEY })
  assert.deepEqual(JSON.parse(init.body), {
    systemInstruction: { parts: [{ text: 'SYS' }] },
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }, { role: 'model', parts: [{ text: 'yo' }] }],
    generationConfig: { responseMimeType: 'application/json' },
  })
  assert.equal(init.credentials, 'omit')
  assert.equal(init.referrerPolicy, 'no-referrer')
})

test('Claude messages contract: exact URL, method, headers and body; reply parsed', async () => {
  const f = fakeFetch(200, { content: [{ type: 'thinking', text: 'no' }, { type: 'text', text: 'he' }, { type: 'text', text: 'llo' }] })
  const msgs = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }]
  const out = await completeWithProvider({ provider: 'claude', apiKey: 'sk-ant-test-key-12345', model: 'claude-sonnet-5-5' }, msgs, f)
  assert.equal(out, 'hello')
  const { url, init } = f.calls[0]
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal(init.method, 'POST')
  assert.deepEqual(init.headers, {
    'Content-Type': 'application/json', 'x-api-key': 'sk-ant-test-key-12345', 'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  })
  assert.deepEqual(JSON.parse(init.body), { model: 'claude-sonnet-5-5', max_tokens: 4096, system: 'SYS', messages: [{ role: 'user', content: 'hi' }] })
})

test('provider HTTP errors and empty replies give safe messages', async () => {
  await assert.rejects(completeWithProvider({ provider: 'gemini', apiKey: KEY, model: 'm' }, initialMessages('t'), fakeFetch(403, { error: KEY })), (e) => e.message === 'Provider returned HTTP 403.')
  await assert.rejects(completeWithProvider({ provider: 'claude', apiKey: 'sk-ant-test-key-12345', model: 'm' }, initialMessages('t'), fakeFetch(200, { content: [] })), /no text/)
})

test('Gemini listModels contract and parsing', async () => {
  const req = listModelsRequest(` ${KEY} `)
  assert.equal(req.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  assert.equal(req.method, 'GET')
  assert.deepEqual(req.headers, { 'x-goog-api-key': KEY })
  assert.ok(!req.url.includes(KEY))
  const data = { models: [
    { name: 'models/zeta-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/alpha', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/alpha', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/bad name!', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/nomethods' }, null, { name: 5, supportedGenerationMethods: ['generateContent'] },
    { name: 'tuned-no-prefix', supportedGenerationMethods: ['generateContent'] },
  ] }
  assert.deepEqual(parseModelList(data), ['alpha', 'tuned-no-prefix', 'zeta-pro'])
  for (const bad of [null, undefined, {}, { models: 'x' }, []]) assert.deepEqual(parseModelList(bad), [])
  const f = fakeFetch(200, data)
  assert.deepEqual(await fetchGeminiModels(KEY, f), ['alpha', 'tuned-no-prefix', 'zeta-pro'])
  assert.equal(f.calls[0].url, req.url)
  assert.equal(f.calls[0].init.method, 'GET')
  assert.equal(f.calls[0].init.body, undefined)
  assert.deepEqual(f.calls[0].init.headers, { 'x-goog-api-key': KEY })
})

test('listModels failures are clear and never leak the key', async () => {
  for (const status of [404, 403, 401, 500]) {
    await assert.rejects(fetchGeminiModels(KEY, fakeFetch(status, { error: { message: KEY } })), (e) => e.message === modelListError(status) && !e.message.includes(KEY))
  }
  assert.match(modelListError(404), /404/)
  assert.match(modelListError(403), /403/)
  await assert.rejects(fetchGeminiModels('  ', fakeFetch(200, {})), /key/)
  await assert.rejects(fetchGeminiModels(KEY, fakeFetch(200, { models: [] })), /No generateContent/)
  await assert.rejects(fetchGeminiModels(KEY, async () => { throw new TypeError(`boom ${KEY}`) }), (e) => !e.message.includes(KEY))
  await assert.rejects(fetchGeminiModels(KEY, async () => ({ ok: true, status: 200, json: async () => { throw new Error('x') } })), /invalid model list/)
})

test('copilot is a terminal-only agent: it can be the saved default but the API panel falls back to gemini', () => {
  assert.deepEqual([...AGENT_TERMINALS], ['gemini', 'claude', 'copilot'])
  assert.deepEqual([...AGENT_PROVIDERS], ['gemini', 'claude'])
  assert.equal(normalizeDefaultAgent('copilot'), 'copilot')
  assert.equal(normalizeDefaultAgent('Copilot'), 'gemini')
  assert.equal(apiProviderFor('copilot'), 'gemini')
  assert.equal(apiProviderFor('claude'), 'claude')
  assert.equal(AGENT_LABEL.copilot, 'Copilot')
  assert.equal(COPILOT_API_NOTE, 'Copilot runs in the terminal')
  const map = new Map()
  const ok = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
  assert.equal(writeDefaultAgent(ok, 'copilot'), true)
  assert.equal(readDefaultAgent(ok), 'copilot')
  assert.ok(!checkProviderConfig({ provider: apiProviderFor('copilot'), apiKey: KEY, model: 'm' }))
  assert.ok(checkProviderConfig({ provider: 'copilot', apiKey: KEY, model: 'm' }), 'copilot has no API provider call')
})
