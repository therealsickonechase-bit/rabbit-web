<#
.SYNOPSIS
    Copies your Obsidian vault to Google Cloud: gs://rabbitsoftware-io-vault-private/vault/ (private, versioned). One-way: the vault is never changed. -WhatIf lists what would be uploaded.
.DESCRIPTION
    WHAT IS COPIED  the files your private GitHub sync takes: `git ls-files -co --exclude-standard` in the vault (tracked and new files, minus what .gitignore leaves out), minus -Exclude.
                    By default -Exclude is Local/EEG/ (personal EEG data stays on the PC) and 'Local/RabbitOS folder/' (a view of ~\RabbitOS: logs and the platform backups, which have their own bucket).
                    Pass -Exclude @() to send everything the GitHub sync sends.
                    That is the real vault. The big linked folders (Computer, Repos, Drive/OneDrive/Downloads libraries, Claude, ...) are links to other places on this PC and are NOT followed.
                    -Include 'Name1','Name2' adds specific folders from the vault root on purpose.
    HOW             the files are copied into a staging folder (%LOCALAPPDATA%\RabbitOS\vault-stage, only what changed), then `gcloud storage rsync` uploads the differences. Nothing is deleted in the
                    bucket unless you pass -MirrorDeletes (and even then the bucket is versioned, so deleted notes are kept 90 days).
    WHERE           needs the bucket from Setup-GcpVaultBucket.ps1 and `gcloud auth login` as you.
    LOG             ~\RabbitOS\logs\vault-gcs-<date>.log (newest 14 kept). One run at a time.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Vault = (Join-Path $HOME 'Documents\RabbitOS Vault'),
    [string]$Project = 'rabbitsoftware-io',
    [string]$Bucket = 'rabbitsoftware-io-vault-private',
    [string[]]$Include = @(),
    [string[]]$Exclude = @('Local/RabbitOS folder/', 'Local/EEG/'),
    [switch]$MirrorDeletes,
    [string]$Stage = (Join-Path $env:LOCALAPPDATA 'RabbitOS\vault-stage')
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("vault-gcs-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $log -Value $line; Write-Host $line }

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\RabbitOS-Vault-GCS', [ref]$created)
if (-not $created) { Log 'another vault upload is still running; skipping'; return }
try {
    if (-not (Test-Path -LiteralPath (Join-Path $Vault '.git'))) { throw "Not a git vault: $Vault" }
    Push-Location -LiteralPath $Vault
    try {
        $files = @(git -c core.quotepath=false ls-files -co --exclude-standard)
        foreach ($name in $Include) {
            if ($name -notmatch '^[^\\/:*?"<>|]+$') { throw "-Include takes folder names at the vault root, got '$name'" }
            $root = Join-Path $Vault $name
            if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "No such folder in the vault: $name" }
            $files += @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -Attributes !ReparsePoint | ForEach-Object { $_.FullName.Substring($Vault.Length + 1) -replace '\\', '/' })
        }
    } finally { Pop-Location }
    # Left out by default: 'Local/RabbitOS folder/' is a view of ~\RabbitOS (this script's own staging, the logs, and the platform backups, which have their own bucket) and 'Local/EEG/' is
    # personal EEG data, which this project keeps on the PC. Pass -Exclude @() to send everything the private GitHub sync sends.
    $files = @($files | Where-Object { $rel = $_; -not ($Exclude | Where-Object { $rel.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }) })
    $files = @($files | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $Vault $_) -PathType Leaf) } | Sort-Object -Unique)
    $bytes = ($files | ForEach-Object { (Get-Item -LiteralPath (Join-Path $Vault $_) -Force).Length } | Measure-Object -Sum).Sum
    Log ("{0} files, {1:N0} MB in the set" -f $files.Count, ($bytes / 1MB))
    if ($preview) {
        Write-Host "What if: copy changed files into $Stage, then gcloud storage rsync to gs://$Bucket/vault/ (project $Project)$(if ($MirrorDeletes) { ', deleting bucket copies of notes you removed' })"
        $files | Select-Object -First 15 | ForEach-Object { Write-Host "  $_" }
        if ($files.Count -gt 15) { Write-Host "  ... and $($files.Count - 15) more" }
        return
    }
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'gcloud is not installed or not on PATH.' }

    # 1. Stage: copy what changed, drop what is no longer in the set.
    New-Item -ItemType Directory -Force $Stage | Out-Null
    $copied = 0
    foreach ($rel in $files) {
        $src = Join-Path $Vault $rel; $dst = Join-Path $Stage $rel
        $si = Get-Item -LiteralPath $src -Force
        if (-not (Test-Path -LiteralPath $dst) -or (Get-Item -LiteralPath $dst -Force).Length -ne $si.Length -or (Get-Item -LiteralPath $dst -Force).LastWriteTimeUtc -ne $si.LastWriteTimeUtc) {
            New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
            Copy-Item -LiteralPath $src -Destination $dst -Force
            (Get-Item -LiteralPath $dst -Force).LastWriteTimeUtc = $si.LastWriteTimeUtc
            $copied++
        }
    }
    $keep = [System.Collections.Generic.HashSet[string]]::new([string[]]($files | ForEach-Object { ($_ -replace '/', '\') }), [StringComparer]::OrdinalIgnoreCase)
    $removed = 0
    Get-ChildItem -LiteralPath $Stage -Recurse -File -Force | ForEach-Object {
        if (-not $keep.Contains($_.FullName.Substring($Stage.Length + 1))) { Remove-Item -LiteralPath $_.FullName -Force; $removed++ }
    }
    Log "staged: $copied copied, $removed removed from the staging folder"

    # 2. Upload the differences.
    $args2 = @('storage', 'rsync', '--recursive', '--project', $Project, $Stage, "gs://$Bucket/vault")
    if ($MirrorDeletes) { $args2 += '--delete-unmatched-destination-objects' }
    $out = & gcloud @args2 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Add-Content $log ($out -split "`r?`n" | Select-Object -Last 15 | ForEach-Object { "    $_" }); throw "gcloud storage rsync failed (exit $LASTEXITCODE)" }
    ($out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 4) | ForEach-Object { Add-Content $log "    $_" }
    Log "uploaded to gs://$Bucket/vault/"
    . (Join-Path $PSScriptRoot 'Write-CloudLog.ps1')
    Write-CloudLog -Job 'vault-upload' -Event 'upload_done' -Ok $true -Fields @{ bucket = $Bucket } -CacheFolders @((Join-Path $env:LOCALAPPDATA 'RabbitOS\vault-stage'))
    Get-ChildItem $logDir -Filter 'vault-gcs-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Force -ErrorAction SilentlyContinue
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
