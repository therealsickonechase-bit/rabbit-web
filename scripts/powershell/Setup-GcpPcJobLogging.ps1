<#
.SYNOPSIS
    Makes Google Cloud record and keep what the PC's backup and sync jobs do (project rabbitsoftware-io). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    The PC jobs (personal folders, Hugging Face, daily backups) write one entry per run to the Cloud Logging log "rabbit-pc-jobs" through Write-CloudLog.ps1: job, result, duration, counts and the size of their local
    cache/staging folders. This script sets up where that goes:
      Log bucket   pc-jobs        kept 365 days (the default log bucket keeps only 30)
      Sink         rabbit-pc-jobs routes that one log into the bucket
      Metric       pc_job_failed  counts entries with ok=false
      Alert        "RabbitOS: a backup or sync on the PC failed"  (email, same channel as the other alerts)
    Read the records: gcloud logging read 'logName="projects/rabbitsoftware-io/logs/rabbit-pc-jobs"' --limit 20 --format json
    Cost: a few kilobytes a day.
#>
[CmdletBinding(SupportsShouldProcess)]
param([string]$Project = 'rabbitsoftware-io')
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$filter = "logName=`"projects/$Project/logs/rabbit-pc-jobs`""

Step 'Log bucket pc-jobs (365 days)'
Invoke-IfLive 'create the log bucket if missing' {
    if (Exists logging buckets describe pc-jobs --location global --project $Project) { Write-Host 'bucket exists: pc-jobs' }
    else { Invoke-Gcloud logging buckets create pc-jobs --location global --retention-days 365 --description 'Backup and sync jobs on the owner PC' --project $Project }
}
Step 'Sink'
Invoke-IfLive 'route the rabbit-pc-jobs log into the bucket' {
    $dest = "logging.googleapis.com/projects/$Project/locations/global/buckets/pc-jobs"
    if (Exists logging sinks describe rabbit-pc-jobs --project $Project) { Write-Host 'sink exists: rabbit-pc-jobs' }
    else { Invoke-Gcloud logging sinks create rabbit-pc-jobs $dest --log-filter $filter --project $Project }
}
Step 'Metric and alert for failed jobs'
Invoke-IfLive 'create the metric pc_job_failed and the email alert policy' {
    $f = "$filter AND jsonPayload.ok=false"
    if (Exists logging metrics describe pc_job_failed --project $Project) { Invoke-Gcloud logging metrics update pc_job_failed --project $Project --description 'A backup or sync on the PC failed' --log-filter $f }
    else { Invoke-Gcloud logging metrics create pc_job_failed --project $Project --description 'A backup or sync on the PC failed' --log-filter $f }
    $tok = (gcloud auth print-access-token).Trim()
    $h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
    $mon = "https://monitoring.googleapis.com/v3/projects/$Project"
    $channel = (Invoke-RestMethod "$mon/notificationChannels" -Headers $h).notificationChannels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
    if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
    $name = 'RabbitOS: a backup or sync on the PC failed'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    # A log-match alert fires straight from the log entry, so it needs no metric to be visible to Monitoring first.
    $cond = @{ displayName = 'PC job failed'; conditionMatchedLog = @{ filter = "$filter AND jsonPayload.ok=false" } }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; conditions = @($cond); notificationChannels = @($channel.name)
        alertStrategy = @{ notificationRateLimit = @{ period = '3600s' } }
        documentation = @{ mimeType = 'text/markdown'; content = 'A scheduled backup or sync on the owner PC reported a failure. The entry names the job and the reason: gcloud logging read ''logName="projects/rabbitsoftware-io/logs/rabbit-pc-jobs" AND jsonPayload.ok=false'' --limit 5. Local logs are in ~/RabbitOS/logs.' } } | ConvertTo-Json -Depth 8
    [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body)
    Write-Host "created alert policy: $name"
}
Write-Host "`nDone. Entries appear after the next PC job runs." -ForegroundColor Green
