import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_BYTES, checkFile, checkMeta, extOf, humanSize, publicUrl, safeFileName, scanText } from '../src/lib/packages.ts'

test('file names are made safe and never contain paths', () => {
  assert.equal(safeFileName('C:\\Users\\me\\My Data (v2).csv'), 'My_Data_v2_.csv')
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('...'), 'package'); assert.ok(safeFileName('a'.repeat(300) + '.zip').length <= 120)
})

test('only data and archive types, within the size limit, are accepted', () => {
  assert.equal(checkFile('SLC6A4_datasets.zip', 36000).ok, true)
  assert.equal(checkFile('reads.fq', 10).ok, true)
  for (const bad of ['setup.exe', 'run.ps1', 'page.html', 'noext', '.env', 'prod.env.local', 'id_rsa', 'cert.pem', 'vault.kdbx', 'secrets.json']) assert.equal(checkFile(bad, 10).ok, false, bad)
  assert.equal(checkFile('a.zip', MAX_BYTES + 1).ok, false); assert.equal(checkFile('a.zip', 0).ok, false)
  assert.ok(checkFile('a.zip', 5).warnings.length > 0, 'archives carry a warning'); assert.equal(checkFile('a.csv', 5).warnings.length, 0)
})

test('text is scanned for secrets and identifiers, reporting names only', () => {
  const sample = ['key sb_secret_AAAAAAAAAAAAAAAAAAAAAA', 'hf_' + 'a'.repeat(30), 'token=abcdefghijklmnop1234', 'me@example.com', '123-45-6789', '-----BEGIN RSA PRIVATE KEY-----'].join('\n')
  const found = scanText(sample)
  assert.ok(found.length >= 6)
  assert.ok(!found.join(' ').includes('AAAAAAAA')); assert.ok(!found.join(' ').includes('example.com'))
  assert.deepEqual(scanText('>NM_001045.6 SLC6A4\nACGTACGT'), [])
})

test('metadata needs a title, a description and a listed licence', () => {
  assert.deepEqual(checkMeta({ title: 'SLC6A4 data', description: 'NCBI Datasets package for human SLC6A4.', licence: 'CC0-1.0 (public domain)' }), [])
  assert.equal(checkMeta({ title: 'x', description: 'short', licence: 'mine' }).length, 3)
})

test('download links force a file download and encode the path', () => {
  assert.equal(extOf('A.TAR.GZ'), 'gz'); assert.equal(humanSize(1536), '2 KB'); assert.equal(humanSize(5 * 1024 ** 2), '5.0 MB')
  const u = publicUrl('https://x.supabase.co/', 'abc/my file.zip', 'my file.zip')
  assert.equal(u, 'https://x.supabase.co/storage/v1/object/public/packages/abc/my%20file.zip?download=my%20file.zip')
})
