import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AI_CODER_ORIGINS, AI_CODER_PATHS, cspForPath, CSP_DIRECTIVES, CSP_HEADER, ENFORCED_CSP_PATHS, cspValue, nextHeaderRules, securityHeaders, staticHeadersFile } from '../src/lib/security-headers.ts'

const get = (name) => securityHeaders().find((h) => h.key === name)?.value

test('the always-on headers are present and safe', () => {
  assert.equal(get('X-Content-Type-Options'), 'nosniff')
  assert.equal(get('X-Frame-Options'), 'DENY')
  assert.equal(get('Referrer-Policy'), 'strict-origin-when-cross-origin')
  assert.match(get('Permissions-Policy'), /camera=\(\)/)
  assert.match(get('Permissions-Policy'), /microphone=\(\)/)
  assert.match(get('Permissions-Policy'), /geolocation=\(\)/)
})

test('HSTS lasts a year and does not touch other subdomains or opt into preload', () => {
  const h = get('Strict-Transport-Security')
  assert.match(h, /^max-age=31536000$/)
  assert.ok(!/includeSubDomains|preload/i.test(h))
})

test('the CSP blocks plugins, framing and foreign form posts, and never allows a wildcard script source', () => {
  const csp = cspValue()
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /base-uri 'self'/)
  assert.match(csp, /form-action 'self'/)
  const scripts = CSP_DIRECTIVES['script-src']
  assert.ok(!scripts.includes('*') && !scripts.includes('https:') && !scripts.includes("'unsafe-eval'"))
  // the only third-party script hosts: the sign-in check and Cloudflare's own analytics
  assert.deepEqual(scripts.filter((s) => s.startsWith('http')), ['https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'])
})

test('the CSP still allows what the features need', () => {
  const connect = CSP_DIRECTIVES['connect-src'].join(' ')
  for (const need of ['https://*.supabase.co', 'wss://*.supabase.co', 'https://*.hf.space', 'https://raw.githubusercontent.com', 'ws://127.0.0.1:*', 'ws://localhost:*']) assert.ok(connect.includes(need), need)
  assert.ok(CSP_DIRECTIVES['frame-src'].includes('https://challenges.cloudflare.com'))
  assert.ok(CSP_DIRECTIVES['img-src'].includes('data:') && CSP_DIRECTIVES['img-src'].includes('blob:'))
  assert.ok(!cspValue().includes('upgrade-insecure-requests'))      // would break ws://127.0.0.1 from an https page
})

test('the CSP is report-only by default and enforced on the pages that were measured clean in a real browser', () => {
  assert.equal(CSP_HEADER, 'Content-Security-Policy-Report-Only')
  assert.ok(get('Content-Security-Policy-Report-Only'))
  assert.equal(get('Content-Security-Policy'), undefined)             // never enforced by the catch-all rule
  const rules = nextHeaderRules()
  assert.equal(rules[0].source, '/:path*')
  const enforced = rules.slice(1, 1 + ENFORCED_CSP_PATHS.length)
  assert.deepEqual(enforced.map((r) => r.source), ENFORCED_CSP_PATHS)
  for (const r of enforced) { assert.equal(r.headers.length, 1); assert.equal(r.headers[0].key, 'Content-Security-Policy'); assert.equal(r.headers[0].value, cspValue()) }
  // pages not yet measured stay report-only: the redirecting root, settings, APIs, the owner console (its policy adds the AI provider origins) and the new donate page
  for (const p of ['/', '/settings', '/api/health', '/cloudshell', '/donate']) assert.ok(!ENFORCED_CSP_PATHS.includes(p), p)
  // the measured pages are on the list, each exactly once
  for (const p of ['/dashboard', '/research', '/ask', '/brain', '/twin', '/connections', '/memory', '/crispr', '/collections', '/tasks', '/agents', '/chain', '/ledger', '/data', '/cloudshell-public', '/commands', '/downloads', '/login', '/guide']) assert.equal(ENFORCED_CSP_PATHS.filter((x) => x === p).length, 1, p)
})

test('the CSP allows Cloudflare Web Analytics, which Cloudflare injects into every page (found with a real browser)', () => {
  assert.ok(CSP_DIRECTIVES['script-src'].includes('https://static.cloudflareinsights.com'))
  assert.ok(CSP_DIRECTIVES['connect-src'].includes('https://cloudflareinsights.com'))
})

test('public/_headers is in step with the definition', () => {
  // git on Windows may check the file out with CRLF line endings: compare the content, not the line endings
  const onDisk = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
  assert.equal(onDisk, staticHeadersFile())
  assert.ok(!onDisk.includes('Content-Security-Policy'))
})

test('the static headers file keeps the one-year immutable cache rule for hashed files (it replaces the file vinext generates)', () => {
  const file = staticHeadersFile()
  const lines = file.split(String.fromCharCode(10))
  const i = lines.indexOf('/_next/static/*')
  assert.ok(i >= 0, 'missing the /_next/static/* rule')
  assert.equal(lines[i + 1], '  Cache-Control: public, max-age=31536000, immutable')
  assert.ok(lines.includes('/*'))
})

test('AI provider origins are in connect-src on the cloudshell page only, never site-wide', () => {
  assert.deepEqual(AI_CODER_PATHS, ['/cloudshell'])
  assert.deepEqual(AI_CODER_ORIGINS, ['https://generativelanguage.googleapis.com', 'https://api.anthropic.com'])
  for (const origin of AI_CODER_ORIGINS) {
    assert.ok(!cspValue().includes(origin), origin)
    assert.ok(!cspForPath('/vault-jobs').includes(origin), origin)
    assert.ok(!cspForPath('/').includes(origin), origin)
    assert.ok(cspForPath('/cloudshell').includes(origin), origin)
    assert.ok(!get('Content-Security-Policy-Report-Only').includes(origin))
  }
  const rules = nextHeaderRules()
  const mine = rules.filter((r) => r.headers.some((h) => h.value.includes(AI_CODER_ORIGINS[0])))
  assert.deepEqual(mine.map((r) => r.source), ['/cloudshell'])
  assert.ok(!ENFORCED_CSP_PATHS.includes('/cloudshell'))
})
