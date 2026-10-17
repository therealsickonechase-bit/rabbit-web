<#
.SYNOPSIS
    Makes this PC a Maxwell Core node on rabbitsoftware.io/core: syncs and verifies the public chain, signs a heartbeat, and publishes the heartbeat. -WhatIf shows the plan.
.DESCRIPTION
      1. maxwell-core.mjs sync: downloads the public chain into the node's data folder and verifies every hash, link and work target (a bad chain is refused);
      2. maxwell-core.mjs heartbeat: signs "this software, this platform, this verified head, now" with the node key;
      3. the heartbeat (a small public JSON file) is copied to gs://rabbitsoftware-io-ledger-public/nodes/<name>/heartbeat.json, where the status job reads it
         (site/nodes/registry.json lists the name, the PUBLIC key and that address).
    The PRIVATE key stays in <DataDir>\witness\<name>.key and is never printed or uploaded. Make it once with:  node witness.mjs keygen --name pc-node   (in <DataDir>\witness)
    Log: ~\RabbitOS\logs\core-heartbeat-<date>.log. Exit 0 published, 1 not.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$NodeName = 'pc-node',
    [string]$DataDir = (Join-Path $HOME 'RabbitOS\core'),
    [string]$CoreDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\maxwell-core',
    [string]$PublicBucket = 'rabbitsoftware-io-ledger-public'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$logFile = Join-Path $logDir ("core-heartbeat-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Say($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $logFile -Value $line; Write-Host $line }

$keyFile = Join-Path $DataDir "witness\$NodeName.key"
if (-not (Test-Path $keyFile)) { throw "No key at $keyFile. Create it once: mkdir $DataDir\witness; cd $DataDir\witness; node $CoreDir\witness.mjs keygen --name $NodeName" }
$target = "gs://$PublicBucket/nodes/$NodeName/heartbeat.json"
if ($preview) { Say "What if: sync the chain into $DataDir, sign a heartbeat as $NodeName, copy it to $target."; return }

$core = Join-Path $CoreDir 'maxwell-core.mjs'
$out = node $core sync --datadir $DataDir 2>&1; $code = $LASTEXITCODE
$out | ForEach-Object { Say "  $_" }
if ($code -ne 0) { Say 'NOT signed: the chain did not sync and verify.'; exit 1 }
$out = node $core heartbeat --name $NodeName --datadir $DataDir 2>&1; $code = $LASTEXITCODE
$out | ForEach-Object { Say "  $_" }
if ($code -ne 0) { Say 'NOT signed (heartbeat failed).'; exit 1 }
gcloud storage cp (Join-Path $DataDir 'heartbeat.json') $target --cache-control=no-cache --quiet 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Say 'Signed, but the upload failed.'; exit 1 }
Say "Published $target"
