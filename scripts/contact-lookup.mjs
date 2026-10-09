// Opens an encrypted contact record in response to a VALID legal request. Run by the owner, offline.
//
//   node scripts/contact-lookup.mjs --email person@example.com --key <private.pem> --reason "..." --ref "..."
//   node scripts/contact-lookup.mjs --user <account uuid>      --key <private.pem> --reason "..." --ref "..."
//   node scripts/contact-lookup.mjs purge-expired --reason "retention purge" --ref "policy"
//
//   --reason  why the record is being opened (at least 5 characters)
//   --ref     the legal reference, e.g. a court order or case number (at least 3 characters)
//
// The access is written to contact_access_log BEFORE anything is decrypted; if that fails, nothing is
// opened. See docs/legal-requests.md for the procedure to follow before running this.
import { readFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { emailHash, openContact } from '../src/lib/contact-crypto.ts'

function loadEnv(path) {
  const env = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=')
      if (i > 0 && !line.startsWith('#')) env[line.slice(0, i)] = line.slice(i + 1).trim()
    }
  } catch {
    // missing file: reported below
  }
  return env
}

const argv = process.argv.slice(2)
const flag = (name) => (argv.indexOf(`--${name}`) >= 0 ? argv[argv.indexOf(`--${name}`) + 1] : undefined)
const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

// Process environment variables win over the files (used by the automated tests with throwaway keys).
const fromProcess = Object.fromEntries(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CONTACT_HASH_KEY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])
)
const env = { ...loadEnv('.env.local'), ...loadEnv('.dev.vars'), ...fromProcess }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const svc = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !svc) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local).')

const reason = flag('reason')
const ref = flag('ref')
if (!reason || reason.length < 5) fail('--reason is required (at least 5 characters).')
if (!ref || ref.length < 3) fail('--ref is required: the legal reference for this request.')

const api = async (path, init = {}) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}
const who = `${userInfo().username}@${hostname()}`
const logAccess = (recordId, why) =>
  api('contact_access_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ record_id: recordId, reason: why, legal_reference: ref, accessed_by: who }),
  })

if (argv[0] === 'purge-expired') {
  const due = await api(`contact_records?select=id&delete_after=lt.${encodeURIComponent(new Date().toISOString())}`)
  await logAccess(null, `${reason} (${due.length} expired records)`)
  if (due.length) await api(`contact_records?delete_after=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' })
  console.log(`Purged ${due.length} expired contact records (logged).`)
  process.exit(0)
}

const keyPath = flag('key')
if (!keyPath) fail('--key <path to your private key .pem> is required.')
let privateB64
try {
  privateB64 = readFileSync(keyPath, 'utf8').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
} catch {
  fail(`Cannot read the private key at ${keyPath}.`)
}

const email = flag('email')
const user = flag('user')
if (!email && !user) fail('Give --email <address> or --user <account uuid>.')

let rows
if (email) {
  if (!env.CONTACT_HASH_KEY) fail('CONTACT_HASH_KEY is missing (.dev.vars).')
  rows = await api(`contact_records?select=*&email_hash=eq.${encodeURIComponent(await emailHash(email, env.CONTACT_HASH_KEY))}`)
} else {
  rows = await api(`contact_records?select=*&user_id=eq.${encodeURIComponent(user)}`)
}

if (!rows.length) {
  await logAccess(null, `${reason} (lookup found no record)`)
  console.log('No contact record found. (The lookup was logged.)')
  process.exit(0)
}

for (const row of rows) {
  await logAccess(row.id, reason) // logged first; if this throws, nothing is decrypted
  const address = await openContact(JSON.parse(row.email_enc), privateB64)
  console.log('-----------------------------------------------')
  console.log(`  email:        ${address}`)
  console.log(`  account id:   ${row.user_id ?? '(account deleted)'}`)
  console.log(`  recorded:     ${row.created_at}`)
  console.log(`  consented:    ${row.consented_at}`)
  if (row.account_closed_at) console.log(`  closed:       ${row.account_closed_at} (kept until ${row.delete_after})`)
}
console.log(`\n${rows.length} record(s) opened and logged as ${who}. Release only what the legal request requires.`)
