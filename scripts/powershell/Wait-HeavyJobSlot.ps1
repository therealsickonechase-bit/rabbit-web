<#
.SYNOPSIS
    Call at the top of a heavy scheduled job (`& (Join-Path $PSScriptRoot 'Wait-HeavyJobSlot.ps1') -JobName 'daily-backups' -Say { param($m) Log $m }`) so heavy jobs run ONE AT A TIME on this PC.
.DESCRIPTION
    After the PC wakes from sleep, Task Scheduler starts every missed job at once (StartWhenAvailable). The nightly backups, the Hugging Face and personal-folder uploads and the vault reindex
    together used all the memory on 2026-10-17 and the daily backup was killed. This takes a machine-wide named mutex (Global\RabbitOS-HeavyJob); a job that cannot get it waits its turn
    (up to -MaxWaitMinutes, default 180) and then proceeds anyway, so a hung holder can never block a backup forever. Windows frees the lock when the process exits, even if it crashes.
    CALL it with `&` (its own scope), never dot-sourced: PowerShell variable names are case-insensitive, and a dot-sourced helper once overwrote the caller's `$log` path variable.
    The lock object is kept in $global:RabbitOSHeavySlot so it lives until the calling process ends. Nothing is stored on disk.
#>
param(
    [Parameter(Mandatory)][string]$JobName,
    [int]$MaxWaitMinutes = 180,
    [scriptblock]$Say = { param($message) Write-Host $message }
)
$global:RabbitOSHeavySlot = New-Object System.Threading.Mutex($false, 'Global\RabbitOS-HeavyJob')
$gotSlot = $false
$giveUpAt = (Get-Date).AddMinutes($MaxWaitMinutes)
$toldThem = $false
while (-not $gotSlot) {
    try { $gotSlot = $global:RabbitOSHeavySlot.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $gotSlot = $true }   # the previous holder died; the lock is ours
    if (-not $gotSlot) {
        if (-not $toldThem) { & $Say "$JobName is waiting for another heavy job to finish (one at a time, to keep memory free)"; $toldThem = $true }
        if ((Get-Date) -gt $giveUpAt) { & $Say "$JobName waited $MaxWaitMinutes minutes; running anyway"; break }
    }
}
if ($gotSlot) { & $Say "$JobName has the heavy-job slot" }
