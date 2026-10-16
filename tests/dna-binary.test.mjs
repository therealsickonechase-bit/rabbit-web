import assert from 'node:assert/strict'
import test from 'node:test'
import { bytesToHex, complementStrand, decodeFromDna, dnaView, encodeToDna, fingerprint, gcContent, hexToBytes, sameSequence } from '../src/lib/dna-binary.ts'

// Shared with research-agents/test_dna_fingerprint.py: Python and TypeScript must give exactly these values.
const VECTORS = {
  ACGT: 'f0592be434a731789a25f586390aff0047e956607fbfee6c990ee66574ba6a6e',
  GTCACCAATCCTGTCCCTAG: 'f07906f28a12a3043c18480d64bfc0482e69a1e0f8ba4106644caa205db73914',
  A: '060dc63e5595dffbd161c9ec98bc06fcf67cb22e2e75ecdf0003821388aeee4d',
  ACGTACGTAC: '6b4870101a7d4e9934a064a6f1ca53f69b2334acea920f8646fdd7e0d6833c1e',
}

test('fingerprints equal the Python implementation exactly', async () => {
  for (const [seq, want] of Object.entries(VECTORS)) assert.equal(await fingerprint(seq), want, seq)
})

test('identical sequences match, any difference or length change does not, and case and spaces are ignored', async () => {
  const g = 'GTCACCAATCCTGTCCCTAG'
  assert.ok(await sameSequence(g, ` ${g.toLowerCase()}\n`))
  assert.ok(!(await sameSequence(g, g.slice(0, -1) + 'A')))
  assert.notEqual(await fingerprint('A'), await fingerprint('AA'))
  assert.notEqual(await fingerprint(''), await fingerprint('A'))
})

test('only A, C, G and T are accepted', async () => {
  for (const bad of ['ACGN', 'ACGU', 'AC GT', '12']) await assert.rejects(() => fingerprint(bad), undefined, bad)
  await assert.rejects(() => fingerprint('A'.repeat(1_000_001)))
})

test('a hash round-trips exactly through its DNA view, 4 bases per byte', () => {
  const hash = '00ff10ab' + '0'.repeat(56)
  const v = dnaView(hash)
  assert.equal(v.bases, 128)
  assert.equal(v.dna.slice(0, 8), 'AAAATTTT')                                // 0x00 = AAAA, 0xff = TTTT
  assert.equal(bytesToHex(decodeFromDna(v.dna)), hash)
  assert.equal(v.complement.length, 128)
  assert.ok(v.gcContent >= 0 && v.gcContent <= 1)
  assert.equal(encodeToDna(Uint8Array.of(0x1b)), 'ACGT')                      // 00 01 10 11
})

test('bad input is refused, never guessed at', () => {
  for (const bad of ['', 'abc', 'zz', '0']) assert.throws(() => hexToBytes(bad), undefined, bad)
  assert.throws(() => decodeFromDna('ACG'))                                  // not a whole byte
  assert.throws(() => decodeFromDna('ACGX'))
  assert.equal(gcContent(''), 0)
  assert.equal(complementStrand('ACGT'), 'TGCA')
})
