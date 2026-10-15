// Writes the Supabase tree (from the SQL migrations in supabase/migrations) as JSON for the weekly audit report.
//   node scripts/export-supabase-tree.mjs [output-path]
// Reads only the migration files in this repository. It does not connect to Supabase and needs no credentials.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { buildTree } from '../src/lib/sql-tree.ts'

const dir = resolve('supabase/migrations')
const out = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '../rabbitsoftware-cloudflare/workers/qa-audit/data/supabase-tree.json')
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
const tree = { generatedAt: new Date().toISOString(), source: 'supabase/migrations (what the migrations create; not a reading of the live database)', ...buildTree(migrations) }

// --live: ask the live project what an ANONYMOUS reader can see, using only the project's public anon key (the one every visitor's browser has; read from .env.local).
// At most one row per table is requested, and neither the key nor any row content is printed or stored: only "rows", "empty" or "refused" per table.
if (process.argv.includes('--live')) {
  const env = Object.fromEntries(readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) { console.error('--live needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'); process.exit(2) }
  const tables = {}, mismatches = []
  for (const t of tree.tables) {
    let result = 'error'
    try {
      const r = await fetch(`${url}/rest/v1/${t.name}?select=*&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
      result = r.status === 200 ? ((await r.json()).length ? 'rows' : 'empty') : r.status === 401 || r.status === 403 ? 'refused' : 'error'
    } catch { result = 'error' }
    tables[t.name] = result
    if ((t.publicRead && result === 'refused') || (t.closed && !t.publicRead && result !== 'refused')) mismatches.push(t.name)
  }
  tree.liveCheck = { at: new Date().toISOString(), method: 'anonymous reader, public anon key, one row per table', tables, mismatches }
  console.log(`Live check: ${Object.values(tables).filter((v) => v === 'refused').length} tables refused an anonymous reader, ${Object.values(tables).filter((v) => v === 'rows' || v === 'empty').length} answered; ${mismatches.length} differ from what the migrations declare${mismatches.length ? ': ' + mismatches.join(', ') : ''}`)
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(tree, null, 1) + '\n')
const cols = tree.tables.reduce((n, t) => n + t.columns.length, 0)
console.log(`Wrote ${out}: ${tree.tables.length} tables, ${cols} columns, ${tree.functions.length} functions, ${tree.storageBuckets.length} storage bucket(s), from ${tree.migrations.length} migrations`)
