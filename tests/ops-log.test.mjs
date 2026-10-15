import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LOG, append, formatEntry } from '../scripts/ops-log.mjs'

const full = { area: 'Google Cloud', did: 'Changed a thing', check: 'Looked at it', undo: 'Change it back', now: new Date('2026-10-15T23:30:00Z') }

test('an entry has a UTC time, the area, and what was done, checked and how to undo it', () => {
  const e = formatEntry({ ...full, ref: 'Fix-It.ps1' })
  assert.match(e, /^### 2026-10-15 23:30 UTC - Google Cloud\n- \*\*Did:\*\* Changed a thing\n- \*\*Checked:\*\* Looked at it\n- \*\*Undo:\*\* Change it back\n- \*\*Ref:\*\* Fix-It\.ps1\n$/)
})

test('every entry needs the four required parts', () => {
  for (const k of ['area', 'did', 'check', 'undo']) assert.throws(() => formatEntry({ ...full, [k]: '' }), new RegExp(`--${k} is required`))
})

test('anything that looks like a secret is refused', () => {
  for (const bad of ['key sk-' + 'a'.repeat(30), 'AIza' + 'b'.repeat(35), '-----BEGIN PRIVATE KEY-----', 'ghp_' + 'c'.repeat(30), 'seed phrase: one two three four five six seven']) assert.throws(() => formatEntry({ ...full, did: bad }), /secret/, bad)
})

test('entries are appended at the end and earlier text is never changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oplog-'))
  const file = join(dir, 'ops-log.md')
  writeFileSync(file, '# Operations log\n\nfirst line\n')
  append(formatEntry(full), file)
  append(formatEntry({ ...full, area: 'Cloudflare', now: new Date('2026-10-16T01:00:00Z') }), file)
  const text = readFileSync(file, 'utf8')
  assert.ok(text.startsWith('# Operations log\n\nfirst line\n'))
  assert.ok(text.indexOf('Google Cloud') < text.indexOf('Cloudflare'))
  assert.equal((text.match(/^### /gm) ?? []).length, 2)
})

test('the real log exists, starts with its rules, and holds no secrets', () => {
  const text = readFileSync(LOG, 'utf8')
  assert.match(text, /^# Operations log/)
  assert.ok((text.match(/^### /gm) ?? []).length >= 8)
  assert.ok(!/sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|BEGIN [A-Z ]*PRIVATE KEY/.test(text))
})
