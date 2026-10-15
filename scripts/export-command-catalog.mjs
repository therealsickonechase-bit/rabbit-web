// Writes the command catalog as JSON for the hub MCP (rabbitsoftware-cloudflare/workers/hub-mcp/data/commands.json).
//   node scripts/export-command-catalog.mjs [output-path]
// The catalog is plain data (src/lib/command-catalog.ts has no imports). It holds environment variable NAMES only, never values. As a second line of
// defence this script refuses to write if anything in the text looks like a real secret.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { CATALOG, COMMAND_MAX_BYTES, PROJECTS, RISK_TEXT, runsIn } from '../src/lib/command-catalog.ts'

const out = resolve(process.argv[2] ?? '../rabbitsoftware-cloudflare/workers/hub-mcp/data/commands.json')
const entries = CATALOG.map((e) => ({ ...e, runsIn: runsIn(e) }))
const payload = { generatedAt: new Date().toISOString(), commandMaxBytes: COMMAND_MAX_BYTES, projects: PROJECTS, riskText: RISK_TEXT, entries }
const text = JSON.stringify(payload, null, 1)

const SECRET_LIKE = [/\bsk-[A-Za-z0-9_-]{16,}/, /\brbk_[A-Za-z0-9_-]{20,}/, /\bhub_[A-Za-z0-9_-]{32,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, /\b[A-Za-z0-9+/]{60,}={0,2}(?![A-Za-z0-9+/])/]
const hit = SECRET_LIKE.find((re) => re.test(text))
if (hit) { console.error(`Refusing to write: the catalog text matches a secret-like pattern (${hit}). Check the entries.`); process.exit(1) }

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text + '\n')
const count = (scope) => entries.filter((e) => e.scope === scope).length
console.log(`Wrote ${entries.length} commands (${count('public')} guest, ${count('owner')} owner) to ${out}`)
