<#
.SYNOPSIS
    Step 1 of 2 for the cloud miner: copies the RabbitOS ingest secret into Google Secret Manager. Run this one yourself; it is the only miner script that handles a secret value.
.DESCRIPTION
    rabbit-ingest-secret   RABBIT_INGEST_SECRET from research-agents\.env (the same value as the web app's INGEST_SHARED_SECRET)
    The value is read here, passed to gcloud through a temporary file that is deleted at once, and never printed or put on a command line.
    It also creates the account rabbit-miner-job and lets it (and nothing else) read this one secret.
    Safe to run again: an existing secret is kept unless you pass -Refresh. -WhatIf shows the plan.
    Step 2 is Setup-GcpMinerJob.ps1, which holds no secret values.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$EnvFile = 'C:\Users\odaat\Projects\research-agents\.env',
    [switch]$Refresh
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$sa = "rabbit-miner-job@$Project.iam.gserviceaccount.com"; $name = 'rabbit-ingest-secret'
$line = if (Test-Path $EnvFile) { Get-Content $EnvFile | Where-Object { $_ -match '^\s*RABBIT_INGEST_SECRET\s*=' } | Select-Object -First 1 }
$value = if ($line) { ($line -split '=', 2)[1].Trim().Trim('"').Trim("'") }

Step 'Input (the value is never shown)'
Write-Host ("RABBIT_INGEST_SECRET in research-agents\.env: {0}" -f $(if ($value) { 'found' } else { 'MISSING' }))
if (-not $value) { throw 'RABBIT_INGEST_SECRET was not found in research-agents\.env; nothing to store.' }

Step "Secret $name"
if ($preview) { Write-Host "What if: create $name if missing, store a version if there is none (or -Refresh), create rabbit-miner-job and let it read the secret" }
else {
    if (-not (Exists secrets describe $name --project $Project)) {
        Invoke-Gcloud services enable secretmanager.googleapis.com --project $Project
        Invoke-Gcloud secrets create $name --project $Project --replication-policy automatic | Out-Null
        Write-Host "created: $name"
    }
    $hasVersion = Exists secrets versions describe latest --secret $name --project $Project
    if ($Refresh -or -not $hasVersion) {
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('sec-' + [guid]::NewGuid().ToString('N'))
        try { [IO.File]::WriteAllText($tmp, $value); Invoke-Gcloud secrets versions add $name --project $Project --data-file $tmp | Out-Null; Write-Host "stored a new version of $name" }
        finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    } else { Write-Host "kept the existing value of $name" }
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-miner-job --project $Project --display-name 'RabbitOS rabbit-miner-job' }
    foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
        $null = & gcloud secrets add-iam-policy-binding $name --member "serviceAccount:$sa" --role roles/secretmanager.secretAccessor --project $Project 2>&1
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 8
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not let $sa read $name" }
    Write-Host "rabbit-miner-job can read: $name"
}
Write-Host "`nDone. Next: pwsh -File scripts\powershell\Setup-GcpMinerJob.ps1 -RunNow  (or ask Claude to run it)." -ForegroundColor Green
