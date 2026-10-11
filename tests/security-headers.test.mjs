import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CSP_DIRECTIVES, CSP_HEADER, cspValue, securityHeaders, staticHeadersFile } from '../src/lib/security-headers.ts'

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
  assert.deepEqual(scripts.filter((s) => s.startsWith('http')), ['https://challenges.cloudflare.com'])
})

test('the CSP still allows what the features need', () => {
  const connect = CSP_DIRECTIVES['connect-src'].join(' ')
  for (const need of ['https://*.supabase.co', 'wss://*.supabase.co', 'https://*.hf.space', 'https://raw.githubusercontent.com', 'ws://127.0.0.1:*', 'ws://localhost:*']) assert.ok(connect.includes(need), need)
  assert.ok(CSP_DIRECTIVES['frame-src'].includes('https://challenges.cloudflare.com'))
  assert.ok(CSP_DIRECTIVES['img-src'].includes('data:') && CSP_DIRECTIVES['img-src'].includes('blob:'))
  assert.ok(!cspValue().includes('upgrade-insecure-requests'))      // would break ws://127.0.0.1 from an https page
})

test('the CSP is report-only until deliberately switched', () => {
  assert.equal(CSP_HEADER, 'Content-Security-Policy-Report-Only')
  assert.ok(get('Content-Security-Policy-Report-Only'))
  assert.equal(get('Content-Security-Policy'), undefined)
})

test('public/_headers is in step with the definition', () => {
  // git on Windows may check the file out with CRLF line endings: compare the content, not the line endings
  const onDisk = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
  assert.equal(onDisk, staticHeadersFile())
  assert.ok(!onDisk.includes('Content-Security-Policy'))
})
