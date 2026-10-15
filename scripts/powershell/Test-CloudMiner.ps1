<#
.SYNOPSIS
    Checks the cloud miner and the Maxwell chain across all copies. Read-only.
.DESCRIPTION
    1. The newest rabbit-miner execution succeeded.
    2. The public chain in the bucket verifies and agrees with this PC's chain (maxwell_adopt.py in dry-run mode says same / local-ahead / adopt).
    3. The hub's chain_consistency check passes (app, bucket, links).
    4. Lists the newest blocks and who signed them (RABBITWEB_MINER from this PC, RABBITWEB_MINER_CLOUD from the job).
    Prints PASS or FAIL per check and exits 1 if anything failed.
#>
[CmdletBinding()]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [string]$Hub = 'https://rabbitos-hub-mcp-vxx5lz7c5a-wl.a.run.app'
)
$ErrorActionPreference = 'Stop'
$fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') { if (-not $ok) { $script:fail++ }; Write-Host ("{0}  {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($detail) { " - $detail" } else { '' })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) }

$ex = & gcloud run jobs executions list --job rabbit-miner --project $Project --region $Region --limit 1 --format 'value(name,status.completionTime,status.succeededCount,status.failedCount)' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $ex) { Check 'the miner job has run' $false 'no execution yet' }
else { $p = "$ex" -split '\s+'; Check 'newest rabbit-miner execution succeeded' ($p.Count -ge 3 -and $p[2] -eq '1' -and ($p.Count -lt 4 -or $p[3] -in '', '0')) $ex }

Push-Location $AgentsDir
try { $adopt = (python maxwell_adopt.py 2>&1 | Out-String).Trim(); Check 'this PC and the public chain agree or the PC is ahead/behind cleanly' ($LASTEXITCODE -eq 0) $adopt } finally { Pop-Location }

$body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chain_consistency","arguments":{}}}'
try {
    $r = Invoke-RestMethod -Method Post -Uri "$Hub/mcp" -ContentType 'application/json' -Headers @{ Accept = 'application/json, text/event-stream' } -Body $body
    $t = $r.result.content[0].text | ConvertFrom-Json
    Check 'hub chain_consistency (app, bucket, links)' ([bool]$t.allOk) (($t.checks | Where-Object { -not $_.ok } | ForEach-Object { $_.name }) -join '; ')
} catch { Check 'hub chain_consistency' $false $_.Exception.Message }

try {
    $chain = Invoke-RestMethod "https://rabbitsoftware-io-ledger-public.storage.googleapis.com/maxwell/maxwell_chain.json?cb=$([int][double]::Parse((Get-Date -UFormat %s)))"
    Write-Host "`nNewest blocks (public copy, $($chain.blocks.Count) in total):"
    $chain.blocks | Select-Object -Last 5 | ForEach-Object { "  #{0}  {1}  {2}" -f $_.index, ($_.transactions[0].sender), $_.hash.Substring(0, 16) }
} catch { Write-Host 'could not read the public chain' -ForegroundColor Yellow }
Write-Host ''
if ($fail) { Write-Host "$fail check(s) failed." -ForegroundColor Red; exit 1 } else { Write-Host 'All checks passed.' -ForegroundColor Green }
