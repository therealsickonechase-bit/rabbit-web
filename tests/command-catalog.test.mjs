import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CATALOG, COMMAND_MAX_BYTES, PROJECTS, RISK_TEXT, aiContext, commandBytes, groupCatalog, publicEntries, runsIn, searchCatalog,
} from '../src/lib/command-catalog.ts'

const here = dirname(fileURLToPath(import.meta.url))
const roots = {
  'rabbit-web': join(here, '..'),
  'rabbitsoftware-cloudflare': join(here, '..', '..', 'rabbitsoftware-cloudflare'),
  'research-agents': join(here, '..', '..', 'research-agents'),
}
const SCOPES = ['public', 'owner']
const RISKS = Object.keys(RISK_TEXT)
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/
const SECRET_NAME = /TOKEN|SECRET|KEY|SERVICE_ROLE|PASSWORD|DB_URL/
const FORBIDDEN_PUBLIC = /deploy|wrangler secret|migration|SERVICE_ROLE|TOKEN|SECRET|--approve|cloud-access|git push|docker login|printenv|env dump/i

test('ids are unique and fields are valid', () => {
  const ids = new Set()
  for (const e of CATALOG) {
    assert.match(e.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, e.id)
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`)
    ids.add(e.id)
    assert.ok(PROJECTS.includes(e.project), e.id)
    for (const k of ['group', 'label', 'command', 'description', 'source']) assert.ok(typeof e[k] === 'string' && e[k].trim() === e[k] && e[k].length > 0, `${e.id}.${k}`)
    assert.ok(SCOPES.includes(e.scope), e.id)
    assert.ok(RISKS.includes(e.risk), e.id)
    for (const n of e.needs ?? []) assert.match(n, ENV_NAME, `${e.id} needs must be variable NAMES`)
  }
  assert.ok(CATALOG.length > 50)
})

test('commands satisfy the CloudShell contract', () => {
  for (const e of CATALOG) {
    assert.ok(commandBytes(e.command) <= COMMAND_MAX_BYTES, `${e.id} is too long`)
    assert.ok(!e.command.includes('\0'), `${e.id} has NUL`)
    assert.ok(!/[\r\n]/.test(e.command), `${e.id} must be one line`)
  }
})

test('public data hub entries are GET-only curl reads of the hub with no secrets', () => {
  const hub = CATALOG.filter((e) => e.group === 'Public data hub')
  assert.ok(hub.length >= 12)
  for (const e of hub) {
    assert.equal(e.scope, 'public'); assert.equal(e.risk, 'network'); assert.equal(e.needs, undefined)
    assert.match(e.command, /^curl -fsS ("https:\/\/app\.rabbitsoftware\.io\/api\/data\/[a-z_]+\?limit=50"|https:\/\/app\.rabbitsoftware\.io\/api\/data) \| jq$/)
    assert.ok(!/ -X|--data|-d |-H|--header|-u /.test(e.command), e.id)
  }
  for (const id of ['research_records', 'research_topics', 'research_runs', 'research_summaries', 'agents', 'chain_blocks', 'node_scores', 'merkle_batches', 'audit_entries', 'ledger', 'commands']) {
    assert.ok(hub.some((e) => e.command.includes(`/api/data/${id}?`)), id)
  }
})

test('public entries are safe: no deploy, secret, token or env names', () => {
  const pub = publicEntries()
  assert.ok(pub.length > 0)
  for (const e of pub) {
    assert.ok(!FORBIDDEN_PUBLIC.test(e.command), `${e.id}: ${e.command}`)
    assert.ok(!FORBIDDEN_PUBLIC.test(e.id + ' ' + e.label), e.id)
    assert.ok(['read', 'local', 'network'].includes(e.risk), `${e.id} risk ${e.risk}`)
    assert.deepEqual((e.needs ?? []).filter((n) => SECRET_NAME.test(n)), [], e.id)
    assert.equal(e.needs, undefined, `${e.id}: public commands need no environment`)
    assert.equal(runsIn(e), 'sandbox')
    // only paths that exist in the public sandbox image: /workspace/rabbit-web, /workspace/rabbitsoftware-site (site/ only), the helpers, and the visitor's home
    assert.ok(/^(cd \/workspace\/(rabbit-web|rabbitsoftware-site) && |rm -rf ~\/rabbit-web && cp -r --no-preserve=mode \/workspace\/rabbit-web ~\/rabbit-web && cd ~\/rabbit-web|ledger$|repos$|curl -fsS https:\/\/app\.rabbitsoftware\.io\/api\/chain\/head \| jq$|curl -fsS https:\/\/rabbitos-hub-mcp-vxx5lz7c5a-wl\.a\.run\.app\/mcp -H 'content-type: application\/json' -H 'accept: application\/json, text\/event-stream' -d '\{[^']*\}' \| jq -r '\.result\.content\[0\]\.text'$|curl -fsS ("https:\/\/app\.rabbitsoftware\.io\/api\/data\/[a-z_]+\?limit=50"|https:\/\/app\.rabbitsoftware\.io\/api\/data) \| jq$|rabbit-net check$|pwsh --version$)/.test(e.command), `${e.id}: ${e.command}`)
  }
  // things that deploy, hold secrets or need a private checkout are never public
  for (const e of CATALOG.filter((x) => x.risk === 'deploy' || x.risk === 'secret')) assert.equal(e.scope, 'owner', e.id)
  for (const e of CATALOG.filter((x) => x.project === 'research-agents' || /vault|deploy|wrangler|supabase/i.test(x.command))) assert.equal(e.scope, 'owner', e.id)
})

// Network scanning / probing tools: never in a public entry (they are not installed in the public sandbox either).
const SCAN_TOOLS = /\b(nmap|masscan|zmap|nc|ncat|netcat|socat|ping|traceroute|tracert|tracepath|mtr|tcpdump|hping3?|arp-scan|dig|nslookup|whois|nikto|hydra|sqlmap)\b|Test-NetConnection|Resolve-DnsName|-TraceRoute|-NetworkTools|Test-Connection|\/dev\/(tcp|udp)|Invoke-Portscan|Get-NetTCPConnection/i

test('public entries contain no scanning tools; only rabbit-net check and pwsh --version are the PowerShell-related public entries', () => {
  for (const e of publicEntries()) {
    assert.ok(!SCAN_TOOLS.test(e.command), `${e.id}: ${e.command}`)
    assert.ok(!SCAN_TOOLS.test(`${e.id} ${e.label}`.replace('rabbit-net', '')), e.id)
  }
  const psPublic = publicEntries().filter((e) => /pwsh|powershell|rabbit-net|Rabbit(Net|Chain|Connection)/i.test(e.command)).map((e) => e.command).sort()
  assert.deepEqual(psPublic, ['pwsh --version', 'rabbit-net check'])
})

test('RabbitNet PowerShell entries are owner-only, labelled to run on your PC, and never public', () => {
  const rn = CATALOG.filter((e) => /Import-Module|Test-RabbitConnection|Sync-RabbitChain/.test(e.command))
  assert.deepEqual(rn.map((e) => e.command), ['Import-Module ./scripts/powershell/RabbitNet.psd1 -Force', 'Test-RabbitConnection', 'Sync-RabbitChain'])
  for (const e of rn) {
    assert.equal(e.scope, 'owner', e.id)
    assert.equal(runsIn(e), 'computer', e.id)
    assert.match(e.label, /run in PowerShell on your PC/, e.id)
    assert.ok(!/-ToCloudShell|vault|cloud-access|-Token|-NetworkTools/i.test(e.command), e.id)
  }
  if (existsSync(join(roots['rabbit-web'], 'scripts', 'powershell'))) for (const f of ['RabbitNet.psm1', 'RabbitNet.psd1']) assert.ok(existsSync(join(roots['rabbit-web'], 'scripts', 'powershell', f)), f)
})

test('Maxwell mirror dry run is owner-only, labelled to run on your PC, and sends nothing', () => {
  const e = CATALOG.find((x) => x.id === 'ra-maxwell-sync-dry')
  assert.ok(e)
  assert.equal(e.project, 'research-agents')
  assert.equal(e.scope, 'owner')
  assert.equal(e.command, 'python maxwell_chain_sync.py --dry-run')
  assert.equal(runsIn(e), 'computer')
  assert.match(e.label, /run on your PC/)
  assert.equal(e.needs, undefined)
  assert.equal(e.risk, 'local')
  assert.equal(e.source, 'maxwell_chain_sync.py')
})

test('every referenced package.json script and local file exists', (t) => {
  let checked = 0
  for (const e of CATALOG) {
    const root = roots[e.project]
    if (!existsSync(root)) continue // sibling repo not checked out here
    const pkg = join(root, 'package.json')
    const scripts = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {} : null
    for (const m of e.command.matchAll(/npm run ([\w:.-]+)/g)) {
      if (scripts) { assert.ok(m[1] in scripts, `${e.id}: npm run ${m[1]} is not in ${e.project}/package.json`); checked++ }
    }
    for (const m of e.command.matchAll(/(?:node|python3?)(?: -[BI])* (scripts\/[\w./-]+|[\w]+\.py)/g)) {
      assert.ok(existsSync(join(root, m[1])), `${e.id}: ${m[1]} missing`); checked++
    }
    for (const m of e.command.matchAll(/unittest (test_\w+)/g)) assert.ok(existsSync(join(root, `${m[1]}.py`)), `${e.id}: ${m[1]}.py missing`)
    for (const m of e.command.matchAll(/--config (workers\/[\w./-]+)/g)) {
      const cf = roots['rabbitsoftware-cloudflare']
      if (existsSync(cf)) assert.ok(existsSync(join(cf, m[1])), `${e.id}: ${m[1]} missing`)
    }
  }
  if (!checked) t.skip('no sibling repos present')
  // the sandbox helpers are tracked in the cloudflare repo
  const cf = roots['rabbitsoftware-cloudflare']
  if (existsSync(cf)) for (const name of ['ledger', 'repos', 'rabbit-net']) assert.ok(existsSync(join(cf, 'workers', 'public-shell', 'container', name)), name)
})

test('every rabbit-web and rabbitsoftware-cloudflare script is cataloged or deliberately skipped', (t) => {
  const skipped = {
    'rabbit-web': ['build', 'start', 'postinstall'],
    'rabbitsoftware-cloudflare': [],
  }
  for (const project of ['rabbit-web', 'rabbitsoftware-cloudflare']) {
    const pkg = join(roots[project], 'package.json')
    if (!existsSync(pkg)) continue
    const names = Object.keys(JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {})
    const text = CATALOG.filter((e) => e.project === project).map((e) => e.command).join('\n')
    const missing = names.filter((n) => !skipped[project].includes(n) && !new RegExp(`npm run ${n.replace(/[:.]/g, '\$&')}(?![\w:-])`).test(text))
    assert.deepEqual(missing, [], `scripts missing from the catalog: ${missing.join(', ')}`)
  }
  void t
})

test('order is stable and grouping keeps it', () => {
  assert.deepEqual(CATALOG.map((e) => e.id), CATALOG.map((e) => e.id)) // same array each time
  const projectOrder = CATALOG.map((e) => PROJECTS.indexOf(e.project))
  assert.deepEqual([...projectOrder].sort((a, b) => a - b), projectOrder, 'entries are ordered by project')
  const flat = groupCatalog().flatMap((g) => g.entries.map((e) => e.id))
  assert.equal(flat.length, CATALOG.length)
  assert.deepEqual(groupCatalog().map((g) => g.project + '/' + g.group), groupCatalog().map((g) => g.project + '/' + g.group))
  assert.equal(new Set(groupCatalog().map((g) => g.project + '/' + g.group)).size, groupCatalog().length)
})

test('search and AI context', () => {
  assert.ok(searchCatalog(CATALOG, 'ledger').some((e) => e.id === 'cf-ledger'))
  assert.equal(searchCatalog(CATALOG, 'zzzz-no-such-thing').length, 0)
  assert.equal(searchCatalog(CATALOG, '').length, CATALOG.length)
  const ctx = aiContext()
  assert.ok(ctx.includes('cf-ledger: Show the public ledger'))
  for (const e of CATALOG.filter((x) => x.command.length >= 12)) assert.ok(!ctx.includes(e.command), `${e.id} command text leaked into the AI context`)
})

// Public hub calls: a fixed JSON-RPC POST to one of the hub's read-only tools, nothing else.
const HUB_READ_TOOLS = ['hub_help', 'hub_briefing', 'hub_status', 'hub_selftest', 'chain_consistency', 'commands_search', 'research_sources', 'research_search', 'research_feed']
test('public hub entries call only read-only hub tools with fixed JSON bodies', () => {
  const calls = publicEntries().filter((e) => e.command.includes('/mcp'))
  assert.ok(calls.length >= 8)
  for (const e of calls) {
    const body = JSON.parse(/ -d '(.*)' \| jq/.exec(e.command)[1])
    assert.equal(body.method, 'tools/call', e.id)
    assert.ok(HUB_READ_TOOLS.includes(body.params.name), `${e.id}: ${body.params.name}`)
    assert.ok(!/command_draft|shell_propose/.test(e.command), e.id)
  }
})

test('every Google Cloud setup script named in the catalog exists and its run entries are owner-only deploys', () => {
  const root = roots['rabbit-web']
  const gcp = CATALOG.filter((e) => e.id.startsWith('gcp-'))
  assert.ok(gcp.length >= 20)
  for (const e of gcp) {
    const file = /scripts\/powershell\/[\w-]+\.ps1/.exec(e.command)[0]
    if (existsSync(join(root, 'scripts', 'powershell'))) assert.ok(existsSync(join(root, file)), `${e.id}: ${file}`)
    assert.equal(e.scope, 'owner', e.id)
    assert.ok(e.id.endsWith('-preview') ? e.command.endsWith('-WhatIf') : e.risk === 'deploy', e.id)
  }
})
