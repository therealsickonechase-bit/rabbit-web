// Static checks for the RabbitNet PowerShell module (scripts/powershell). The behaviour tests run in PowerShell:
//   pwsh -File scripts/powershell/test-rabbitnet.ps1
// These Node tests need no PowerShell: they read the module as text and tie its test vector to the TypeScript ledger code.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyChain } from '../src/lib/chain-ledger.ts'
import { cloudshellCommand } from '../src/lib/chain-public.ts'
import { makeVector } from '../scripts/powershell/make-test-vector.mjs'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'powershell')
const read = (f) => readFileSync(join(dir, f), 'utf8')
const psm1 = read('RabbitNet.psm1')
const psd1 = read('RabbitNet.psd1')
const selfTest = read('test-rabbitnet.ps1')
// Code only: drop # comments so documentation that names forbidden things (for example "no port scan") does not trip the checks.
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
const EXPORTS = ['Test-RabbitConnection', 'Get-RabbitChainHead', 'Sync-RabbitChain', 'Test-RabbitChain']

test('exports exist in the module and the manifest', () => {
  for (const name of EXPORTS) {
    assert.match(psm1, new RegExp(`^function ${name} \\{`, 'm'), name)
    assert.ok(psd1.includes(`'${name}'`), `${name} missing from RabbitNet.psd1`)
  }
  assert.match(psm1, /^Export-ModuleMember -Function Test-RabbitConnection, Get-RabbitChainHead, Sync-RabbitChain, Test-RabbitChain$/m)
  assert.match(psd1, /RootModule\s*=\s*'RabbitNet\.psm1'/)
  assert.match(psd1, /PowerShellVersion\s*=\s*'7\.0'/)
  assert.match(psd1, /CmdletsToExport\s*=\s*@\(\)/)
  assert.match(selfTest, /exit 0/) // skips cleanly when pwsh 7 is missing
  assert.match(selfTest, /SKIP: RabbitNet needs PowerShell 7/)
})

test('no port-scan cmdlets or tools: the only port is 443 and Test-NetConnection is never given a variable port', () => {
  const c = code(psm1)
  assert.doesNotMatch(c, /nmap|masscan|zmap|Invoke-Portscan|Test-Port\b|Get-NetTCPConnection|Test-Connection\b|1\.\.\d{3,}|\[System\.Net\.Dns\]::GetHostEntry\(\$_\)/i)
  assert.doesNotMatch(c, /-Port\s+\$|-Port\s+\d+\.\.|-Port\s+@|-Ports\b|-PortRange|-Range\b|-Cidr|\/\d{1,2}\b.*(foreach|ForEach)/)
  for (const line of c.split('\n').filter((l) => l.includes('Test-NetConnection'))) assert.match(line, /-Port 443\b|-TraceRoute -Hops 15\b|Get-Command Test-NetConnection/, line)
  for (const m of c.matchAll(/ConnectAsync\(([^)]*)\)/g)) assert.match(m[1], /, 443$/, m[0])
  // hosts for the extra diagnostics must pass the single-host-name check
  assert.match(c, /function Test-RabbitHostName/)
  assert.match(c, /Test-RabbitHostName \$h/)
  assert.match(c, /ValidateCount\(1, 5\)\]\[string\[\]\]\$TargetHost/)
})

test('NetworkTools is opt-in, confirmed (-Confirm / -WhatIf), and Sync supports -WhatIf too', () => {
  const conn = psm1.slice(psm1.indexOf('function Test-RabbitConnection'), psm1.indexOf('function Sync-RabbitChain'))
  assert.match(conn, /\[switch\]\$NetworkTools/)
  assert.match(conn, /\[CmdletBinding\(SupportsShouldProcess, ConfirmImpact = 'High'\)\]/)
  assert.match(conn, /\$PSCmdlet\.ShouldProcess\(/)
  assert.match(conn, /if \(-not \$NetworkTools\) \{ return \}/)
  // the extra diagnostics sit after the confirmation, never before it
  assert.ok(conn.indexOf('Resolve-DnsName -Name $h -Type $type') > conn.indexOf('$PSCmdlet.ShouldProcess('))
  assert.ok(conn.indexOf('-TraceRoute') > conn.indexOf('$PSCmdlet.ShouldProcess('))
  const sync = psm1.slice(psm1.indexOf('function Sync-RabbitChain'))
  assert.match(sync, /SupportsShouldProcess/)
  assert.match(sync, /\$PSCmdlet\.ShouldProcess\(\$Path,/)
})

test('default is the normal connection: no proxy unless -Proxy or RABBIT_PROXY', () => {
  const c = code(psm1)
  assert.match(c, /\$p = if \(\$Proxy\) \{ \$Proxy \} elseif \(\$env:RABBIT_PROXY\) \{ \$env:RABBIT_PROXY \} else \{ \$null \}/)
  assert.match(c, /if \(\$Proxy\) \{ \$req\['Proxy'\] = \$Proxy \}/)
  assert.doesNotMatch(c, /Proxy\s*=\s*['"]?https?:\/\//i) // no built-in proxy address
  assert.doesNotMatch(c, /\[string\]\$Proxy\s*=/) // no default value for -Proxy
  assert.doesNotMatch(c, /ProxyUseDefaultCredentials|ProxyCredential|DefaultWebProxy/)
  assert.match(c, /\[string\]\$Origin = \$script:DefaultOrigin/)
  assert.match(c, /\$script:DefaultOrigin = 'https:\/\/app\.rabbitsoftware\.io'/)
})

test('uploads nothing: every request is a bodiless GET, and there is no upload parameter or API', () => {
  const c = code(psm1) + '\n' + code(psd1)
  assert.doesNotMatch(c, /Invoke-RestMethod/i)
  assert.equal([...c.matchAll(/Invoke-WebRequest/g)].length, 1, 'one single network call site')
  assert.match(c, /Method = 'Get'/)
  assert.doesNotMatch(c, /-Method\s+['"]?(Post|Put|Patch|Delete)|Method\s*=\s*['"](Post|Put|Patch|Delete)/i)
  assert.doesNotMatch(c, /-Body\b|-InFile\b|-Form\b|-OutFile\b|-ContentType\b|-Headers\b|-Authentication\b|-Credential\b|-Token\b|-ToCloudShell|-Upload|WebClient|HttpClient|UploadFile|UploadString|UploadData|Send-MailMessage|\sscp\s|\sssh\s/i)
  // the only thing it writes is the ledger copy and its state file, next to each other
  for (const m of c.matchAll(/AppendAllText\(([^,]+),|WriteAllText\(([^,]+),/g)) assert.match(m[1] ?? m[2], /^\$(Path|statePath)$/)
  // the CloudShell hint is the public read command from src/lib/chain-public.ts
  assert.ok(psm1.includes(`Write-Host ('  curl -fsS "' + $o + '/api/chain/ledger?since=0" | head -c 60000')`))
  assert.equal(cloudshellCommand('https://app.rabbitsoftware.io'), 'curl -fsS "https://app.rabbitsoftware.io/api/chain/ledger?since=0" | head -c 60000')
  assert.match(psm1, /does not read the file on this PC/)
  assert.match(psm1, /Nothing was uploaded/)
})

test('no hardcoded tokens or secrets, no vault, env file or private-data paths', () => {
  for (const [name, text] of [['RabbitNet.psm1', psm1], ['RabbitNet.psd1', psd1], ['test-rabbitnet.ps1', selfTest]]) {
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|xox[bp]-|-----BEGIN/, `${name} looks like it holds a secret`)
    assert.doesNotMatch(text, /Authorization|Bearer\s|password\s*=\s*['"][^'"]+['"]|\$env:[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD|SERVICE_ROLE)/i, `${name}: credential handling`)
    assert.doesNotMatch(text, /vault|cloud-access|\.claude|\.env\b|\.env\.|service_role|supabase|\.obsidian/i, `${name} refers to a vault, env file or private path`)
  }
  // the only environment variables read are the documented, non-secret ones
  const envs = new Set([...code(psm1).matchAll(/\$env:([A-Za-z_]+)/g)].map((m) => m[1]))
  assert.deepEqual([...envs].sort(), ['RABBIT_CLOUDSHELL_URL', 'RABBIT_PROXY'])
  // local paths: only the output file the user chooses or the default under their own home folder
  assert.match(psm1, /Join-Path \$HOME 'RabbitOS\/chain_ledger_local\.jsonl'/)
})

test('the PowerShell test vector is built by the TypeScript ledger code and verifies', async () => {
  const fixture = JSON.parse(read('test-vector.json'))
  const rebuilt = await makeVector()
  assert.deepEqual(fixture, JSON.parse(JSON.stringify(rebuilt)), 'test-vector.json is stale: node scripts/powershell/make-test-vector.mjs > scripts/powershell/test-vector.json')
  assert.equal(fixture.length, 4)
  const v = await verifyChain(fixture)
  assert.ok(v.ok)
  // the vector exercises what a port can get wrong: escapes, a lone surrogate, JavaScript number formatting, key order by code unit
  const text = read('test-vector.json')
  assert.match(text, /\\ud800/)
  assert.match(text, /\\u0001/)
  assert.match(JSON.stringify(rebuilt[2].payload), /1e-7|1\.5e\+25|123456789012345680000|1e\+21/)
  // tampering changes the verdict
  const bad = structuredClone(fixture)
  bad[1].payload.id = 'n-2'
  assert.equal((await verifyChain(bad)).ok, false)
})

test('the port refuses a broken chain and resumes from a state file (static)', () => {
  const sync = psm1.slice(psm1.indexOf('function Sync-RabbitChain'))
  assert.match(sync, /Refusing a broken chain at seq/)
  assert.match(sync, /Refusing: the local file/)
  assert.match(sync, /\$statePath = "\$Path\.state\.json"/)
  assert.match(sync, /\/api\/chain\/ledger\?since=\$headSeq/)
  // verification happens before the write in the same loop iteration
  assert.ok(sync.indexOf('Test-RabbitEvents -Events $batch') < sync.indexOf('AppendAllText'))
  // ported algorithm: leaf prefix 0x00, sorted keys, the six hashed fields, the nine ledger tables
  assert.match(psm1, /\$buf\[0\] = 0/)
  assert.match(psm1, /\[array\]::Sort\(\$keys, \[System\.StringComparer\]::Ordinal\)/)
  assert.match(psm1, /\{"op":.*"payload":.*"prev_hash":.*"row_id":.*"seq":.*"table":/s)
  const tables = readFileSync(join(dir, '..', '..', 'src', 'lib', 'chain-ledger.ts'), 'utf8').match(/export const LEDGER_TABLES = \{([\s\S]*?)\n\} as const/)[1]
  for (const t of [...tables.matchAll(/^  (\w+): \{/gm)].map((m) => m[1])) assert.ok(psm1.includes(`'${t}'`), `ledger table ${t} missing from the port`)
})
