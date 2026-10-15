// Appends one entry to docs/ops-log.md, the running record of what was changed on the live platform, why, how it was checked, and how to undo it.
//   node scripts/ops-log.mjs --area "Google Cloud" --did "What changed" --check "How it was verified" --undo "How to reverse it" [--ref "script or commit"] [--note "extra"]
// Entries are only ever added at the end. Never put secrets, keys, tokens or private data in an entry.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const LOG = fileURLToPath(new URL('../docs/ops-log.md', import.meta.url))
const SECRET_LIKE = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, /\bhub_[A-Za-z0-9_-]{32,}/, /\b(?:seed|mnemonic)\s*(?:phrase)?\s*[:=]\s*\S+(?:\s+\S+){5,}/i]

export function formatEntry({ area, did, check, undo, ref, note, now = new Date() }) {
  for (const [k, v] of Object.entries({ area, did, check, undo })) if (!v || !String(v).trim()) throw new Error(`--${k} is required`)
  const text = [area, did, check, undo, ref, note].filter(Boolean).join('\n')
  if (SECRET_LIKE.some((re) => re.test(text))) throw new Error('refusing to log: the text looks like it contains a secret')
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const one = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim()
  return [`### ${stamp} - ${one(area)}`, `- **Did:** ${one(did)}`, `- **Checked:** ${one(check)}`, `- **Undo:** ${one(undo)}`, ref ? `- **Ref:** ${one(ref)}` : null, note ? `- **Note:** ${one(note)}` : null].filter((l) => l !== null).join('\n') + '\n'
}

export function append(entry, path = LOG) {
  if (!existsSync(path)) throw new Error(`missing ${path}`)
  const current = readFileSync(path, 'utf8')
  appendFileSync(path, (current.endsWith('\n') ? '' : '\n') + '\n' + entry)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { values } = parseArgs({ options: { area: { type: 'string' }, did: { type: 'string' }, check: { type: 'string' }, undo: { type: 'string' }, ref: { type: 'string' }, note: { type: 'string' } } })
    append(formatEntry(values))
    console.log('logged')
  } catch (e) { console.error('not logged: ' + e.message); process.exit(1) }
}
