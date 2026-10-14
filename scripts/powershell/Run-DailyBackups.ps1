<#
.SYNOPSIS
    Runs the daily backups: Google Cloud copy of the public ledger and datasets, the Maxwell files, and the platform (Supabase, Cloudflare, repos).
.DESCRIPTION
    Meant for Windows Task Scheduler. Starts Docker Desktop if it is not running (the Supabase dump needs it), runs each step independently so one failure
    does not stop the others, writes a log to ~\RabbitOS\logs\backup-<date>.log (the newest 30 are kept) and exits 1 if any step failed.
    No secrets are read here; the called scripts read them from where you already keep them and never print them.
#>
$ErrorActionPreference = 'Continue'
$scripts = $PSScriptRoot
$logDir = Join-Path $HOME 'RabbitOS\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("backup-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) | Tee-Object -FilePath $log -Append }
$failed = 0

Log 'daily backup started'
# Docker is only needed for the Supabase dump. Start it if needed and wait up to 4 minutes.
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) {
        Log 'Docker is not running; starting Docker Desktop'
        Start-Process $dd
        for ($i = 0; $i -lt 24; $i++) { Start-Sleep -Seconds 10; docker info 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { break } }
    }
}

$steps = @(
    @{ Name = 'Google: public ledger + datasets'; Script = 'Sync-RabbitGcs.ps1'; Params = @{ Ledger = $true; Exports = $true } },
    @{ Name = 'Google: Maxwell files';            Script = 'Sync-RabbitGcs.ps1'; Params = @{ Maxwell = $true } },
    @{ Name = 'Platform: Supabase, Cloudflare, repos'; Script = 'Backup-Platform.ps1'; Params = @{} }
)
foreach ($s in $steps) {
    Log "START $($s.Name)"
    try {
        $p = $s.Params
        $out = & (Join-Path $scripts $s.Script) @p 2>&1 | Out-String
        $out.TrimEnd() -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { Add-Content $log "    $_" }
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        Log "OK    $($s.Name)"
    } catch { $failed++; Log "FAIL  $($s.Name): $($_.Exception.Message)" }
}

# Keep the newest 30 logs and the newest 7 local dated backup folders (the cloud copies are versioned and kept for a year).
Get-ChildItem $logDir -Filter 'backup-*.log' | Sort-Object Name -Descending | Select-Object -Skip 30 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$pb = Join-Path $HOME 'RabbitOS\platform-backup'
if (Test-Path $pb) { Get-ChildItem $pb -Directory | Sort-Object Name -Descending | Select-Object -Skip 7 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force } }

Log ("daily backup finished; failed steps: $failed")
exit ([int]($failed -gt 0))
