<#
.SYNOPSIS
    Packs every GitHub Live mirror into a verified git bundle and copies the bundles to Google Cloud: gs://rabbitsoftware-io-vault-private/github-bundles/ (private, versioned). -WhatIf shows the plan.
.DESCRIPTION
    This is the pathway that does not need GitHub at all. The mirrors in <vault>\GitHub Live\Repositories were taken while the organisation's admin account worked; github-bundles.py turns each one
    into <owner>/<repo>.bundle (full history, all branches and tags, checked with `git bundle verify`) plus manifest.json (head commit, commit count, size, SHA-256, one root hash for everything).
    Only repos whose refs changed since the last run are re-bundled. Then `gcloud storage rsync` uploads the differences. The mirrors are never changed and nothing is deleted in the bucket.
    Restore any repo with Restore-GithubMirror.ps1. Private repos (vault-secrets and others) go to the same private bucket; the bucket is not public.
    LOG  ~\RabbitOS\logs\github-bundles-<date>.log
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Vault = (Join-Path $HOME 'Documents\RabbitOS Vault'),
    [string]$Bucket = 'rabbitsoftware-io-vault-private',
    [string]$Stage = (Join-Path $env:LOCALAPPDATA 'RabbitOS\github-bundles'),
    [string]$Script = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\scripts\github-bundles.py'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("github-bundles-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $log -Value $line; Write-Host $line }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'gcloud is not installed or not on PATH.' }
if (-not (Test-Path (Join-Path $Vault 'GitHub Live\Repositories'))) { throw "No mirrors found under $Vault\GitHub Live\Repositories" }

if ($preview) {
    Log "What if: bundle every mirror under $Vault\GitHub Live\Repositories into $Stage, then upload to gs://$Bucket/github-bundles/ (nothing deleted)."
    return
}
Log 'Bundling mirrors...'
python $Script --vault $Vault --out $Stage 2>&1 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) { throw 'Bundling reported a problem; nothing was uploaded.' }
Log "Uploading to gs://$Bucket/github-bundles/ ..."
gcloud storage rsync $Stage "gs://$Bucket/github-bundles" --recursive --quiet 2>&1 | Select-Object -Last 3 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
$m = Get-Content (Join-Path $Stage 'manifest.json') -Raw | ConvertFrom-Json
Log ("Done. {0} repositories, manifest root {1}." -f $m.repositories.Count, $m.root.Substring(0, 16))
