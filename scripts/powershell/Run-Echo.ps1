<#
.SYNOPSIS
    The PC side of the PC-to-cloud echo: one step (hear the cloud, acknowledge it, write the PC's message) with your own gcloud sign-in. -Register creates the scheduled task "RabbitOS Echo" (every 5 minutes); -Remove deletes it.
.DESCRIPTION
    No network path exists between this PC and Google Cloud for this: the PC only talks OUTWARD to the private prefix gs://rabbitsoftware-io-reports/echo/ (see Setup-GcpEcho.ps1 for the cloud side and the full description).
    Only RABBIT_INGEST_SECRET is read, from research-agents\.env into THIS process (it is the HMAC signing key); nothing is printed. Each run is recorded in Google Cloud Logging (log rabbit-pc-jobs, job "echo").
    Log: ~\RabbitOS\logs\echo-<date>.log.
.EXAMPLE
    pwsh -File Run-Echo.ps1            one step now
    pwsh -File Run-Echo.ps1 -Register  every 5 minutes
#>
[CmdletBinding()]
param(
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [switch]$Register,
    [switch]$Remove
)
$ErrorActionPreference = 'Continue'
$taskName = 'RabbitOS Echo'
if ($Remove) { if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host "removed: $taskName" } else { Write-Host "no such task: $taskName" }; return }
if ($Register) {
    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "registered: $taskName (every 5 minutes). Logs: $HOME\RabbitOS\logs\echo-<date>.log" -ForegroundColor Green
    return
}

$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("echo-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
foreach ($extra in (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\Scripts'), (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin')) { if ((Test-Path $extra) -and ($env:PATH -notlike "*$extra*")) { $env:PATH = "$env:PATH;$extra" } }
$envFile = Join-Path $AgentsDir '.env'
$l = if (Test-Path $envFile) { Get-Content $envFile | Where-Object { $_ -match '^\s*RABBIT_INGEST_SECRET\s*=' } | Select-Object -First 1 }
if ($l) { $env:RABBIT_INGEST_SECRET = (($l -split '=', 2)[1].Trim().Trim('"').Trim("'")) }
. (Join-Path $PSScriptRoot 'Write-CloudLog.ps1')
$started = Get-Date
if (-not $env:RABBIT_INGEST_SECRET) { Add-Content $log "[$(Get-Date -Format HH:mm:ss)] FAIL RABBIT_INGEST_SECRET not found in research-agents\.env"; Write-CloudLog -Job 'echo' -Event 'echo_failed' -Ok $false -Fields @{ reason = 'signing key missing' }; exit 1 }
$out = (& python (Join-Path $AgentsDir 'echo_link.py') --side pc 2>&1 | Out-String).Trim()
# Staging: items left in the cloud for local agents are copied into ~\RabbitOS\staged\<agent>\ (receipt written back), so agents find them when they next start.
$stageOut = (& python (Join-Path $AgentsDir 'stage_box.py') deliver 2>&1 | Out-String).Trim()
$reportOut = (& python (Join-Path $AgentsDir 'stage_box.py') report 2>&1 | Out-String).Trim()     # receipt 2: what the agents did with the notes they got
$sweepOut = (& python (Join-Path $AgentsDir 'stage_box.py') sweep 2>&1 | Out-String).Trim()
# Wake on delivery: a note for the task worker starts its scheduled task straight away instead of waiting for its next run (IgnoreNew makes this a no-op if it is already running).
# run_all.py watches its own inbox every 20 seconds, so it needs no wake-up.
try {
    $sj0 = $stageOut | ConvertFrom-Json
    if ($sj0.delivered.task_worker -gt 0) {
        $t = Get-ScheduledTask -TaskName 'RabbitOS Task Worker' -ErrorAction SilentlyContinue
        if ($t -and $t.State -eq 'Ready') { Start-ScheduledTask -TaskName 'RabbitOS Task Worker'; Add-Content $log "[$(Get-Date -Format HH:mm:ss)] woke RabbitOS Task Worker ($($sj0.delivered.task_worker) note(s), urgent: $($sj0.urgent.task_worker))" }
    }
} catch { }
# Log findings: once an hour, send each worker a short note about retrieval problems seen in the logs (only when the note changed since the last one sent).
if ((Get-Date).Minute -lt 5 -or $env:RABBIT_FEEDBACK_NOW) { $fbOut = (& python (Join-Path $AgentsDir 'log_feedback.py') 2>&1 | Out-String).Trim(); Add-Content $log "[$(Get-Date -Format HH:mm:ss)] feedback: $fbOut" }
Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue
Add-Content $log "[$(Get-Date -Format HH:mm:ss)] staging: $stageOut | handled-report: $reportOut | sweep: $sweepOut"
Add-Content $log "[$(Get-Date -Format HH:mm:ss)] $out"
try { $j = $out | ConvertFrom-Json } catch { $j = $null }
if ($j -and $j.event -in 'echo_heard', 'echo_silent') {
    try { $sj = $stageOut | ConvertFrom-Json; $stagedN = ($sj.delivered.PSObject.Properties.Value | Measure-Object -Sum).Sum } catch { $stagedN = $null }
    Write-CloudLog -Job 'echo' -Event $j.event -Ok $true -Started $started -Fields @{ seq = $j.seq; heardCloud = [bool]$j.heardFrom; stagedDelivered = [int]$stagedN; cloudAgeSeconds = $j.peerMessageAgeSeconds; cloudAcknowledgedMe = $j.peerAcknowledgedMyPrevious; acknowledgementSeconds = $j.acknowledgementSeconds }
    exit 0
}
Write-CloudLog -Job 'echo' -Event 'echo_failed' -Ok $false -Started $started -Fields @{ reason = ($out -replace '\s+', ' ').Substring(0, [Math]::Min(200, $out.Length)) }
exit 1
