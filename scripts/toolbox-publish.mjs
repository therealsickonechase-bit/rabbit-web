// Publishes the toolbox: the platform's commands and the files they use, to gs://rabbitsoftware-io-backups/toolbox/ (private, versioned), with a manifest of hashes.
//   node scripts/toolbox-publish.mjs --dry-run     build and check everything, print the summary, upload nothing
//   node scripts/toolbox-publish.mjs               also upload (your own gcloud sign-in)
// Only files that git TRACKS in the three projects are considered, then filtered by type, size and a secret scan (see src/lib/toolbox.ts). Nothing from .gitignore, no .env, no personal data.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { REPOS, MAX_FILE_BYTES, buildManifest, commandFileIndex, hubToolbox, pathVerdict, publicSlice, secretVerdict, sha256 } from '../src/lib/toolbox.ts'

const PROJECTS = join(homedir(), 'Projects')
const BUCKET = 'gs://rabbitsoftware-io-backups/toolbox'
const PUBLIC_OBJECT = 'gs://rabbitsoftware-io-status-public/status/toolbox-public.json'   // the public slice, read by the Research Agent (A2A) service
const PROJECT = 'rabbitsoftware-io'
const dry = process.argv.includes('--dry-run')

// The command catalog is regenerated first so the bundle never carries a stale list.
execFileSync(process.execPath, [join(PROJECTS, 'rabbit-web', 'scripts', 'export-command-catalog.mjs')], { stdio: 'ignore', cwd: join(PROJECTS, 'rabbit-web') })

const stage = join(tmpdir(), `toolbox-${Date.now()}`)
const files = [], skipped = []
for (const repo of REPOS) {
  const root = join(PROJECTS, repo)
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  for (const path of tracked) {
    const why = pathVerdict(path)
    if (why) { skipped.push({ path: `${repo}/${path}`, reason: why }); continue }
    const abs = join(root, path)
    if (!existsSync(abs)) continue
    const size = statSync(abs).size
    if (size > MAX_FILE_BYTES) { skipped.push({ path: `${repo}/${path}`, reason: `larger than ${MAX_FILE_BYTES} bytes` }); continue }
    const buf = readFileSync(abs)
    const secret = secretVerdict(buf.toString('utf8'))
    if (secret) { skipped.push({ path: `${repo}/${path}`, reason: secret }); continue }
    files.push({ repo, path, sha256: await sha256(new Uint8Array(buf)), bytes: size })
    const dest = join(stage, 'files', repo, path)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(abs, dest)
  }
}

const catalog = JSON.parse(readFileSync(join(PROJECTS, 'rabbitsoftware-cloudflare', 'workers', 'hub-mcp', 'data', 'commands.json'), 'utf8'))
const commands = catalog.entries
const index = commandFileIndex(commands, files)
const manifest = await buildManifest(files, skipped.filter((s) => !s.reason.startsWith('not a code') && !s.reason.startsWith('json file')), commands.length, new Date())
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest))
writeFileSync(join(stage, 'commands-index.json'), JSON.stringify({ generatedAt: manifest.generatedAt, root: manifest.root, commands: Object.fromEntries(commands.map((c) => [c.id, { scope: c.scope, project: c.project, runsIn: c.runsIn, command: c.command, files: index[c.id] }])) }))
let capabilities
try { capabilities = JSON.parse(readFileSync(join(PROJECTS, 'research-agents', 'agent-capabilities.json'), 'utf8')) } catch { capabilities = undefined }
const slice = publicSlice(manifest, commands, index, capabilities)
// The Hub's copy (baked into its image at deploy); deterministic, so an unchanged bundle changes nothing in git.
writeFileSync(join(PROJECTS, 'rabbitsoftware-cloudflare', 'workers', 'hub-mcp', 'data', 'toolbox.json'), JSON.stringify(hubToolbox(manifest, index, capabilities)))
const slicePath = join(tmpdir(), `toolbox-public-${Date.now()}.json`)
writeFileSync(slicePath, JSON.stringify(slice))
mkdirSync(join(homedir(), 'RabbitOS'), { recursive: true })
writeFileSync(join(homedir(), 'RabbitOS', 'toolbox-manifest.json'), JSON.stringify(manifest))

const reasons = {}
for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1
const secretHits = skipped.filter((s) => s.reason.startsWith('secret-like')).map((s) => s.path)
const summary = { event: dry ? 'toolbox_checked' : 'toolbox_published', files: manifest.counts.files, repos: manifest.counts.repos, commands: commands.length, commandsWithFiles: Object.values(index).filter((v) => v.length).length,
  bytes: files.reduce((n, f) => n + f.bytes, 0), publicCommands: slice.counts.publicCommands, agents: slice.agents.length, root: manifest.root, skippedByReason: reasons, secretLikeFilesKeptOut: secretHits }
if (!dry) {
  execFileSync('gcloud', ['storage', 'rsync', '--recursive', stage, BUCKET, '--project', PROJECT], { stdio: 'ignore', shell: process.platform === 'win32' })
  execFileSync('gcloud', ['storage', 'cp', slicePath, PUBLIC_OBJECT, '--cache-control=no-cache', '--content-type=application/json', '--project', PROJECT], { stdio: 'ignore', shell: process.platform === 'win32' })
}
rmSync(slicePath, { force: true })
rmSync(stage, { recursive: true, force: true })
console.log(JSON.stringify(summary))
