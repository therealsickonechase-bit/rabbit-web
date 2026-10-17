<#
.SYNOPSIS
    The PC's witness of the Maxwell chain: re-checks the PUBLIC chain with two separate implementations and, only if both pass, signs the head and publishes the signature. -WhatIf shows the plan.
.DESCRIPTION
    A witness is a peer that checks the chain on its own and signs what it verified (docs/peer-review.md). This one runs on the owner's PC:
      1. the Python reference verifier (scripts/verify-maxwell.py, no research-record rebuild) must pass on the public Google Cloud copy;
      2. the JavaScript witness (scripts/witness.mjs) downloads the same public copy, recomputes every hash, link and work target, checks that it still extends the head this witness
         signed last time (a different history at the same position is refused as a conflict), and signs the new head with this witness's own Ed25519 key;
      3. the signature (a small public JSON file) is copied to gs://rabbitsoftware-io-ledger-public/witness/pc-witness/cosignature.json.
    The PRIVATE key stays in ~\RabbitOS\witness\pc-witness.key and is never printed, logged or uploaded. If either check fails nothing is signed and the old signature stays (and ages).
    Log: ~\RabbitOS\logs\witness-<date>.log. Exit 0 signed, 1 not signed or upload failed.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$WitnessName = 'pc-witness',
    [string]$WitnessDir = (Join-Path $HOME 'RabbitOS\witness'),
    [string]$ToolsDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\scripts',
    [string]$PublicBucket = 'rabbitsoftware-io-ledger-public'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$witnessLogDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $witnessLogDir | Out-Null
$witnessLogFile = Join-Path $witnessLogDir ("witness-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Say($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $witnessLogFile -Value $line; Write-Host $line }

$keyFile = Join-Path $WitnessDir "$WitnessName.key"
if (-not (Test-Path $keyFile)) { throw "No key at $keyFile. Create it once with: node witness.mjs keygen --name $WitnessName (in $WitnessDir)" }
if ($preview) { Say "What if: Python verifier on the public chain, then 'witness.mjs run' as $WitnessName, then copy the cosignature to gs://$PublicBucket/witness/$WitnessName/cosignature.json."; return }

Say 'Check 1 of 2: the Python reference verifier on the public chain...'
$pyOut = python (Join-Path $ToolsDir 'verify-maxwell.py') --no-records 2>&1
$pyExit = $LASTEXITCODE
$pyOut | ForEach-Object { Say "  $_" }
if ($pyExit -ne 0) { Say 'NOT signed: the Python verifier did not pass.'; exit 1 }

Say 'Check 2 of 2: the JavaScript witness...'
Push-Location $WitnessDir
try {
    $jsOut = node (Join-Path $ToolsDir 'witness.mjs') run --name $WitnessName --key $keyFile 2>&1
    $jsExit = $LASTEXITCODE
    $jsOut | ForEach-Object { Say "  $_" }
    if ($jsExit -ne 0) { Say "NOT signed (witness exit $jsExit)."; exit 1 }
    $target = "gs://$PublicBucket/witness/$WitnessName/cosignature.json"
    gcloud storage cp (Join-Path $WitnessDir "$WitnessName.cosignature.json") $target --cache-control=no-cache --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Say 'Signed, but the upload failed.'; exit 1 }
    Say "Published $target"
} finally { Pop-Location }
