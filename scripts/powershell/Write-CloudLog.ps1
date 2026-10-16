<#
.SYNOPSIS
    Helper (dot-source it): writes one structured entry about a PC job to Google Cloud Logging, log "rabbit-pc-jobs" in project rabbitsoftware-io, so Google Cloud records every backup and sync that runs on this PC, including the size of its local cache/staging folders.
.DESCRIPTION
    . "$PSScriptRoot\Write-CloudLog.ps1"
    Write-CloudLog -Job 'personal-folders' -Event 'backup_done' -Ok $true -Fields @{ filesSent = 580; failed = 0 } -CacheFolders @("$env:LOCALAPPDATA\RabbitOS\personal-stage")

    Entry fields: job, event, ok, host, durationSec (when -Started is given), cache (per folder: path, files, megabytes) plus whatever you pass in -Fields. Severity is INFO, or ERROR when -Ok $false.
    Only counts, sizes and names go in; never file contents, tokens or secrets. It uses your own gcloud sign-in and the Logging REST API. It NEVER throws: if Google Cloud cannot be reached the job carries on and only a local note is written.
    Where it ends up: a log bucket "pc-jobs" (kept 365 days) through a sink, set up by Setup-GcpPcJobLogging.ps1, which also creates the metric pc_job_failed and an email alert.
#>
function Get-FolderCache {
    param([string[]]$Paths)
    foreach ($p in $Paths) {
        if (-not $p -or -not (Test-Path -LiteralPath $p)) { [ordered]@{ path = $p; exists = $false }; continue }
        $m = Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum
        [ordered]@{ path = $p; exists = $true; files = [int]$m.Count; megabytes = [math]::Round(([double]$m.Sum) / 1MB, 1) }
    }
}
function Write-CloudLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Job,
        [Parameter(Mandatory)][string]$Event,
        [bool]$Ok = $true,
        [hashtable]$Fields = @{},
        [string[]]$CacheFolders = @(),
        [datetime]$Started,
        [string]$Project = 'rabbitsoftware-io',
        [string]$LogName = 'rabbit-pc-jobs'
    )
    try {
        $payload = [ordered]@{ job = $Job; event = $Event; ok = $Ok; host = $env:COMPUTERNAME }
        if ($PSBoundParameters.ContainsKey('Started')) { $payload.durationSec = [int]((Get-Date) - $Started).TotalSeconds }
        foreach ($k in $Fields.Keys) { $payload[$k] = $Fields[$k] }
        if ($CacheFolders.Count) { $payload.cache = @(Get-FolderCache -Paths $CacheFolders) }
        $body = @{
            logName  = "projects/$Project/logs/$LogName"
            resource = @{ type = 'global'; labels = @{ project_id = $Project } }
            entries  = @(@{ severity = $(if ($Ok) { 'INFO' } else { 'ERROR' }); jsonPayload = $payload })
        } | ConvertTo-Json -Depth 8 -Compress
        $tok = (& gcloud auth print-access-token 2>$null | Select-Object -First 1)
        if (-not $tok) { throw 'no gcloud access token' }
        Invoke-RestMethod -Method Post -Uri 'https://logging.googleapis.com/v2/entries:write' -Headers @{ Authorization = "Bearer $($tok.Trim())"; 'x-goog-user-project' = $Project } -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
    } catch {
        try { Add-Content -Path (Join-Path $HOME 'RabbitOS\logs\cloud-log-errors.log') -Value ("{0} {1}/{2}: {3}" -f (Get-Date -Format s), $Job, $Event, $_.Exception.Message) } catch { }
    }
}
