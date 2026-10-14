import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  HISTORY_MAX, OUTPUT_MAX_CHARS, OWNER_HELP, SCROLLBACK_MAX, appendScroll, freshCursor, isHelpCommand, outputText, pushHistory, statusText, stepHistory,
} from '../src/lib/terminal-history.ts'
import {
  GUIDE, KEY_FIELDS, TERM_FONT, TERM_SCROLLBACK, accentColor, formatClock, normalizeTermStyle, sessionClock, terminalTheme, welcomeBanner,
} from '../src/lib/public-shell.ts'

test('history: dedupes, ignores blanks, caps, and Up/Down walk with the draft restored', () => {
  let h = []
  h = pushHistory(h, '  ls  '); h = pushHistory(h, 'ls'); h = pushHistory(h, ''); h = pushHistory(h, 'pwd')
  assert.deepEqual(h, ['ls', 'pwd'])
  for (let i = 0; i < HISTORY_MAX + 5; i++) h = pushHistory(h, `c${i}`)
  assert.equal(h.length, HISTORY_MAX)
  h = ['a', 'b', 'c']
  let r = stepHistory(h, freshCursor, 'up', 'draft')
  assert.equal(r.value, 'c')
  r = stepHistory(h, r.cursor, 'up', r.value); assert.equal(r.value, 'b')
  r = stepHistory(h, r.cursor, 'up', r.value); r = stepHistory(h, r.cursor, 'up', r.value); assert.equal(r.value, 'a')
  r = stepHistory(h, r.cursor, 'down', r.value); assert.equal(r.value, 'b')
  r = stepHistory(h, r.cursor, 'down', r.value); r = stepHistory(h, r.cursor, 'down', r.value)
  assert.equal(r.value, 'draft'); assert.equal(r.cursor.index, -1)
  assert.equal(stepHistory(h, freshCursor, 'down', 'x').value, 'x')
  assert.equal(stepHistory([], freshCursor, 'up', 'x').value, 'x')
})

test('scrollback and output formatting are capped and tolerant', () => {
  let s = []
  for (let i = 0; i < SCROLLBACK_MAX + 3; i++) s = appendScroll(s, { id: i, command: 'x', output: '', status: '' })
  assert.equal(s.length, SCROLLBACK_MAX); assert.equal(s.at(-1).id, SCROLLBACK_MAX + 2)
  assert.equal(outputText({ stdout: 'a\n', stderr: 'b' }), 'a\nb')
  assert.equal(outputText({ stdout: 5 }), '')
  assert.ok(outputText({ stdout: 'x'.repeat(OUTPUT_MAX_CHARS + 10) }).includes('clipped'))
  assert.equal(statusText({ exitCode: 0 }), 'exit 0')
  assert.equal(statusText({ timedOut: true, truncated: true }), 'timed out, output truncated')
  assert.equal(statusText({}), 'exit ?')
})

test('help is local, and the guide says Enter does not run anything', () => {
  assert.equal(isHelpCommand(' HELP '), true)
  assert.equal(isHelpCommand('help me'), false)
  assert.ok(/Enter/.test(OWNER_HELP.join(' ')) && /approval/.test(OWNER_HELP.join(' ')))
})

test('the owner console keeps the consent flow: Enter never submits and Run needs the checkbox', () => {
  const src = readFileSync(new URL('../src/components/OwnerCloudConsole.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes('disabled={busy || !configured || !consent} onClick={submit}'))
  assert.ok(/if \(!consent \|\| busy \|\| !configured\) return/.test(src))
  const keydown = src.slice(src.indexOf('onKeyDown'), src.indexOf('className="grow bg-transparent'))
  assert.ok(keydown.length > 100)
  assert.ok(!/submit\(|request\(|execute/.test(keydown), 'key handlers must not run commands')
})

test('public shell look: black theme, both styles, honest banner, bash only', () => {
  for (const style of ['linux', 'powershell']) {
    const t = terminalTheme(style)
    assert.equal(t.background, '#000000'); assert.equal(t.foreground, '#cccccc')
    assert.match(accentColor(style), /^#[0-9a-f]{6}$/)
    const banner = welcomeBanner(style).join('\n')
    assert.match(banner, /bash/); assert.match(banner, /help-rabbit/)
  }
  assert.notEqual(terminalTheme('linux').green, terminalTheme('powershell').green)
  assert.match(welcomeBanner('powershell').join('\n'), /not PowerShell/)
  assert.equal(normalizeTermStyle('powershell'), 'powershell'); assert.equal(normalizeTermStyle('x'), 'linux')
  assert.equal(TERM_FONT, 'Cascadia Mono, Consolas, Menlo, monospace'); assert.equal(TERM_SCROLLBACK, 5000)
})

test('session clock counts down idle and lifetime', () => {
  assert.equal(formatClock(61_000), '01:01'); assert.equal(formatClock(-5), '00:00')
  assert.deepEqual(sessionClock(0, 0, 60_000), { elapsed: '01:00', idle: '09:00', left: '29:00', endsIn: '09:00' })
  assert.equal(sessionClock(0, 29 * 60_000, 29.5 * 60_000).endsIn, '00:30')
  assert.equal(sessionClock(0, 0, 99 * 60_000).endsIn, '00:00')
})

test('guide covers the required topics, copilot key and the three CLIs', () => {
  const titles = GUIDE.map((g) => g.title.toLowerCase()).join('|')
  for (const t of ['first steps', 'bring your own key', 'default agent', 'common commands', 'limits']) assert.ok(titles.includes(t), t)
  const text = GUIDE.flatMap((g) => g.lines).join(' ')
  for (const w of ['cd', 'ls', 'cat', 'rg', 'git', 'node', 'python3', 'help-rabbit', '/login', 'COPILOT_GITHUB_TOKEN']) assert.ok(text.includes(w), w)
  assert.ok(KEY_FIELDS.some((f) => f.name === 'COPILOT_GITHUB_TOKEN'))
})
