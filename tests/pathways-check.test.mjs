import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PROBES, REPOS, formatTable, mark, runAll, summarize } from '../scripts/pathways-check.mjs'

const fake = (ok, detail = 'x') => ({ group: 'G', name: `probe ${String(ok)}`, run: async () => ({ ok, detail }) })

test('results are counted as passed, to look at, or failed, and a thrown error is a failure with its message', async () => {
  const s = await runAll([fake(true), fake('warn'), fake(false), { group: 'G', name: 'boom', run: async () => { throw new Error('gcloud exploded\nsecond line') } }])
  assert.deepEqual([s.total, s.passed, s.warned, s.failed], [4, 1, 1, 2])
  assert.equal(s.results[3].detail, 'gcloud exploded')
  assert.equal(mark(true) + mark('warn') + mark(false), 'PASSWARNFAIL')
})

test('the printed table groups by area and ends with the totals', async () => {
  const s = await runAll([{ ...fake(true), group: 'Local' }, { ...fake(false, 'broke'), group: 'Google Cloud' }])
  const text = formatTable(s)
  assert.match(text, /Local\n {2}PASS/)
  assert.match(text, /Google Cloud\n {2}FAIL {2}probe false\n {8}broke/)
  assert.match(text, /1 passed, 0 to look at, 1 failed \(of 2\)/)
})

test('every probe belongs to a group, is named, and covers VS Code, GitHub, Google Cloud, network, research and blockchain', () => {
  for (const p of PROBES) assert.ok(p.group && p.name && typeof p.run === 'function', p.name)
  const groups = new Set(PROBES.map((p) => p.group))
  for (const g of ['Local (VS Code)', 'Local to GitHub', 'GitHub', 'Google Cloud', 'Network', 'Agents', 'Hugging Face', 'Research', 'Blockchain']) assert.ok(groups.has(g), g)
  assert.ok(REPOS.every((r) => r.owner === 'therealsickonechase-bit'))
})

test('the script only reads: it contains no deploy, push, delete or write commands outside the optional round trip and report', () => {
  const src = readFileSync(new URL('../scripts/pathways-check.mjs', import.meta.url), 'utf8')
  const probes = src.slice(src.indexOf('export const PROBES'), src.indexOf('export async function runAll'))
  assert.ok(!/'push'|'deploy'|'delete'|'rm'|writeFileSync|'secrets', 'set'/.test(probes))
})

test('the VS Code tasks are valid JSON and the check, test and ops-log tasks exist', () => {
  const t = JSON.parse(readFileSync(new URL('../.vscode/tasks.json', import.meta.url), 'utf8'))
  const labels = t.tasks.map((x) => x.label)
  for (const need of ['Pathways: check everything (read only)', 'Tests: RabbitOS app', 'Ops log: add an entry']) assert.ok(labels.includes(need), need)
  for (const x of t.tasks) for (const m of String(x.command).matchAll(/\$\{input:(\w+)\}/g)) assert.ok(t.inputs.some((i) => i.id === m[1]), `input ${m[1]}`)
  assert.equal(summarize([]).total, 0)
})
