// Builds a tree of the database (tables, columns, row-level security, policies, triggers, functions, storage buckets) by reading the SQL migrations in order.
// This is what the migrations create, not a reading of the live database: if something was changed by hand in the SQL editor, it is not here.
// Pure and dependency-free so Node tests can load it directly.

export interface Column { name: string; type: string; primaryKey: boolean; references: string | null; notNull: boolean }
export interface Policy { name: string; command: string; roles: string }
export interface Table { name: string; columns: Column[]; rls: boolean; policies: Policy[]; triggers: string[]; indexes: number; appendOnly: boolean; publicRead: boolean; closed: boolean }
export interface Tree { migrations: { name: string; manual: boolean }[]; tables: Table[]; functions: string[]; storageBuckets: { id: string; public: boolean }[] }

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
const stripSql = (sql: string) => stripComments(sql).replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '$$$$')       // function bodies between dollar quotes

/** A migration that says in its own header that it is applied by hand: the tree cannot tell whether it has been. */
const isManual = (raw: string) => /not\s+applied\s+automatically|apply\s+(?:it\s+)?by\s+hand|applied\s+by\s+hand/i.test(raw.split('\n').slice(0, 40).join('\n'))

const PUBLIC_ROLE = /\b(anon|public)\b/

/** `do $$ ... foreach t in array array['a','b'] loop ... execute format('... public.%I ...', t) ... end loop $$`: apply each statement, in order, to every table named in the array. */
function applyLoopBlocks(raw: string, tables: Map<string, Table>) {
  for (const block of stripComments(raw).matchAll(/\bdo\s+\$([a-z_]*)\$([\s\S]*?)\$\1\$/gi)) {
    const body = block[2]
    const list = /array\s*\[([^\]]*)\]/i.exec(body)
    if (!list) continue
    const names = [...list[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((m) => m[1].toLowerCase())
    const statements = [...body.matchAll(/enable\s+row\s+level\s+security|drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+public\.%I|create\s+policy\s+"([^"]+)"\s+on\s+public\.%I(?:\s+for\s+(\w+))?(?:\s+to\s+([a-z_, ]+?))?\s+using|revoke\s+all\s+on\s+public\.%I\s+from\s+([a-z_, ]+)/gi)]
    for (const name of names) {
      const t = tables.get(name)
      if (!t) continue                                          // the block skips tables that do not exist
      for (const s of statements) {
        if (/^enable/i.test(s[0])) t.rls = true
        else if (/^drop/i.test(s[0])) t.policies = t.policies.filter((p) => p.name !== s[1])
        else if (/^create/i.test(s[0])) {
          const policy = { name: s[2], command: (s[3] ?? 'all').toLowerCase(), roles: (s[4] ?? 'public').trim().toLowerCase() }
          t.policies = t.policies.filter((p) => p.name !== policy.name).concat(policy)
          if (policy.command === 'select' && PUBLIC_ROLE.test(policy.roles)) t.closed = false
        } else if (PUBLIC_ROLE.test(s[5] ?? '')) { t.closed = true; t.policies = t.policies.filter((p) => !PUBLIC_ROLE.test(p.roles)) }
      }
      t.publicRead = t.policies.some((p) => p.command === 'select' && PUBLIC_ROLE.test(p.roles))
    }
  }
}

const ident = (s: string) => s.replace(/"/g, '').replace(/^public\./i, '').toLowerCase()
const CONSTRAINT_START = /^(primary\s+key|unique|foreign\s+key|constraint|check|exclude|like)\b/i

/** Index of the parenthesis that closes the one opened at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'") { i = text.indexOf("'", i + 1); if (i < 0) return -1; continue }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

function splitTop(body: string): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "'") { i = body.indexOf("'", i + 1); if (i < 0) break; continue }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1 }
  }
  out.push(body.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

function parseColumn(def: string): Column | null {
  const m = /^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i.exec(def)
  if (!m) return null
  const rest = m[2].replace(/\s+/g, ' ')
  const type = /^(.*?)(?=\s+(?:not\s+null|null|default|primary|references|check|unique|generated|constraint|collate)\b|$)/i.exec(rest)?.[1].trim() ?? rest
  const ref = /references\s+(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?/i.exec(rest)
  const references = ref ? (ref[1] && ref[1].toLowerCase() !== 'public' ? `${ref[1]}.${ref[2]}` : ref[2]).toLowerCase() : null   // auth.users stays auth.users; public.x is just x
  return { name: m[1].toLowerCase(), type: type.toLowerCase(), primaryKey: /primary\s+key/i.test(rest), references, notNull: /not\s+null/i.test(rest) || /primary\s+key/i.test(rest) }
}

export function buildTree(migrations: { name: string; sql: string }[]): Tree {
  const tables = new Map<string, Table>()
  const functions = new Set<string>()
  const buckets = new Map<string, boolean>()
  const get = (n: string) => tables.get(n)
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name))
  for (const { sql: raw } of ordered) {
    const sql = stripSql(raw)
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi)) {
      const open = m.index! + m[0].length - 1, close = closing(sql, open)
      if (close < 0) continue
      const name = ident(m[1])
      const columns = splitTop(sql.slice(open + 1, close)).filter((d) => !CONSTRAINT_START.test(d)).map(parseColumn).filter((c): c is Column => !!c)
      if (!tables.has(name)) tables.set(name, { name, columns, rls: false, policies: [], triggers: [], indexes: 0, appendOnly: false, publicRead: false, closed: false })
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s+([^;]+);/gi)) {
      const t = get(ident(m[1])); if (!t) continue
      const action = m[2]
      if (/(?:enable|force)\s+row\s+level\s+security/i.test(action)) t.rls = true
      for (const a of action.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([^,]+?)(?=,\s*add\s+column|$)/gi)) { const c = parseColumn(a[1].trim()); if (c && !t.columns.some((x) => x.name === c.name)) t.columns.push(c) }
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)) tables.delete(ident(m[1]))
    // Policies are applied in the order they are written: a file that says `drop policy ...; create policy ...` for the same name ends with the policy in place.
    const TABLE = '((?:public\\.)?"?[a-z_][a-z0-9_]*"?)'
    const policyStatements = new RegExp(`create\\s+policy\\s+"?([^"\\n]+?)"?\\s+on\\s+${TABLE}\\s+(?:as\\s+\\w+\\s+)?(?:for\\s+(\\w+)\\s+)?(?:to\\s+([^\\n;]+?)\\s+)?(?:using|with\\s+check|;)|drop\\s+policy\\s+(?:if\\s+exists\\s+)?"?([^"\\n]+?)"?\\s+on\\s+${TABLE}`, 'gi')
    for (const m of sql.matchAll(policyStatements)) {
      if (m[1] !== undefined) {
        const t = get(ident(m[2])); if (!t) continue
        const policy = { name: m[1].trim(), command: (m[3] ?? 'all').toLowerCase(), roles: (m[4] ?? 'public').trim().toLowerCase() }
        t.policies = t.policies.filter((p) => p.name !== policy.name).concat(policy)
        if (policy.command === 'select' && PUBLIC_ROLE.test(policy.roles)) t.closed = false
      } else {
        const t = get(ident(m[6])); if (t) t.policies = t.policies.filter((p) => p.name !== m[5].trim())
      }
    }
    for (const t of tables.values()) t.publicRead = t.policies.some((p) => p.command === 'select' && PUBLIC_ROLE.test(p.roles))
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+"?([a-z_][a-z0-9_]*)"?[\s\S]*?\son\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)) {
      const t = get(ident(m[2])); if (!t) continue
      if (!t.triggers.includes(m[1])) t.triggers.push(m[1])
      if (/_no_change$|_no_truncate$|append|immutable/i.test(m[1])) t.appendOnly = true
    }
    for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?[a-z_][a-z0-9_]*"?\s+on\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)) { const t = get(ident(m[1])); if (t) t.indexes++ }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi)) functions.add(ident(m[1]))
    for (const m of sql.matchAll(/insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/gi)) {
      const cols = m[1].split(',').map((c) => c.trim().toLowerCase()), vals = m[2].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
      const id = vals[cols.indexOf('id')] ?? vals[0]
      if (id) buckets.set(id, vals[cols.indexOf('public')] === 'true')
    }
    applyLoopBlocks(raw, tables)                              // after the plain statements of the same migration
  }
  return {
    migrations: ordered.map((m) => ({ name: m.name, manual: isManual(m.sql) })),
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    functions: [...functions].sort(),
    storageBuckets: [...buckets].map(([id, isPublic]) => ({ id, public: isPublic })),
  }
}
