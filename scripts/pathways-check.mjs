// End-to-end pathway check: does work in VS Code on this PC reach GitHub, Google Cloud and the websites, and do the research and blockchain loops run across them?
// Read only. It changes nothing; the optional --roundtrip writes ONE marker note into the vault and follows it to Google Cloud and search.
//   node scripts/pathways-check.mjs                 table of checks, exit code 1 if anything failed
//   node scripts/pathways-check.mjs --json          machine-readable result
//   node scripts/pathways-check.mjs --report        also save to ~/RabbitOS/logs/pathways-latest.json and gs://rabbitsoftware-io-reports/pathways/latest.json
//   node scripts/pathways-check.mjs --roundtrip     add the vault marker round trip (about 4 minutes)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const PROJECTS = join(HOME, 'Projects')
export const REPOS = [
  { name: 'rabbit-web', path: join(PROJECTS, 'rabbit-web'), owner: 'therealsickonechase-bit', visibility: 'public' },
  { name: 'rabbitsoftware-cloudflare', path: join(PROJECTS, 'rabbitsoftware-cloudflare'), owner: 'therealsickonechase-bit', visibility: 'public' },
  { name: 'research-agents', path: join(PROJECTS, 'research-agents'), owner: 'therealsickonechase-bit', visibility: 'private' },
  { name: 'obsidian-rabbitos-vault', path: join(HOME, 'Documents', 'RabbitOS Vault'), owner: 'therealsickonechase-bit', visibility: 'private' },
]
const WORKSPACE = join(HOME, 'Documents', 'RabbitOS Vault', 'RabbitOS.code-workspace')
const GCS = { status: 'https://rabbitsoftware-io-status-public.storage.googleapis.com/status/latest.json', ledger: 'https://rabbitsoftware-io-ledger-public.storage.googleapis.com' }
const P = 'rabbitsoftware-io'

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 1 << 26, ...opts }).trim()
const age = (iso) => (Date.now() - new Date(iso).getTime()) / 60_000 // minutes
const mins = (m) => (m < 90 ? `${Math.round(m)} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`)

/** Each probe returns { ok: true|false|'warn', detail } or throws (counted as a failure with the message). */
export const PROBES = [
  // ---------------------------------------------------------------- local: VS Code and the repositories
  { group: 'Local (VS Code)', name: 'VS Code is installed and the multi-root workspace lists every project', run: async () => {
    const v = sh('code', ['--version']).split('\n')[0]
    const ws = JSON.parse(readFileSync(WORKSPACE, 'utf8'))
    const missing = REPOS.filter((r) => !ws.folders.some((f) => f.path.replace(/\\/g, '/').toLowerCase() === r.path.replace(/\\/g, '/').toLowerCase()))
    return missing.length ? { ok: 'warn', detail: `VS Code ${v}; workspace lacks ${missing.map((m) => m.name).join(', ')}` } : { ok: true, detail: `VS Code ${v}; ${ws.folders.length} folders in RabbitOS.code-workspace` }
  } },
  ...REPOS.map((r) => ({ group: 'Local to GitHub', name: `${r.name}: committed, pushed, owned by ${r.owner}`, run: async () => {
    const url = sh('git', ['-C', `"${r.path}"`, 'remote', 'get-url', 'origin'])
    if (!url.includes(`github.com/${r.owner}/`)) return { ok: false, detail: `origin is ${url}` }
    const dirty = sh('git', ['-C', `"${r.path}"`, 'status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).length
    sh('git', ['-C', `"${r.path}"`, 'fetch', '--quiet', 'origin'])
    const ahead = Number(sh('git', ['-C', `"${r.path}"`, 'rev-list', '--count', '@{u}..HEAD']))
    const behind = Number(sh('git', ['-C', `"${r.path}"`, 'rev-list', '--count', 'HEAD..@{u}']))
    const detail = `${dirty} uncommitted, ${ahead} unpushed, ${behind} behind`
    // the vault is edited all day by Obsidian and committed by a task, so a few changes there are normal
    const ok = ahead === 0 && behind === 0 && (r.name === 'obsidian-rabbitos-vault' || dirty === 0)
    return { ok: ok ? true : 'warn', detail }
  } })),
  ...REPOS.map((r) => ({ group: 'GitHub', name: `${r.name} is ${r.visibility} as intended`, run: async () => {
    const v = sh('gh', ['api', `repos/${r.owner}/${r.name}`, '--jq', '.visibility'])
    return { ok: v === r.visibility, detail: v }
  } })),
  { group: 'GitHub', name: 'GitHub to Google Cloud auto-deploy is off by design (no stored cloud key)', run: async () => {
    const secrets = sh('gh', ['secret', 'list', '-R', 'therealsickonechase-bit/rabbit-web', '--json', 'name', '--jq', '.[].name']).split('\n').filter(Boolean)
    return secrets.includes('GCP_CREDENTIALS') ? { ok: 'warn', detail: 'the stale GCP_CREDENTIALS secret still exists; delete it' } : { ok: true, detail: `no GCP_CREDENTIALS secret (${secrets.length} secrets); deploys run from this PC` }
  } },
  { group: 'Local tasks', name: 'PC scheduled tasks last ran OK (vault, research, backups)', run: async () => {
    const script = "Get-ScheduledTask -TaskName 'RabbitOS*' | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; $_.TaskName + '|' + $i.LastTaskResult + '|' + $i.LastRunTime.ToString('s') }"
    const out = sh('powershell', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
    const rows = out.split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
    const bad = rows.filter(([, res]) => !['0', '267009', '267011'].includes(res))
    return { ok: bad.length ? 'warn' : true, detail: bad.length ? `check: ${bad.map(([n, res]) => `${n} (${res})`).join('; ')}` : `${rows.length} tasks, all last results OK` }
  } },
  // ---------------------------------------------------------------- Google Cloud
  { group: 'Google Cloud', name: 'Cloud Run services and jobs are all ready', run: async () => {
    const svc = JSON.parse(sh('gcloud', ['run', 'services', 'list', '--project', P, '--format=json']))
    const jobs = JSON.parse(sh('gcloud', ['run', 'jobs', 'list', '--project', P, '--region', 'us-west2', '--format=json']))
    const notReady = [...svc, ...jobs].filter((x) => !(x.status.conditions || []).some((c) => (c.type === 'Ready') && c.status === 'True')).map((x) => x.metadata.name)
    return { ok: notReady.length === 0, detail: `${svc.length} services, ${jobs.length} jobs${notReady.length ? '; not ready: ' + notReady.join(', ') : ''}` }
  } },
  { group: 'Google Cloud', name: 'Cloud Scheduler jobs run (only the parked anchor job is paused)', run: async () => {
    const jobs = JSON.parse(sh('gcloud', ['scheduler', 'jobs', 'list', '--location', 'us-west2', '--project', P, '--format=json']))
    const paused = jobs.filter((j) => j.state !== 'ENABLED').map((j) => j.name.split('/').pop())
    const unexpected = paused.filter((n) => n !== 'rabbit-anchor-chains-6h')
    return { ok: unexpected.length === 0, detail: `${jobs.length} jobs; paused: ${paused.join(', ') || 'none'}` }
  } },
  { group: 'Google Cloud', name: 'Hub MCP answers and its self-test passes', run: async () => {
    const url = sh('gcloud', ['run', 'services', 'describe', 'rabbitos-hub-mcp', '--project', P, '--region', 'us-west2', '--format=value(status.url)'])
    const res = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hub_selftest', arguments: {} } }), signal: AbortSignal.timeout(60_000) })
    const body = JSON.parse((await res.json()).result.content[0].text)
    return { ok: body.allOk === true, detail: `${body.passed} of ${body.total} checks` }
  } },
  { group: 'Google Cloud', name: 'Vault copy in Google Cloud is fresh (hourly upload)', run: async () => {
    const objs = JSON.parse(sh('gcloud', ['storage', 'ls', '--json', '"gs://rabbitsoftware-io-vault-private/vault/Ops/**"', '--project', P]))
    const stamps = objs.map((o) => o.metadata?.updated || o.update_time || o.updated).filter(Boolean).sort()
    if (!stamps.length) return { ok: false, detail: 'no objects found under vault/Ops/' }
    const m = age(stamps.pop())
    return { ok: m < 200 ? true : 'warn', detail: `newest object ${mins(m)} old` }
  } },
  // ---------------------------------------------------------------- network
  ...[['rabbitsoftware.io (website)', 'https://rabbitsoftware.io/'], ['app.rabbitsoftware.io (RabbitOS)', 'https://app.rabbitsoftware.io/api/health'], ['public ledger mirror', `${GCS.ledger}/ledger/chain_head.json`], ['status feed', GCS.status], ['RF Nexus preview', 'https://rf-nexus-preview-vxx5lz7c5a-wl.a.run.app/health']].map(([name, url]) => ({ group: 'Network', name: `${name} answers`, run: async () => {
    const t = Date.now(); const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    return { ok: r.ok, detail: `HTTP ${r.status} in ${Date.now() - t} ms` }
  } })),
  { group: 'Network', name: 'status feed is fresh and every monitored service is up', run: async () => {
    const f = await (await fetch(`${GCS.status}?cb=${Date.now()}`)).json()
    const m = age(f.generatedAt)
    return { ok: f.up === f.total && m < 15, detail: `${f.up} of ${f.total} up, written ${mins(m)} ago` }
  } },
  // ---------------------------------------------------------------- agents
  { group: 'Agents', name: 'the Research Agent (A2A) answers and its card is valid', run: async () => {
    const base = 'https://rabbit-research-agent-vxx5lz7c5a-wl.a.run.app'
    const card = await (await fetch(`${base}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(20_000) })).json()
    const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { kind: 'message', role: 'user', messageId: 'pathways', parts: [{ kind: 'text', text: 'what sources can you search?' }] } } }) }).then((x) => x.json())
    const ok = card.name === 'RabbitOS Research Agent' && card.skills?.length >= 4 && r.result?.kind === 'message'
    return { ok, detail: `${card.name} v${card.version}, ${card.skills?.length} skills, message/send ${r.result ? 'answered' : 'failed'}` }
  } },
  { group: 'Agents', name: 'the task worker in Google Cloud runs every 5 minutes and succeeds', run: async () => {
    const ex = JSON.parse(sh('gcloud', ['run', 'jobs', 'executions', 'list', '--job', 'rabbit-task-worker', '--project', P, '--region', 'us-west2', '--limit', '3', '--format=json']))
    if (!ex.length) return { ok: false, detail: 'no executions yet' }
    const last = ex[0], when = last.status?.completionTime || last.metadata?.creationTimestamp
    const m = age(when), ok = (last.status?.succeededCount ?? 0) >= 1
    return { ok: ok && m < 20 ? true : 'warn', detail: `last run ${mins(m)} ago, ${ok ? 'succeeded' : 'did not succeed'}` }
  } },
  { group: 'Agents', name: 'the PC and the cloud hear and acknowledge each other (echo)', run: async () => {
    const read = (side) => JSON.parse(sh('gcloud', ['storage', 'cat', `gs://rabbitsoftware-io-reports/echo/${side}/status.json`, '--project', P]))
    let pc, cloud
    try { pc = read('pc'); cloud = read('cloud') } catch { return { ok: false, detail: 'echo status files not found (is RabbitOS Echo registered and rabbit-echo scheduled?)' } }
    const ageP = age(pc.checkedAt), ageC = age(cloud.checkedAt)
    const heard = pc.heardFrom === 'cloud' && cloud.heardFrom === 'pc' && !pc.peerSignatureInvalid && !cloud.peerSignatureInvalid
    const acked = pc.peerAcknowledgedMyPrevious && cloud.peerAcknowledgedMyPrevious
    const fresh = ageP < 20 && ageC < 20
    return { ok: heard && acked && fresh ? true : (heard ? 'warn' : false), detail: `PC checked ${mins(ageP)} ago, cloud ${mins(ageC)} ago; heard each other ${heard}, acknowledged ${acked}${acked ? ` (PC note acknowledged in ${cloud.acknowledgementSeconds}s, cloud note in ${pc.acknowledgementSeconds}s)` : ''}` }
  } },
  { group: 'Agents', name: 'the Agent Registry lists the Research Agent and the Hub MCP', run: async () => {
    const tok = sh('gcloud', ['auth', 'print-access-token'])
    const get = async (kind) => (await (await fetch(`https://agentregistry.googleapis.com/v1alpha/projects/${P}/locations/global/${kind}?pageSize=100`, { headers: { authorization: `Bearer ${tok}`, 'x-goog-user-project': P } })).json())[kind] ?? []
    const [agents, mcp] = await Promise.all([get('agents'), get('mcpServers')])
    const a = agents.some((x) => x.displayName === 'RabbitOS Research Agent'), m = mcp.some((x) => x.displayName === 'RabbitOS Hub (MCP)')
    return { ok: a && m ? true : false, detail: `agent ${a ? 'listed' : 'MISSING'}, MCP server ${m ? 'listed' : 'MISSING'} (${agents.length} agents and ${mcp.length} MCP servers visible in the project)` }
  } },
  // ---------------------------------------------------------------- Hugging Face
  { group: 'Hugging Face', name: 'the image Space (rabbitos-eeg-qwen-image) and the model are public and the Space is running', run: async () => {
    const [space, model] = await Promise.all([
      fetch('https://huggingface.co/api/spaces/Therealsickonechase-bit/rabbitos-eeg-qwen-image', { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()),
      fetch('https://huggingface.co/api/models/Therealsickonechase-bit/Llama-3.2-3B-RabbitSoftware-GGUF', { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()),
    ])
    const stage = space.runtime?.stage
    return { ok: stage === 'RUNNING' && !model.private ? true : 'warn', detail: `Space ${stage} on ${space.runtime?.hardware?.current ?? '?'}, model downloads ${model.downloads ?? '?'}` }
  } },
  { group: 'Hugging Face', name: 'your Hugging Face buckets and datasets are backed up in Google Cloud (nightly)', run: async () => {
    let objs = []
    try { objs = JSON.parse(sh('gcloud', ['storage', 'ls', '--json', '"gs://rabbitsoftware-io-backups/huggingface/**"', '--project', P])) } catch (e) { if (!/matched no objects/.test(String(e.stderr || e.message))) throw e }
    const stamps = objs.map((o) => o.metadata?.updated || o.update_time).filter(Boolean).sort()
    if (!stamps.length) return { ok: 'warn', detail: 'nothing under huggingface/ yet (the first run may still be going)' }
    const m = age(stamps.pop())
    return { ok: m < 60 * 40 ? true : 'warn', detail: `${objs.length} objects, newest ${mins(m)} old` }
  } },
  // ---------------------------------------------------------------- research
  { group: 'Research', name: 'research records reach RabbitOS and the feed is recent', run: async () => {
    const f = await (await fetch(`${GCS.status}?cb=${Date.now()}`)).json()
    const m = age(f.research.lastReportAt)
    return { ok: m < 60 * 36 ? true : 'warn', detail: `${f.research.records} records, ${f.research.topicsExplored} topics explored, last report ${mins(m)} ago` }
  } },
  { group: 'Research', name: 'local research store and agents are in place', run: async () => {
    const store = join(PROJECTS, 'research-agents', 'research_store.json')
    if (!existsSync(store)) return { ok: false, detail: 'research_store.json missing' }
    const d = JSON.parse(readFileSync(store, 'utf8'))
    return { ok: true, detail: `${Object.keys(d.topics || {}).length} topics, ${(d.queue || []).length} queued, ${(d.known_ids || []).length} known ids` }
  } },
  // ---------------------------------------------------------------- blockchain
  { group: 'Blockchain', name: 'public ledger: app and Google Cloud copy agree', run: async () => {
    const [app, mirror] = await Promise.all([fetch('https://app.rabbitsoftware.io/api/chain/head').then((r) => r.json()), fetch(`${GCS.ledger}/ledger/chain_head.json?cb=${Date.now()}`).then((r) => r.json())])
    return { ok: app.length === mirror.length && app.headHash === mirror.headHash, detail: `length ${app.length}/${mirror.length}, head ${String(app.headHash).slice(0, 10)}` }
  } },
  { group: 'Blockchain', name: 'Maxwell chain: this PC, the app and Google Cloud hold the same blocks', run: async () => {
    const local = JSON.parse(readFileSync(join(PROJECTS, 'research-agents', 'maxwell_chain.json'), 'utf8'))
    const bucket = await (await fetch(`${GCS.ledger}/maxwell/maxwell_chain.json?cb=${Date.now()}`)).json()
    const blocks = (j) => (Array.isArray(j) ? j : j.blocks ?? j.chain ?? [])
    const h = (j) => blocks(j).map((b) => b.hash).join(',')
    return { ok: h(local) === h(bucket) && blocks(local).length > 0, detail: `${blocks(local).length} blocks locally, ${blocks(bucket).length} in the bucket` }
  } },
  { group: 'Blockchain', name: 'Bitcoin anchors: newest is confirmed, or pending for under a day', run: async () => {
    const idx = await (await fetch(`${GCS.ledger}/anchors/index.json?cb=${Date.now()}`)).json()
    const a = idx[0]
    const id = a.id.replace(/T(\d{2})(\d{2})(\d{2})Z/, 'T$1:$2:$3Z')
    const m = age(id)
    return { ok: a.status === 'confirmed' || m < 1440, detail: `${a.id} ${a.status}${a.bitcoinHeight ? ' in block ' + a.bitcoinHeight : ''}, ${idx.length} anchors` }
  } },
  { group: 'Blockchain', name: 'wallet watcher is current and the keys are protected', run: async () => {
    const st = JSON.parse(sh('gcloud', ['storage', 'cat', 'gs://rabbitsoftware-io-reports/wallet/state.json', '--project', P]))
    const m = age(st.updatedAt)
    const liens = sh('gcloud', ['projects', 'describe', P, '--format=value(projectNumber)'])
    const tok = sh('gcloud', ['auth', 'print-access-token'])
    const lr = await (await fetch(`https://cloudresourcemanager.googleapis.com/v1/liens?parent=projects/${liens}`, { headers: { authorization: `Bearer ${tok}`, 'x-goog-user-project': P } })).json()
    const lien = (lr.liens || []).length
    const held = Object.values(st.accounts).filter((a) => a.balance && a.balance !== '0').length
    return { ok: m < 90 && lien > 0 ? true : 'warn', detail: `state ${mins(m)} old, ${lien} project lien, ${held} addresses holding funds, ${st.receipts.length} receipts` }
  } },
]

export async function runAll(probes = PROBES, { log = () => {} } = {}) {
  const results = []
  for (const p of probes) {
    const t = Date.now()
    let r
    try { r = await p.run() } catch (e) { r = { ok: false, detail: String(e.stderr || e.message || e).split('\n')[0].slice(0, 160) } }
    const row = { group: p.group, name: p.name, ok: r.ok, detail: r.detail, ms: Date.now() - t }
    results.push(row); log(row)
  }
  return summarize(results)
}
export function summarize(results) {
  const failed = results.filter((r) => r.ok === false).length, warned = results.filter((r) => r.ok === 'warn').length
  return { generatedAt: new Date().toISOString(), total: results.length, passed: results.length - failed - warned, warned, failed, results }
}
export const mark = (ok) => (ok === true ? 'PASS' : ok === 'warn' ? 'WARN' : 'FAIL')
export function formatTable(summary) {
  let group = ''
  const lines = []
  for (const r of summary.results) {
    if (r.group !== group) { group = r.group; lines.push(`\n${group}`) }
    lines.push(`  ${mark(r.ok)}  ${r.name}\n        ${r.detail}`)
  }
  lines.push(`\n${summary.passed} passed, ${summary.warned} to look at, ${summary.failed} failed (of ${summary.total})`)
  return lines.join('\n')
}

/** Optional: follow one marker note from the vault to Google Cloud and through search. Writes ONE small note, Ops/Pathway check.md. */
export async function roundtrip({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const tag = 'pathwaycheck' + Math.floor(Math.random() * 900000 + 100000)
  const note = join(HOME, 'Documents', 'RabbitOS Vault', 'Ops', 'Pathway check.md')
  writeFileSync(note, `# Pathway check\n\nWritten by scripts/pathways-check.mjs on ${new Date().toISOString()} to prove vault -> Google Cloud -> search. Marker: ${tag}\n`)
  const steps = []
  sh('powershell', ['-NoProfile', '-Command', '"Start-ScheduledTask -TaskName \'RabbitOS Vault to Google Cloud\'"'])
  let inBucket = false
  for (let i = 0; i < 12 && !inBucket; i++) { await sleep(15_000); try { inBucket = /Pathway check\.md/.test(sh('gcloud', ['storage', 'ls', '"gs://rabbitsoftware-io-vault-private/vault/Ops/Pathway check.md"', '--project', P])) } catch { /* not there yet */ } }
  steps.push({ step: 'note reached the Google Cloud bucket', ok: inBucket })
  sh('powershell', ['-NoProfile', '-Command', '"Start-ScheduledTask -TaskName \'RabbitOS Vault Search Reindex\'"'])
  let found = false
  for (let i = 0; i < 10 && !found; i++) { await sleep(30_000); try { found = sh('pwsh', ['-NoProfile', '-File', `"${join(PROJECTS, 'rabbit-web', 'scripts', 'powershell', 'Search-Vault.ps1')}"`, tag, '-Top', '2']).includes('Pathway check') } catch { /* not indexed yet */ } }
  steps.push({ step: 'search found the marker', ok: found })
  return { tag, steps }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = new Set(process.argv.slice(2))
  const summary = await runAll(PROBES, { log: args.has('--json') ? () => {} : (r) => process.stderr.write(`${mark(r.ok)} ${r.name}\n`) })
  if (args.has('--roundtrip')) {
    const rt = await roundtrip()
    for (const s of rt.steps) summary.results.push({ group: 'Round trip (vault to Google Cloud)', name: s.step, ok: s.ok, detail: rt.tag, ms: 0 })
    Object.assign(summary, summarize(summary.results))
  }
  if (args.has('--report')) {
    const dir = join(HOME, 'RabbitOS', 'logs'); mkdirSync(dir, { recursive: true })
    const file = join(dir, 'pathways-latest.json'); writeFileSync(file, JSON.stringify(summary, null, 1))
    try { sh('gcloud', ['storage', 'cp', `"${file}"`, 'gs://rabbitsoftware-io-reports/pathways/latest.json', '--project', P]) } catch (e) { process.stderr.write('could not copy the report to Google Cloud: ' + String(e.message).split('\n')[0] + '\n') }
  }
  console.log(args.has('--json') ? JSON.stringify(summary, null, 1) : formatTable(summary))
  process.exit(summary.failed ? 1 : 0)
}
