<#
.SYNOPSIS
    Step 1 of 2 for the cloud backup: copies the two secrets the backup job needs into Google Secret Manager. Run this one yourself; it is the only script that handles secret values.
.DESCRIPTION
    rabbit-supabase-db-url   SUPABASE_DB_URL from rabbit-web\.env.local
    rabbit-cf-backup-token   the read-only Cloudflare token in the user variable RABBIT_CF_BACKUP_TOKEN (optional: without it only Supabase is backed up)
    Values are read here, passed to gcloud through a temporary file that is deleted at once, and never printed or put on a command line.
    It also creates the account rabbit-backup-job and lets it (and nothing else) read these two secrets.
    Safe to run again: existing secrets are kept unless you pass -Refresh. -WhatIf shows the plan.
    Step 2 is Setup-GcpBackupJob.ps1, which holds no secret values.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$EnvFile = 'C:\Users\odaat\Projects\rabbit-web\.env.local',
    [switch]$Refresh
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Get-EnvValue($file, $name) {
    if (-not (Test-Path $file)) { return $null }
    $line = Get-Content $file | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if (-not $line) { return $null }
    ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}
$jobSa = "rabbit-backup-job@$Project.iam.gserviceaccount.com"
$dbUrl = Get-EnvValue $EnvFile 'SUPABASE_DB_URL'
$cfToken = [Environment]::GetEnvironmentVariable('RABBIT_CF_BACKUP_TOKEN', 'User'); if (-not $cfToken) { $cfToken = $env:RABBIT_CF_BACKUP_TOKEN }

Step 'Inputs (values are never shown)'
Write-Host ("SUPABASE_DB_URL in .env.local: {0}" -f $(if ($dbUrl) { 'found' } else { 'MISSING' }))
Write-Host ("RABBIT_CF_BACKUP_TOKEN: {0}" -f $(if ($cfToken) { 'found' } else { 'not set (the Cloudflare parts will be skipped)' }))
if (-not $dbUrl) { throw 'SUPABASE_DB_URL was not found in .env.local; nothing to store.' }

foreach ($pair in @(@('rabbit-supabase-db-url', $dbUrl), @('rabbit-cf-backup-token', $cfToken))) {
    $name, $value = $pair
    Step "Secret $name"
    if ($preview) { Write-Host "What if: create $name if missing, store a version if there is none (or -Refresh), let $jobSa read it"; continue }
    if (-not (Exists secrets describe $name --project $Project)) {
        Invoke-Gcloud services enable secretmanager.googleapis.com --project $Project
        Invoke-Gcloud secrets create $name --project $Project --replication-policy automatic | Out-Null
        Write-Host "created: $name"
    }
    $hasVersion = Exists secrets versions describe latest --secret $name --project $Project
    if ($value -and ($Refresh -or -not $hasVersion)) {
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('sec-' + [guid]::NewGuid().ToString('N'))
        try { [IO.File]::WriteAllText($tmp, $value); Invoke-Gcloud secrets versions add $name --project $Project --data-file $tmp | Out-Null; Write-Host "stored a new version of $name" }
        finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    } elseif ($hasVersion) { Write-Host "kept the existing value of $name" } else { Write-Host "no value for $name (skipped)" }
}

Step 'Account that may read them'
if ($preview) { Write-Host "What if: create rabbit-backup-job and let it read the two secrets" }
else {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-backup-job --project $Project --display-name 'RabbitOS rabbit-backup-job' }
    foreach ($name in 'rabbit-supabase-db-url', 'rabbit-cf-backup-token') {
        if (-not (Exists secrets describe $name --project $Project)) { continue }
        foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
            $null = & gcloud secrets add-iam-policy-binding $name --member "serviceAccount:$jobSa" --role roles/secretmanager.secretAccessor --project $Project 2>&1
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 8
        }
        if ($LASTEXITCODE -ne 0) { throw "Could not let $jobSa read $name" }
        Write-Host "rabbit-backup-job can read: $name"
    }
}
Write-Host "`nDone. Next: pwsh -File scripts\powershell\Setup-GcpBackupJob.ps1 -RunNow  (or ask Claude to run it)." -ForegroundColor Green
