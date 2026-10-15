<#
.SYNOPSIS
    Registers the two Windows scheduled tasks that keep the research loop going on this PC. -WhatIf shows the plan and changes nothing. Safe to run again (it replaces the tasks).
.DESCRIPTION
    RabbitOS Research Sync   every 30 minutes   Run-ResearchSync.ps1 -Mode Sync    (agents -> RabbitOS, then the chain back to this PC)
    RabbitOS Task Worker     every 5 minutes    Run-ResearchSync.ps1 -Mode Tasks   (picks up queued task proposals)
    Both run as you, only while you are signed in, hidden, one at a time, and are stopped after 20 minutes. They start late rather than never if the PC was asleep.
    -Remove deletes both tasks.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Script = (Join-Path $PSScriptRoot 'Run-ResearchSync.ps1'),
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$plan = @(
    @{ Name = 'RabbitOS Research Sync'; Mode = 'Sync'; Minutes = 30 },
    @{ Name = 'RabbitOS Task Worker'; Mode = 'Tasks'; Minutes = 5 }
)
if (-not (Test-Path $Script)) { throw "Run-ResearchSync.ps1 not found at $Script" }
foreach ($t in $plan) {
    if ($Remove) {
        if ($preview) { Write-Host "What if: remove the task '$($t.Name)'"; continue }
        if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false; Write-Host "removed: $($t.Name)" }
        continue
    }
    $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`" -Mode $($t.Mode)"
    if ($preview) { Write-Host "What if: register '$($t.Name)' every $($t.Minutes) min: pwsh $arg"; continue }
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $t.Minutes)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "registered: $($t.Name) (every $($t.Minutes) min)"
}
Write-Host "`nLogs: $HOME\RabbitOS\logs\research-sync-<date>.log and research-tasks-<date>.log" -ForegroundColor Green
