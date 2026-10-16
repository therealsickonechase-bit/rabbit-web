<#
.SYNOPSIS
    Copies RabbitOS public data and your Maxwell node files into Google Cloud Storage buckets you own.
.DESCRIPTION
    Uses the `gcloud` CLI and whatever Google account is logged in on this PC. No keys, tokens or passwords are read, written or printed.

    -Ledger   (default) Pulls the PUBLIC chain ledger, verifies the hash chain with RabbitNet.psm1 and uploads it to the PUBLIC bucket
              (gs://rabbitsoftware-io-ledger-public/ledger/). A broken chain is never uploaded.
    -Exports  Downloads each PUBLIC data-hub dataset (research, agents, scores, audit, merkle batches, ledger summary) as NDJSON
              and uploads it to the PRIVATE bucket (gs://rabbitsoftware-io-backups/exports/<date>/).
    -MaxwellPath  Uploads the files you list (and only those) to the PRIVATE bucket (gs://rabbitsoftware-io-backups/maxwell/<date>/).
              Nothing is chosen for you, so private research stays private unless you name it.

    Every upload is a new version (bucket versioning is on), so an overwrite or a wipe cannot destroy history.
.EXAMPLE
    .\Sync-RabbitGcs.ps1
.EXAMPLE
    .\Sync-RabbitGcs.ps1 -Exports -MaxwellPath C:\Users\odaat\Projects\research-agents\chain_ledger_local.jsonl -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Ledger,
    [switch]$Exports,
    [switch]$Maxwell,
    [string]$MaxwellRoot = 'C:\Users\odaat\Projects\research-agents',
    [string[]]$MaxwellPath = @(),
    [string]$Origin = 'https://app.rabbitsoftware.io',
    [string]$PublicBucket = 'rabbitsoftware-io-ledger-public',
    [string]$PrivateBucket = 'rabbitsoftware-io-backups',
    [string]$WorkDir = (Join-Path $HOME 'RabbitOS')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
# -WhatIf means "do not upload". Local reads and files still happen, so the ledger check and the export files are real.
$dry = [bool]$WhatIfPreference
$WhatIfPreference = $false
if (-not ($Ledger -or $Exports -or $Maxwell -or $MaxwellPath.Count)) { $Ledger = $true }

# The Maxwell groups the owner chose (explicit names, nothing discovered): research stores, chain and ledger state, twin state, personal EEG / self data.
$MaxwellFiles = @(
    'corpus.json', 'research_store.json', 'crispr_records.json', 'crispr_cache.json', 'crispr_store.json',
    'neuro_records.json', 'neuro_gene_counts.json', 'brain_records.json', 'physics_records.json',
    'maxwell_chain.json', 'network_ledger.json', 'token_ledger.json', 'system_audit.jsonl', '.rabbit_sync_state.json', 'project_manifest.json',
    'dna_state.json'
)
$MaxwellDirs = @('data', 'eeg_data', 'eeg_runs', 'selfdata', 'twinnet', 'dna_index')
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'gcloud is not installed or not on PATH.' }
New-Item -ItemType Directory -Force $WorkDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$Origin = $Origin.TrimEnd('/')

function Copy-ToBucket {
    param([string]$Local, [string]$Dest)
    if ($dry) { Write-Host "What if: would upload $(Split-Path $Local -Leaf) -> $Dest"; return }
    gcloud storage cp $Local $Dest --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "upload failed: $Dest" }
    Write-Host "uploaded -> $Dest"
}

if ($Ledger) {
    Import-Module (Join-Path $PSScriptRoot 'RabbitNet.psd1') -Force
    $file = Join-Path $WorkDir 'chain_ledger_local.jsonl'
    Sync-RabbitChain -Origin $Origin -Path $file | Out-Null
    # An empty ledger writes no file, so there is nothing to verify or upload yet.
    $check = if (Test-Path -LiteralPath $file -PathType Leaf) { Test-RabbitChain $file } else { [pscustomobject]@{ Ok = $true; Count = 0; HeadSeq = 0; HeadHash = ('0' * 64); FailedSeq = $null; Reason = '' } }
    if (-not $check.Ok) { throw "Ledger chain is BROKEN at seq $($check.FailedSeq): $($check.Reason). Nothing was uploaded." }
    Write-Host "ledger verified: $($check.Count) events, head seq $($check.HeadSeq)"
    if ($check.Count -gt 0) {
        $head = Join-Path $WorkDir 'chain_head.json'
        ([pscustomobject]@{ length = $check.Count; headSeq = $check.HeadSeq; headHash = $check.HeadHash; syncedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress) | Set-Content $head -Encoding utf8
        Copy-ToBucket $file "gs://$PublicBucket/ledger/chain_ledger.jsonl"
        Copy-ToBucket $head "gs://$PublicBucket/ledger/chain_head.json"
    } else {
        Write-Host 'ledger is empty (no events yet); nothing to upload.'
    }
}

if ($Ledger) {
    # Publish Maxwell's chain next to the ledger. It is public by design, so it is only uploaded if the file has exactly the expected shape.
    $mc = Join-Path $MaxwellRoot 'maxwell_chain.json'
    if (Test-Path -LiteralPath $mc -PathType Leaf) {
        $j = Get-Content -LiteralPath $mc -Raw | ConvertFrom-Json
        $allowed = @('anchor_sha256', 'anchor_verified', 'anchor_message', 'difficulty', 'blocks')
        $extra = @($j.PSObject.Properties.Name | Where-Object { $_ -notin $allowed })
        $blockKeys = @('index', 'timestamp', 'transactions', 'previous_hash', 'nonce', 'hash')
        $badBlocks = @($j.blocks | Where-Object { @($_.PSObject.Properties.Name | Where-Object { $_ -notin $blockKeys }).Count -gt 0 })
        if ($j.blocks -and $extra.Count -eq 0 -and $badBlocks.Count -eq 0) { Copy-ToBucket $mc "gs://$PublicBucket/maxwell/maxwell_chain.json" }
        else { Write-Warning 'maxwell_chain.json has unexpected fields; NOT published.' }
    }
}

if ($Exports) {
    $manifest = Invoke-RestMethod "$Origin/api/data"
    $names = @($manifest.datasets | ForEach-Object { $_.id } | Where-Object { $_ -match '^[a-z_]{1,40}$' })
    foreach ($name in $names) {
        $out = Join-Path $WorkDir "export-$name.ndjson"
        Set-Content $out '' -NoNewline
        $cursor = $null; $pages = 0
        do {
            $url = "$Origin/api/data/${name}?format=ndjson&limit=200" + $(if ($cursor) { "&cursor=$([uri]::EscapeDataString($cursor))" } else { '' })
            $r = Invoke-WebRequest $url -TimeoutSec 60
            if ($r.Content) { Add-Content $out ([string]$r.Content).TrimEnd() -Encoding utf8 }
            $cursor = $r.Headers['X-Next-Cursor']; if ($cursor -is [array]) { $cursor = $cursor[0] }
            $pages++
        } while ($cursor -and $pages -lt 500)
        Copy-ToBucket $out "gs://$PrivateBucket/exports/$stamp/$name.ndjson"
    }
}

if ($Maxwell) {
    # One rolling copy under maxwell/current/. Bucket versioning keeps every earlier version, and rsync only sends what changed.
    # Nothing is ever deleted remotely, and only the names listed above are touched.
    foreach ($name in $MaxwellFiles) {
        $src = Join-Path $MaxwellRoot $name
        if (Test-Path -LiteralPath $src -PathType Leaf) { Copy-ToBucket $src "gs://$PrivateBucket/maxwell/current/$name" } else { Write-Warning "not found, skipped: $name" }
    }
    foreach ($dir in $MaxwellDirs) {
        $src = Join-Path $MaxwellRoot $dir
        if (-not (Test-Path -LiteralPath $src -PathType Container)) { Write-Warning "not found, skipped: $dir"; continue }
        if ($dry) { Write-Host "What if: would rsync $dir -> gs://$PrivateBucket/maxwell/current/$dir"; continue }
        gcloud storage rsync $src "gs://$PrivateBucket/maxwell/current/$dir" --recursive --quiet 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "rsync failed: $dir" }
        Write-Host "synced -> gs://$PrivateBucket/maxwell/current/$dir"
    }
}

foreach ($p in $MaxwellPath) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Write-Warning "skipped (not a file): $p"; continue }
    Copy-ToBucket $p "gs://$PrivateBucket/maxwell/$stamp/$(Split-Path $p -Leaf)"
}
Write-Host 'done'
