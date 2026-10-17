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
# Heavy jobs run one at a time (after a wake-up Task Scheduler starts every missed job at once and memory runs out).
. (Join-Path $PSScriptRoot 'Wait-HeavyJobSlot.ps1') -Name 'daily-backups' -Log { param($m) Log $m }
$failed = 0
. (Join-Path $PSScriptRoot 'Write-CloudLog.ps1')
$jobStarted = Get-Date

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

$maxwellDir = 'C:\Users\odaat\Projects\research-agents'
function Import-MaxwellEnv {
    # Loads only RABBIT_URL and RABBIT_INGEST_SECRET from research-agents\.env into THIS process. Nothing is printed.
    $envFile = Join-Path $maxwellDir '.env'
    foreach ($name in 'RABBIT_URL', 'RABBIT_INGEST_SECRET') {
        $l = if (Test-Path $envFile) { Get-Content $envFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1 }
        if ($l) { Set-Item -Path "Env:$name" -Value (($l -split '=', 2)[1].Trim().Trim('"').Trim("'")) }
    }
}
$steps = @(
    # Maxwell first: anchor the public research records into the chain (adds a block only when the research changed), then mirror new blocks.
    # Antigravity / physics literature (OpenAlex, INSPIRE-HEP; public titles and links only) goes into the research store first, so the research anchor below covers it.
    @{ Name = 'Research: physics papers (antigravity)'; Block = { Push-Location $maxwellDir; try { python physics_research.py } finally { Pop-Location } } },
    @{ Name = 'Research: send findings to RabbitOS'; Script = 'Run-ResearchSync.ps1'; Params = @{ Mode = 'Sync' } },
    # First, take over any blocks the Cloud Run miner added (the public copy is verified block by block; the app's mirror decides if the two ever disagree).
    @{ Name = 'Maxwell: adopt the public chain'; Block = { Push-Location $maxwellDir; try { python maxwell_adopt.py --apply } finally { Pop-Location } } },
    @{ Name = 'Maxwell: research anchor'; Block = { Push-Location $maxwellDir; try { Import-MaxwellEnv; Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue; python maxwell_research_anchor.py --apply } finally { Pop-Location } } },
    # The rabbit web data miner: a public snapshot of the whole web (pages, services, datasets, chain copies, research counts), anchored as one Merkle root (a block only when something changed).
    # The DNA variant index (public ClinVar + RefSeq, every variant checked against its transcript) is rebuilt, compared with the research and the CRISPR guides, and the findings are relayed to the
    # local and cloud agents through the echo. It runs before the snapshot so the Maxwell leaf dna:index carries today's index root and comparison.
    @{ Name = 'DNA: variant index, research comparison, relay to agents'; Block = { Push-Location $maxwellDir; try { Import-MaxwellEnv; python dna_variant_index.py build; python dna_relay.py } finally { Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue; Pop-Location } } },
    # The toolbox (the command catalog and the files the commands use) is republished for the local and cloud agents, with a manifest of hashes; the Maxwell leaf toolbox:manifest then carries its root.
    @{ Name = 'Toolbox: publish commands and files'; Script = 'Run-Toolbox.ps1'; Params = @{} },
    @{ Name = 'Maxwell: rabbit web snapshot'; Block = { Push-Location $maxwellDir; try { Import-MaxwellEnv; Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue; python rabbitweb_miner.py --apply } finally { Pop-Location } } },
    @{ Name = 'Maxwell: mirror new blocks to the public ledger'; Block = { Push-Location $maxwellDir; try { Import-MaxwellEnv; python maxwell_chain_sync.py --once } finally { Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue; Pop-Location } } },
    # Record the hash of every new Maxwell block: a line in ~\RabbitOS\logs\maxwell-anchors.log and block-NNNN.json in gs://rabbitsoftware-io-backups/maxwell/anchors/ (hashes, counts and times only).
    @{ Name = 'Maxwell: record new block hashes (local log + Google Cloud)'; Block = { Push-Location $maxwellDir; try { python record_anchor.py; $anchorDir = Join-Path $HOME 'RabbitOS\anchors'; if (Test-Path $anchorDir) { gcloud storage cp "$anchorDir\*.json" gs://rabbitsoftware-io-backups/maxwell/anchors/ --quiet; if ($LASTEXITCODE -ne 0) { throw 'anchor upload failed' } } } finally { Pop-Location } } },
    # Claude chats, keys and tokens redacted, to gs://rabbitsoftware-io-backups/claude-chats/ (only chats that changed).
    @{ Name = 'Google: Claude chats (redacted)'; Script = 'Save-ClaudeChats.ps1'; Params = @{} },
    @{ Name = 'Google: public ledger + datasets'; Script = 'Sync-RabbitGcs.ps1'; Params = @{ Ledger = $true; Exports = $true } },
    @{ Name = 'Google: Maxwell files';            Script = 'Sync-RabbitGcs.ps1'; Params = @{ Maxwell = $true } },
    @{ Name = 'Platform: Supabase, Cloudflare, repos'; Script = 'Backup-Platform.ps1'; Params = @{} }
)
foreach ($s in $steps) {
    Log "START $($s.Name)"
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        # Output goes to the log line by line as it happens, so a step that is slow or is killed by the task time limit still leaves its progress behind.
        $LASTEXITCODE = 0
        if ($s.Block) { & $s.Block 2>&1 | Out-String -Stream | Where-Object { $_.Trim() } | ForEach-Object { Add-Content $log "    $_" } }
        else { $p = $s.Params; & (Join-Path $scripts $s.Script) @p 2>&1 | Out-String -Stream | Where-Object { $_.Trim() } | ForEach-Object { Add-Content $log "    $_" } }
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        Log ("OK    {0} ({1:N0} min)" -f $s.Name, $clock.Elapsed.TotalMinutes)
    } catch { $failed++; Log ("FAIL  {0} after {1:N0} min: {2}" -f $s.Name, $clock.Elapsed.TotalMinutes, $_.Exception.Message) }
}

# Keep the newest 30 logs and the newest 7 local dated backup folders (the cloud copies are versioned and kept for a year).
Get-ChildItem $logDir -Filter 'backup-*.log' | Sort-Object Name -Descending | Select-Object -Skip 30 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$pb = Join-Path $HOME 'RabbitOS\platform-backup'
if (Test-Path $pb) { Get-ChildItem $pb -Directory | Sort-Object Name -Descending | Select-Object -Skip 7 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force } }

Log ("daily backup finished; failed steps: $failed")
Write-CloudLog -Job 'daily-backups' -Event 'backup_done' -Ok ($failed -eq 0) -Started $jobStarted -Fields @{ failedSteps = $failed; steps = $steps.Count } -CacheFolders @((Join-Path $HOME 'RabbitOS\platform-backup'))
exit ([int]($failed -gt 0))
