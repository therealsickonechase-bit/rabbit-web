<#
.SYNOPSIS
    Runs one pass of the research loop on this PC, for Task Scheduler. -Mode Sync pushes the agents' public findings to RabbitOS and pulls the chain back; -Mode Tasks picks up queued task proposals.
.DESCRIPTION
    Sync   rabbit_sync.py (agents -> app, signed ingest)  then  chain_pull.py --once (app -> this PC)
    Tasks  task_worker.py --once (app task queue -> agents)
    Only RABBIT_URL and RABBIT_INGEST_SECRET are loaded, from research-agents\.env, into THIS process. Nothing is printed. Output goes to ~\RabbitOS\logs\research-<mode>-<date>.log
    (newest 14 kept) with the time each step took. One run at a time per mode (a second start while one is running exits quietly). Each step has a time limit.
    Exit code 1 if any step failed.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Sync', 'Tasks')][string]$Mode,
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [int]$StepLimitMinutes = 15
)
$ErrorActionPreference = 'Continue'
$logDir = Join-Path $HOME 'RabbitOS\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("research-{0}-{1}.log" -f $Mode.ToLower(), (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

# One run at a time per mode.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\RabbitOS-Research-$Mode", [ref]$created)
if (-not $created) { Log 'another run is still going; skipping this one'; exit 0 }

try {
    $envFile = Join-Path $AgentsDir '.env'
    foreach ($name in 'RABBIT_URL', 'RABBIT_INGEST_SECRET') {
        $l = if (Test-Path $envFile) { Get-Content $envFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1 }
        if ($l) { $v = ($l -split '=', 2)[1].Trim().Trim('"').Trim("'"); if ($v) { Set-Item -Path "Env:$name" -Value $v } }
    }
    if (-not $env:RABBIT_URL) { $env:RABBIT_URL = 'https://app.rabbitsoftware.io' }
    $needsSecret = $Mode -eq 'Sync' -or $Mode -eq 'Tasks'
    if ($needsSecret -and -not $env:RABBIT_INGEST_SECRET) { Log 'FAIL  RABBIT_INGEST_SECRET is not set in research-agents\.env'; exit 1 }

    $steps = if ($Mode -eq 'Sync') {
        # adopt cloud-mined Maxwell blocks, send our findings, pull the chain back, then refresh the public ledger copy in Google Cloud (verified before upload) so it never lags the app by more than this interval
        @(@{ Name = 'maxwell_adopt'; Args = @('maxwell_adopt.py', '--apply') }, @{ Name = 'rabbit_sync'; Args = @('rabbit_sync.py') }, @{ Name = 'chain_pull'; Args = @('chain_pull.py', '--once') },
          @{ Name = 'ledger_to_gcs'; Exe = 'pwsh'; Args = @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'Sync-RabbitGcs.ps1'), '-Ledger') })
    } else {
        @(@{ Name = 'task_worker'; Args = @('task_worker.py', '--once') })
    }
    $failed = 0
    foreach ($s in $steps) {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $outFile = Join-Path ([IO.Path]::GetTempPath()) ('rs-' + [guid]::NewGuid().ToString('N') + '.txt')
        try {
            $p = Start-Process -FilePath $(if ($s.Exe) { $s.Exe } else { 'python' }) -ArgumentList $s.Args -WorkingDirectory $AgentsDir -NoNewWindow -PassThru -RedirectStandardOutput $outFile -RedirectStandardError "$outFile.err"
            if (-not $p.WaitForExit($StepLimitMinutes * 60 * 1000)) { try { $p.Kill($true) } catch {}; throw "timed out after $StepLimitMinutes min" }
            foreach ($f in $outFile, "$outFile.err") { if (Test-Path $f) { Get-Content $f -Tail 15 | Where-Object { $_.Trim() } | ForEach-Object { Add-Content $log "    $_" } } }
            if ($p.ExitCode -ne 0) { throw "exit code $($p.ExitCode)" }
            Log ("OK    {0} ({1:N0} s)" -f $s.Name, $clock.Elapsed.TotalSeconds)
        } catch { $failed++; Log ("FAIL  {0} after {1:N0} s: {2}" -f $s.Name, $clock.Elapsed.TotalSeconds, $_.Exception.Message) }
        finally { Remove-Item $outFile, "$outFile.err" -Force -ErrorAction SilentlyContinue }
    }
    Get-ChildItem $logDir -Filter "research-$($Mode.ToLower())-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Force -ErrorAction SilentlyContinue
    if ($failed) { exit 1 }
} finally {
    Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
