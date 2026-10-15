<#
.SYNOPSIS
    Registers the Windows scheduled task that copies your Obsidian vault to Google Cloud every hour (Sync-VaultToGcs.ps1). -WhatIf shows the plan. -Remove deletes the task.
.DESCRIPTION
    Task "RabbitOS Vault to Google Cloud": every 60 minutes, as you, hidden, one run at a time, stopped after 30 minutes, started late (not skipped) if the PC was asleep.
    It only reads the vault and writes to gs://rabbitsoftware-io-vault-private. Logs: ~\RabbitOS\logs\vault-gcs-<date>.log
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Script = (Join-Path $PSScriptRoot 'Sync-VaultToGcs.ps1'),
    [int]$Minutes = 60,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$name = 'RabbitOS Vault to Google Cloud'
$reindexName = 'RabbitOS Vault Search Reindex'
$reindexScript = Join-Path $PSScriptRoot 'Setup-GcpVaultSearch.ps1'
if ($Remove) {
    foreach ($n in $name, $reindexName) {
        if ($preview) { Write-Host "What if: remove the task '$n'"; continue }
        if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false; Write-Host "removed: $n" } else { Write-Host "no such task: $n" }
    }
    return
}
if (-not (Test-Path $Script)) { throw "Sync-VaultToGcs.ps1 not found at $Script" }
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`""
$reindexArg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$reindexScript`" -ImportOnly"
if ($preview) { Write-Host "What if: register '$name' every $Minutes min: pwsh $arg"; Write-Host "What if: register '$reindexName' daily at 04:30: pwsh $reindexArg"; return }
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "registered: $name (every $Minutes min). Logs: $HOME\RabbitOS\logs\vault-gcs-<date>.log" -ForegroundColor Green
# Daily: tell Vertex AI Search to pick up new and changed notes (only if the search app has been set up).
if (Test-Path $reindexScript) {
    $rAction = New-ScheduledTaskAction -Execute $pwsh -Argument $reindexArg
    $rTrigger = New-ScheduledTaskTrigger -Daily -At 4:30AM
    $rSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 90)
    Register-ScheduledTask -TaskName $reindexName -Action $rAction -Trigger $rTrigger -Settings $rSettings -Principal $principal -Force | Out-Null
    Write-Host "registered: $reindexName (daily 04:30)" -ForegroundColor Green
}
