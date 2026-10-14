// Export / import the chain ledger, for the Maxwell node (research-agents rabbit_sync) or any backup host.
//
//   node scripts/chain-export.mjs export <base-url> <file.jsonl> [--since N]   pull public ledger events, verify, append to the file
//   node scripts/chain-export.mjs verify <file.jsonl>                          check the hash chain of a saved file
//   node scripts/chain-export.mjs import <base-url> <file.jsonl>               push events the site is missing (signed; needs INGEST_SHARED_SECRET)
//
// export reads GET /api/chain/ledger?since=N (public, protected fields already stripped). import posts to /api/chain/import
// with the same HMAC scheme as /api/ingest. The secret is read from the environment only and never printed.
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { verifyChain, GENESIS_HEAD, isClean } from '../src/lib/chain-ledger.ts'

const [, , cmd, a, b, ...rest] = process.argv
const die = (m) => { console.error(m); process.exit(1) }
const readFile = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

if (cmd === 'verify') {
  const events = readFile(a ?? die('usage: verify <file.jsonl>'))
  const v = await verifyChain(events)
  if (!v.ok) die(`BROKEN at seq ${v.seq}: ${v.reason}`)
  console.log(`ok: ${v.count} events, head seq ${v.head.seq} ${v.head.hash}`)
} else if (cmd === 'export') {
  const base = a ?? die('usage: export <base-url> <file.jsonl> [--since N]')
  const file = b ?? die('usage: export <base-url> <file.jsonl> [--since N]')
  const have = readFile(file)
  const headBefore = have.length ? { seq: have[have.length - 1].seq, hash: have[have.length - 1].hash } : GENESIS_HEAD
  const flag = rest.indexOf('--since')
  let since = flag >= 0 ? Number(rest[flag + 1]) : headBefore.seq
  let head = headBefore
  let added = 0
  for (;;) {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/chain/ledger?since=${since}`, { redirect: 'error' })
    if (!res.ok) die(`ledger read failed (${res.status})`)
    const { events } = await res.json()
    if (!events.length) break
    const v = await verifyChain(events, head)
    if (!v.ok) die(`refusing a broken chain at seq ${v.seq}: ${v.reason}`)
    appendFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    head = v.head
    since = head.seq
    added += events.length
  }
  console.log(`exported ${added} new events; ${file} head seq ${head.seq}`)
} else if (cmd === 'import') {
  const base = a ?? die('usage: import <base-url> <file.jsonl>')
  const events = readFile(b ?? die('usage: import <base-url> <file.jsonl>'))
  const secret = process.env.INGEST_SHARED_SECRET
  if (!secret) die('set INGEST_SHARED_SECRET in the environment')
  const v = await verifyChain(events)
  if (!v.ok) die(`file is broken at seq ${v.seq}: ${v.reason}`)
  if (!events.every(isClean)) die('file contains data that may not be on the ledger')
  // The site skips events it already has and accepts only those that extend its head.
  let done = 0
  for (let i = 0; i < events.length; i += 500) {
    const body = JSON.stringify({ events: events.slice(i, i + 500) })
    const ts = String(Date.now())
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
    const res = await fetch(`${base.replace(/\/$/, '')}/api/chain/import`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-rabbit-timestamp': ts, 'x-rabbit-signature': sig }, body })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) die(`import rejected (${res.status}): ${out.error ?? 'unknown'}`)
    done += out.added ?? 0
  }
  console.log(`imported ${done} events the site was missing`)
} else {
  writeFileSync(1, 'usage: chain-export.mjs export|verify|import ...\n')
  process.exit(2)
}
