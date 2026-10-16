import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManifest, commandFileIndex, manifestRoot, pathVerdict, secretVerdict, sha256, verifyManifest } from '../src/lib/toolbox.ts'

test('only code, scripts and documents qualify by name', () => {
  for (const ok of ['src/lib/toolbox.ts', 'scripts/powershell/Run-Echo.ps1', 'docs/agents.md', 'dna_local.py', 'workers/echo-job/Dockerfile', 'workers/hub-mcp/src/help.mjs', 'workers/qa-audit/data/platform-graph.json']) {
    assert.equal(pathVerdict(ok), null, ok)
  }
  for (const bad of ['.env', '.env.local', 'research-agents/.env', 'keys/signer.pem', 'wallet.dat', 'id_rsa', 'dna_index/index.json', 'private/dna-local.key', 'eeg_data/session1.csv',
    'selfdata/labs.json', 'node_modules/x/index.mjs', '.git/config', 'backups/db.dump', 'data/anything.json', 'photo.png', 'maxwell_chain.json', 'credentials.json', 'x/secrets/a.py']) {
    assert.notEqual(pathVerdict(bad), null, bad)
  }
})

test('text that looks like a secret keeps the file out, and the verdict never repeats the value', () => {
  const samples = ['key = "sk-abcdefghijklmnopqrstuvwxyz123456"', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789', '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj', 'AIzaSyA-abcdefghijklmnopqrstuvwxyz012345',
    'hf_abcdefghijklmnopqrstuvwxyzABCDEF1234', 'mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident"']
  for (const s of samples) {
    const v = secretVerdict(s)
    assert.ok(v && v.startsWith('secret-like text'), s)
    assert.ok(!v.includes('abcdefgh') && !v.includes('mnemonic'))
  }
  assert.equal(secretVerdict('const secret = process.env.RABBIT_INGEST_SECRET // a name, not a value'), null)
  assert.equal(secretVerdict('The seed phrase must never be stored.'), null)
  assert.equal(secretVerdict('const BEGIN = "-----BEGIN PRIVATE KEY-----" // the header only, as a pattern'), null)
  assert.equal(secretVerdict('seed = Math.floor(rng() * 1000)'), null)
})

const F = (repo, path, sha = 'a'.repeat(64)) => ({ repo, path, sha256: sha, bytes: 10 })

test('the root is order independent and changes when a file is added, removed or edited', async () => {
  const a = F('rabbit-web', 'a.ts'), b = F('research-agents', 'b.py')
  assert.equal(await manifestRoot([a, b]), await manifestRoot([b, a]))
  assert.notEqual(await manifestRoot([a, b]), await manifestRoot([a]))
  assert.notEqual(await manifestRoot([a, b]), await manifestRoot([a, { ...b, sha256: 'b'.repeat(64) }]))
})

test('a manifest verifies, and one whose files were changed does not', async () => {
  const m = await buildManifest([F('rabbit-web', 'a.ts'), F('research-agents', 'b.py')], [{ path: '.env', reason: 'denied path' }], 2, new Date('2026-10-16T12:00:00Z'))
  assert.equal(m.counts.files, 2)
  assert.deepEqual(m.counts.repos, { 'rabbit-web': 1, 'research-agents': 1 })
  assert.ok(await verifyManifest(m))
  assert.ok(!(await verifyManifest({ ...m, files: m.files.slice(1) })))
  assert.ok(!(await verifyManifest({ ...m, version: 2 })))
})

test('each command is tied to the published files it uses', () => {
  const files = [F('research-agents', 'dna_local.py'), F('rabbit-web', 'scripts/powershell/Run-DnaLocal.ps1'), F('rabbit-web', 'package.json'), F('research-agents', 'stage_box.py')]
  const cmds = [
    { id: 'dna-local-compare', command: 'python dna_local.py compare --fasta C:\\Private\\x.fasta', project: 'research-agents', source: 'dna_local.py' },
    { id: 'dna-local-run', command: 'pwsh -File scripts/powershell/Run-DnaLocal.ps1 -Fasta C:\\Private\\x.fasta', project: 'rabbit-web', source: 'scripts/powershell/Register-ResearchTasks.ps1' },
    { id: 'stage', command: 'python stage_box.py stage --to research', project: 'research-agents' },
    { id: 'nothing', command: 'echo hello', project: 'rabbit-web' },
  ]
  const idx = commandFileIndex(cmds, files)
  assert.deepEqual(idx['dna-local-compare'], ['research-agents/dna_local.py'])
  assert.deepEqual(idx['dna-local-run'], ['rabbit-web/scripts/powershell/Run-DnaLocal.ps1'])
  assert.deepEqual(idx.stage, ['research-agents/stage_box.py'])
  assert.deepEqual(idx.nothing, [])
})

test('sha256 matches the standard value', async () => {
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
