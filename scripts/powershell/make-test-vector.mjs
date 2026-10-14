// Produces the test vector used by test-rabbitnet.ps1: a short ledger chain built by the REAL TypeScript code (src/lib/chain-ledger.ts).
// The PowerShell port of the hashing must reproduce these hashes exactly. tests/rabbitnet.test.mjs rebuilds the vector and compares it to
// test-vector.json, so the fixture can never drift from the TypeScript algorithm.
//   node scripts/powershell/make-test-vector.mjs > scripts/powershell/test-vector.json
import { fileURLToPath } from 'node:url'
import { buildEvents, GENESIS_HEAD } from '../../src/lib/chain-ledger.ts'

const drafts = [
  // plain row with ISO timestamps
  { table: 'collections', op: 'insert', row_id: 'c-1', payload: { id: 'c-1', user_id: 'u-1', name: 'Plain', created_at: '2026-10-01T12:00:00.000Z' } },
  // escapes: quote, backslash, newline, tab, control char, non-ASCII, a surrogate pair, a lone surrogate, slash
  { table: 'notes', op: 'insert', row_id: 'n-1', payload: { id: 'n-1', body: 'quote " back \\ nl \n tab \t ctl \u0001 \u007f caf\u00e9 \u2028 \ud83d\ude00 lone \ud800 / done', created_at: '2026-10-01T12:00:01.000Z' } },
  // numbers (JS formatting), booleans, null, nested arrays and objects, keys that sort differently by case and code unit
  { table: 'self_daily', op: 'update', row_id: 'u-1|2026-10-01', payload: { user_id: 'u-1', day: '2026-10-01', dims: { b: 0.1, a: 1e-7, Z: 1.5e25, z: 123456789012345680000, y: 1e21, x: -3, w: 100, v: 0.000001, u: 12345.678, '\u00e9': true, A: null, list: [1, 'two', [3, { k: false }]] }, synthetic: true } },
  // tombstone
  { table: 'notes', op: 'delete', row_id: 'n-1', payload: {} },
]

export async function makeVector() {
  return buildEvents(GENESIS_HEAD, drafts)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(await makeVector(), null, 2) + '\n')
