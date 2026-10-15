<#
.SYNOPSIS
    Backs up the RabbitOS / rabbitsoftware platform to your private Google Cloud bucket: Supabase, Cloudflare (D1, KV, R2) and git repositories.
.DESCRIPTION
    Writes everything to a dated local folder, then uploads it to gs://rabbitsoftware-io-backups/platform/<date>/ with the gcloud account logged in on this PC.
    Secrets are read from places you already keep them and are never printed or written to the backup:
      Supabase   SUPABASE_DB_URL from rabbit-web\.env.local, passed to Docker through the process environment (not the command line).
      Cloudflare D1 and KV use your existing `wrangler login`. R2 listing needs RABBIT_CF_BACKUP_TOKEN (a read-only token, see below); without it R2 is skipped.
    Select parts with -Supabase, -Cloudflare, -Repos (default: all). -DryRun does everything locally and uploads nothing.

    Read-only Cloudflare token for R2 (create once, in the dashboard): My Profile > API Tokens > Create Custom Token, permissions
    Account > Workers R2 Storage > Read, then store it with
      [Environment]::SetEnvironmentVariable('RABBIT_CF_BACKUP_TOKEN', '<paste token>', 'User')
.EXAMPLE
    .\Backup-Platform.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$Supabase,
    [switch]$Cloudflare,
    [switch]$Repos,
    [switch]$DryRun,
    [string]$Bucket = 'rabbitsoftware-io-backups',
    [string]$ProjectsRoot = 'C:\Users\odaat\Projects',
    [string]$EnvFile = 'C:\Users\odaat\Projects\rabbit-web\.env.local',
    [string]$CloudflareRepo = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare',
    [string]$WorkRoot = (Join-Path $HOME 'RabbitOS\platform-backup')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
if (-not ($Supabase -or $Cloudflare -or $Repos)) { $Supabase = $true; $Cloudflare = $true; $Repos = $true }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$out = Join-Path $WorkRoot $stamp
New-Item -ItemType Directory -Force $out | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
function Add-Result($name, $ok, $detail) { $results.Add([pscustomobject]@{ Part = $name; Ok = $ok; Detail = $detail }) }
# Progress lines (with the time) so a log shows where a slow or killed run stopped.
function Step($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Get-EnvValue($file, $name) {
    $line = Get-Content $file | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if (-not $line) { return $null }
    ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

# ---- Supabase: full pg_dump through Docker (schemas public, auth, storage) -----------------------------------------
if ($Supabase) {
    Step 'Supabase dump'
    try {
        $url = Get-EnvValue $EnvFile 'SUPABASE_DB_URL'
        if (-not $url) { throw 'SUPABASE_DB_URL not found in .env.local' }
        # Supabase's pooler wants the user as postgres.<project-ref> and requires SSL. Fix both here without printing anything.
        if ($url -match '@[^/]*pooler\.supabase\.com') {
            $ref = ((Get-EnvValue $EnvFile 'NEXT_PUBLIC_SUPABASE_URL') -replace '^https?://([^.]+)\..*$', '$1')
            if ($ref -and $url -match '^(postgres(?:ql)?://)postgres:') { $url = $url -replace '^(postgres(?:ql)?://)postgres:', ('${1}postgres.' + $ref + ':') }
        }
        if ($url -notmatch 'sslmode=') { $url += $(if ($url -match '\?') { '&sslmode=require' } else { '?sslmode=require' }) }
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found' }
        docker info 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Docker is not running' }
        $dir = Join-Path $out 'supabase'; New-Item -ItemType Directory -Force $dir | Out-Null
        $env:RABBIT_PGURL = $url   # read by docker from this process's environment, so it never appears on a command line
        $dumpName = "supabase-$stamp.dump"
        $dumpCmd = 'pg_dump "$RABBIT_PGURL" --format=custom --no-owner --no-privileges -n public -n auth -n storage -f /out/' + $dumpName
        docker run --rm -e RABBIT_PGURL -v "${dir}:/out" postgres:17-alpine sh -c $dumpCmd 2>&1 | ForEach-Object { $_ -replace 'postgres(ql)?://\S+', 'postgres://<hidden>' } | Select-Object -Last 5
        if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
        $f = Join-Path $dir $dumpName
        if (-not (Test-Path $f) -or (Get-Item $f).Length -lt 1024) { throw 'dump file missing or empty' }
        Add-Result 'supabase' $true ("{0:N1} KB" -f ((Get-Item $f).Length / 1KB))
    } catch { Add-Result 'supabase' $false $_.Exception.Message }
    finally { Remove-Item Env:RABBIT_PGURL -ErrorAction SilentlyContinue }
}

# ---- Cloudflare: D1 export, KV key/values, R2 objects ------------------------------------------------------------
if ($Cloudflare) {
    Step 'Cloudflare: D1, KV, R2'
    Push-Location $CloudflareRepo
    try {
        $cf = Join-Path $out 'cloudflare'; New-Item -ItemType Directory -Force "$cf\d1", "$cf\kv", "$cf\r2" | Out-Null
        # D1
        try {
            $raw = npx wrangler d1 list --json 2>$null | Out-String
            $dbs = @(($raw.Substring($raw.IndexOf('[')) | ConvertFrom-Json) | ForEach-Object { $_.name })
            foreach ($db in $dbs) { npx wrangler d1 export $db --remote --output "$cf\d1\$db.sql" 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { throw "d1 export failed: $db" } }
            Add-Result 'cloudflare-d1' $true "$($dbs.Count) databases"
        } catch { Add-Result 'cloudflare-d1' $false $_.Exception.Message }
        # KV
        try {
            $raw = npx wrangler kv namespace list 2>$null | Out-String
            $nss = @($raw.Substring($raw.IndexOf('[')) | ConvertFrom-Json); $keys = 0
            foreach ($ns in $nss) {
                $kd = Join-Path "$cf\kv" $ns.title; New-Item -ItemType Directory -Force $kd | Out-Null
                $kr = npx wrangler kv key list --namespace-id $ns.id --remote 2>$null | Out-String
                $klist = @($kr.Substring($kr.IndexOf('[')) | ConvertFrom-Json)
                ($klist | ConvertTo-Json -Depth 5) | Set-Content (Join-Path $kd '_keys.json') -Encoding utf8
                $i = 0
                foreach ($k in $klist) { $i++; npx wrangler kv key get $k.name --namespace-id $ns.id --remote 2>$null | Set-Content (Join-Path $kd ("{0:D4}.value" -f $i)) -Encoding utf8; $keys++ }
            }
            Add-Result 'cloudflare-kv' $true "$($nss.Count) namespaces, $keys keys"
        } catch { Add-Result 'cloudflare-kv' $false $_.Exception.Message }
        # R2 (needs the read-only token)
        $tok = [Environment]::GetEnvironmentVariable('RABBIT_CF_BACKUP_TOKEN', 'User'); if (-not $tok) { $tok = $env:RABBIT_CF_BACKUP_TOKEN }
        if (-not $tok) { Add-Result 'cloudflare-r2' $false 'skipped: RABBIT_CF_BACKUP_TOKEN is not set' }
        else {
            try {
                $h = @{ Authorization = "Bearer $tok" }
                $acct = (Invoke-RestMethod 'https://api.cloudflare.com/client/v4/accounts' -Headers $h).result | Select-Object -First 1
                $buckets = (Invoke-RestMethod "https://api.cloudflare.com/client/v4/accounts/$($acct.id)/r2/buckets" -Headers $h).result.buckets
                $n = 0
                foreach ($b in $buckets) {
                    $cursor = $null
                    do {
                        $q = "per_page=1000" + $(if ($cursor) { "&cursor=$([uri]::EscapeDataString($cursor))" } else { '' })
                        $l = Invoke-RestMethod "https://api.cloudflare.com/client/v4/accounts/$($acct.id)/r2/buckets/$($b.name)/objects?$q" -Headers $h
                        foreach ($o in $l.result) {
                            $dest = Join-Path "$cf\r2\$($b.name)" ($o.key -replace '/', '\')
                            New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
                            Invoke-WebRequest "https://api.cloudflare.com/client/v4/accounts/$($acct.id)/r2/buckets/$($b.name)/objects/$([uri]::EscapeDataString($o.key))" -Headers $h -OutFile $dest
                            $n++
                        }
                        $cursor = if ($l.PSObject.Properties['result_info'] -and $l.result_info) { $l.result_info.cursor } else { $null }
                    } while ($cursor)
                }
                Add-Result 'cloudflare-r2' $true "$($buckets.Count) buckets, $n objects"
            } catch { Add-Result 'cloudflare-r2' $false $_.Exception.Message }
        }
    } finally { Pop-Location }
}

# ---- Git repositories: one bundle each (full history, all branches and tags) --------------------------------------
if ($Repos) {
    Step 'Git repository bundles'
    try {
        $rd = Join-Path $out 'repos'; New-Item -ItemType Directory -Force $rd | Out-Null; $n = 0
        foreach ($d in Get-ChildItem $ProjectsRoot -Directory) {
            if (-not (Test-Path (Join-Path $d.FullName '.git'))) { continue }
            git -C $d.FullName bundle create (Join-Path $rd "$($d.Name).bundle") --all 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $n++ }
        }
        Add-Result 'git-repos' ($n -gt 0) "$n bundles"
    } catch { Add-Result 'git-repos' $false $_.Exception.Message }
}

Step 'Upload'
# ---- Upload ----------------------------------------------------------------------------------------------------
$total = (Get-ChildItem $out -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
if ($DryRun) { Add-Result 'upload' $true ("skipped (dry run); {0:N2} MB ready in {1}" -f ($total / 1MB), $out) }
else {
    try {
        gcloud storage rsync $out "gs://$Bucket/platform/$stamp" --recursive --quiet 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'gcloud storage rsync failed' }
        Add-Result 'upload' $true ("{0:N2} MB -> gs://{1}/platform/{2}/" -f ($total / 1MB), $Bucket, $stamp)
    } catch { Add-Result 'upload' $false $_.Exception.Message }
}
$results | Format-Table -AutoSize | Out-String | Write-Host
if (@($results | Where-Object { -not $_.Ok -and $_.Detail -notmatch '^skipped' }).Count) { exit 1 }
