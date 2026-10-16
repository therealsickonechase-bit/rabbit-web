// The toolbox: one bundle of the platform's commands and the files they use, published to a private cloud bucket so the local and the cloud agents can read the same thing,
// with a manifest of hashes so either side can check it holds exactly what the other holds.
//
// What goes in: files that git TRACKS in the three projects (so anything in .gitignore, such as .env files, keys, personal data, DNA results and local state, is never even considered),
// of a code / script / document type, under a size limit, whose text passes the secret scan. What never goes in is decided here, in one place, and tested.
// Pure logic with no imports, so tests and the publishing script share it.

export const REPOS = ['rabbit-web', 'rabbitsoftware-cloudflare', 'research-agents'] as const
export const MAX_FILE_BYTES = 1_000_000

const ALLOWED_EXT = /\.(py|ps1|mjs|ts|tsx|md|sh|yml|yaml)$|(^|\/)Dockerfile$/
// Data files that are part of the platform description (not personal data).
const ALLOWED_JSON = [/^workers\/qa-audit\/data\/platform-graph\.json$/, /^workers\/hub-mcp\/data\/commands\.json$/, /^scripts\/agent-registry\.json$/, /^agent-capabilities\.json$/]
const DENIED_PATH = [
  /(^|\/)\.env/i, /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)\.next\//, /(^|\/)\.cloudflare\//, /(^|\/)__pycache__\//,
  /\.(key|pem|pfx|p12|ppk|kdbx|sqlite|db|dump|bundle)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)/i, /wallet\.dat$/i,
  /(^|\/)(private|secrets?|eeg_data|eeg_runs|selfdata|twinnet|dna_index|dna-results|backups?)\//i, /(^|\/)(credentials|secrets?)\.[a-z]+$/i,
]
const SECRET_LIKE = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}/, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./,
  /\bhub_[A-Za-z0-9_-]{32,}/, /\b(?:seed|mnemonic)\s*(?:phrase)?\s*[:=]\s*[\"'`](?:[a-z]{3,8}\s+){11,}[a-z]{3,8}[\"'`]/i, /\bhf_[A-Za-z0-9]{30,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/,
]

export interface Entry { repo: string; path: string; sha256: string; bytes: number }
export interface CatalogCommand { id: string; command: string; project?: string; source?: string; scope?: string; runsIn?: string; group?: string; label?: string; description?: string }
export interface Manifest {
  version: 1
  generatedAt: string
  root: string
  counts: { files: number; commands: number; repos: Record<string, number> }
  files: Entry[]
  skipped: { path: string; reason: string }[]
}

/** Why a tracked path is not published, or null if its name qualifies. */
export function pathVerdict(path: string): string | null {
  const p = path.replace(/\\/g, '/')
  if (DENIED_PATH.some((re) => re.test(p))) return 'denied path'
  if (p.endsWith('.json')) return ALLOWED_JSON.some((re) => re.test(p)) ? null : 'json file that is not platform description'
  return ALLOWED_EXT.test(p) ? null : 'not a code, script or document type'
}

/** The first secret-like pattern found in a text, or null. The pattern is reported by position only, never by value. */
export function secretVerdict(text: string): string | null {
  for (let i = 0; i < SECRET_LIKE.length; i++) if (SECRET_LIKE[i].test(text)) return `secret-like text (pattern ${i + 1})`
  return null
}

export const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
export const sha256 = async (data: Uint8Array | string) => hex(await crypto.subtle.digest('SHA-256', (typeof data === 'string' ? new TextEncoder().encode(data) : data) as BufferSource))

/** One hash for the whole bundle: sorted `repo/path sha256` lines. It changes when any file is added, removed or edited. */
export async function manifestRoot(files: Entry[]): Promise<string> {
  return sha256([...files].map((f) => `${f.repo}/${f.path} ${f.sha256}`).sort().join('\n'))
}

/** Which published files each command uses: the file it came from, and any path in the command text that names a published file (looked up in the command's own project first). */
export function commandFileIndex(commands: CatalogCommand[], files: Entry[]): Record<string, string[]> {
  const byRepo = new Map<string, Set<string>>()
  for (const f of files) (byRepo.get(f.repo) ?? byRepo.set(f.repo, new Set()).get(f.repo)!).add(f.path)
  const out: Record<string, string[]> = {}
  for (const c of commands) {
    const found = new Set<string>()
    const own = byRepo.get(c.project ?? '') ?? new Set<string>()
    const lookup = (token: string) => {
      const t = token.replace(/^["'`]+|["'`,;)]+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^(\$\{[A-Z_]+\}|\/workspace\/[\w.-]+)\//, '')
      if (!/\.[a-z0-9]{1,4}$|Dockerfile$/i.test(t)) return
      for (const [repo, set] of [[c.project ?? '', own] as const, ...byRepo.entries()]) {
        if (set.has(t)) { found.add(`${repo}/${t}`); return }
        const hit = [...set].find((p) => p === t || p.endsWith(`/${t}`))
        if (hit) { found.add(`${repo}/${hit}`); return }
      }
    }
    if (c.source) lookup(c.source)
    for (const token of c.command.split(/\s+/)) lookup(token)
    out[c.id] = [...found].sort()
  }
  return out
}

/** Builds the manifest from files that were already hashed and vetted. */
export async function buildManifest(files: Entry[], skipped: { path: string; reason: string }[], commands: number, now: Date): Promise<Manifest> {
  const sorted = [...files].sort((a, b) => (a.repo + '/' + a.path).localeCompare(b.repo + '/' + b.path))
  const repos: Record<string, number> = {}
  for (const f of sorted) repos[f.repo] = (repos[f.repo] ?? 0) + 1
  return { version: 1, generatedAt: now.toISOString(), root: await manifestRoot(sorted), counts: { files: sorted.length, commands, repos }, files: sorted, skipped }
}

/** Reads the manifest the way an agent should: refuses a manifest whose root does not match its own file list. */
export async function verifyManifest(m: Manifest): Promise<boolean> {
  return m?.version === 1 && Array.isArray(m.files) && (await manifestRoot(m.files)) === m.root
}

// ---- The public slice -------------------------------------------------------------------------------------------------------------------------------------------------------
// The Research Agent (A2A) service is public and has no sign-in, so it must never be given the private toolbox. Instead the publisher writes this small public slice next to the status feed:
// only the commands a guest may see (scope "public"), only files from the two PUBLIC repositories (as links to GitHub, with their hashes), and the root and counts of the whole bundle so a caller
// can tell which bundle it is looking at. No file contents, nothing from research-agents (private), no owner command.
export const PUBLIC_REPOS = ['rabbit-web', 'rabbitsoftware-cloudflare'] as const
export const GITHUB_OWNER = 'therealsickonechase-bit'
export interface PublicToolbox {
  version: 1
  generatedAt: string
  root: string
  counts: { files: number; commands: number; publicCommands: number }
  agents: { id: string; where: string; tasks: { kind: string; about: string; params: Record<string, string> }[]; actions: { id: string; about: string; target: string }[] }[]
  commands: { id: string; group: string; label: string; command: string; description: string; files: { repo: string; path: string; sha256: string; url: string }[] }[]
}

export function publicSlice(manifest: Pick<Manifest, 'root' | 'generatedAt' | 'counts' | 'files'>, commands: CatalogCommand[], index: Record<string, string[]>, capabilities?: Capabilities): PublicToolbox {
  const byKey = new Map(manifest.files.map((f) => [`${f.repo}/${f.path}`, f]))
  const isPublicRepo = (r: string) => (PUBLIC_REPOS as readonly string[]).includes(r)
  const out: PublicToolbox['commands'] = []
  for (const c of commands) {
    if (c.scope !== 'public' || /research-agents/i.test(c.command)) continue
    const files = (index[c.id] ?? []).flatMap((key) => {
      const f = byKey.get(key)
      return f && isPublicRepo(f.repo) ? [{ repo: f.repo, path: f.path, sha256: f.sha256, url: `https://github.com/${GITHUB_OWNER}/${f.repo}/blob/main/${f.path.split('/').map(encodeURIComponent).join('/')}` }] : []
    })
    out.push({ id: c.id, group: String(c.group ?? '').slice(0, 80), label: String(c.label ?? c.id).slice(0, 120), command: c.command.slice(0, 400), description: String(c.description ?? '').slice(0, 300), files })
  }
  return { version: 1, generatedAt: manifest.generatedAt, root: manifest.root, counts: { files: manifest.counts.files, commands: manifest.counts.commands, publicCommands: out.length }, agents: publicAgents(capabilities), commands: out }
}

// ---- What each agent can do (research-agents/agent-capabilities.json, generated from capabilities.py and checked against the real handlers by tests) --------------------------------------
export interface Capabilities {
  version: number
  agents: { id: string; where: string; tasks: { kind: string; about: string; params: Record<string, string> }[]; actions: { id: string; about: string; target: string }[]; howToSend?: string }[]
}

/** The public form: what an agent runs and does, without the command line used to send it work. */
export function publicAgents(c?: Capabilities): PublicToolbox['agents'] {
  return (c?.agents ?? []).map((a) => ({
    id: String(a.id), where: String(a.where).slice(0, 160),
    tasks: a.tasks.map((t) => ({ kind: String(t.kind), about: String(t.about).slice(0, 200), params: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [String(k), String(v).slice(0, 80)])) })),
    actions: a.actions.map((x) => ({ id: String(x.id), about: String(x.about).slice(0, 200), target: String(x.target).slice(0, 80) })),
  }))
}

// ---- The hub's copy -----------------------------------------------------------------------------------------------------------------------------------------------------------
// The Hub (a Cloud Run service for AI assistants) bakes this into its image. It is deterministic (no timestamps) so republishing an unchanged bundle changes nothing in git. The hub decides who sees what:
// guests get only public commands and links into the public repositories, a hub key also sees the private paths.
export interface HubToolbox {
  version: 1
  root: string
  counts: { files: number; commands: number; commandsWithFiles: number }
  files: Record<string, { repo: string; path: string; sha256: string }[]>
  agents: Capabilities['agents']
}

export function hubToolbox(manifest: Pick<Manifest, 'root' | 'counts' | 'files'>, index: Record<string, string[]>, capabilities?: Capabilities): HubToolbox {
  const byKey = new Map(manifest.files.map((f) => [`${f.repo}/${f.path}`, f]))
  const files: HubToolbox['files'] = {}
  for (const id of Object.keys(index).sort()) {
    const list = index[id].flatMap((k) => { const f = byKey.get(k); return f ? [{ repo: f.repo, path: f.path, sha256: f.sha256 }] : [] })
    if (list.length) files[id] = list
  }
  return { version: 1, root: manifest.root, counts: { files: manifest.counts.files, commands: manifest.counts.commands, commandsWithFiles: Object.keys(files).length }, files, agents: capabilities?.agents ?? [] }
}
