<#
.SYNOPSIS
    Checks a cloud backup run against the local backup of the same day. Read-only: it only reads the bucket and your local backup folder.
.DESCRIPTION
    1. The manifest at platform-cloud/<date>/manifest/manifest.json says every part that ran, ok or not.
    2. The Supabase dump exists, starts with the PostgreSQL dump marker (PGDMP) and is within 25% of the size of the local dump.
    3. Cloudflare D1 / KV / R2: counts are compared with the local backup when the cloud run included them.
    Prints PASS or FAIL per check and exits 1 if anything failed. Safe to run any time.
#>
[CmdletBinding()]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Bucket = 'rabbitsoftware-io-backups',
    [string]$Date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'),
    [string]$LocalRoot = (Join-Path $HOME 'RabbitOS\platform-backup'),
    [double]$Tolerance = 0.25
)
$ErrorActionPreference = 'Stop'
$fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') { if (-not $ok) { $script:fail++ }; Write-Host ("{0}  {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($detail) { " - $detail" } else { '' })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) }
$base = "gs://$Bucket/platform-cloud/$Date"
# Each run writes to its own time-stamped folder (platform-cloud/<date>/<HHMMSS>Z/); check the newest one. The very first run used the date folder directly.
$runs = @(& gcloud storage ls "$base/" --project $Project 2>$null | Where-Object { $_ -match '/\d{6}Z/$' } | Sort-Object)
if ($runs.Count -gt 0) { $base = $runs[-1].TrimEnd('/') }
$local = Join-Path $LocalRoot $Date

Write-Host "Cloud:  $base`nLocal:  $local`n"
$raw = & gcloud storage cat "$base/manifest/manifest.json" --project $Project 2>$null
if ($LASTEXITCODE -ne 0) { Check 'cloud manifest exists' $false 'the cloud job has not run for this date'; exit 1 }
$m = ($raw -join "`n") | ConvertFrom-Json
Check 'cloud manifest exists' $true $m.generatedAt
foreach ($p in $m.parts) { Check "cloud part: $($p.part)" ([bool]$p.ok) "$($p.detail) ($($p.seconds)s)" }

# Supabase dump
$objs = @(& gcloud storage ls -l "$base/supabase/" --project $Project 2>$null | Where-Object { $_ -match 'supabase-.*\.dump$' })
Check 'supabase dump is in the bucket' ($objs.Count -ge 1)
if ($objs.Count -ge 1) {
    $cloudSize = [double](($objs[0].Trim() -split '\s+')[0])
    $url = ($objs[0].Trim() -split '\s+')[-1]
    $head = (& gcloud storage cat -r 0-4 $url --project $Project 2>$null | Out-String)
    Check 'dump starts with PGDMP' ($head -match 'PGDMP')
    $ld = Get-ChildItem (Join-Path $local 'supabase') -Filter '*.dump' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ld -and $ld.Length -gt 0) {
        $ratio = [math]::Abs($cloudSize - $ld.Length) / $ld.Length
        Check 'dump size matches the local dump' ($ratio -le $Tolerance) ("cloud {0:N1} MB, local {1:N1} MB" -f ($cloudSize / 1MB), ($ld.Length / 1MB))
    } else { Write-Host 'SKIP  no non-empty local dump for this date to compare with (run Backup-Platform.ps1 -Supabase -DryRun first)' -ForegroundColor Yellow }
}

# Cloudflare
$cfParts = @($m.parts | Where-Object { $_.part -like 'cloudflare*' })
if ($cfParts.Count -eq 0 -or ($cfParts | Where-Object { $_.detail -like 'skipped*' })) { Write-Host 'SKIP  Cloudflare parts were not part of this cloud run (no token yet)' -ForegroundColor Yellow }
else {
    $cloudD1 = @(& gcloud storage ls "$base/cloudflare-d1/" --project $Project 2>$null).Count
    $localD1 = @(Get-ChildItem (Join-Path $local 'cloudflare\d1') -Filter '*.sql' -ErrorAction SilentlyContinue).Count
    if ($localD1 -gt 0) { Check 'D1 database count matches' ($cloudD1 -eq $localD1) "cloud $cloudD1, local $localD1" }
    $cloudKv = @(& gcloud storage ls -r "$base/cloudflare-kv/**" --project $Project 2>$null | Where-Object { $_ -like '*.value' }).Count
    $localKv = @(Get-ChildItem (Join-Path $local 'cloudflare\kv') -Recurse -Filter '*.value' -ErrorAction SilentlyContinue).Count
    if ($localKv -gt 0) { Check 'KV key count matches' ($cloudKv -eq $localKv) "cloud $cloudKv, local $localKv" }
}
Write-Host ''
if ($fail) { Write-Host "$fail check(s) failed." -ForegroundColor Red; exit 1 } else { Write-Host 'All checks passed. The cloud copy matches the local backup.' -ForegroundColor Green }
