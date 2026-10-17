<#
.SYNOPSIS
    Dot-source at the top of a heavy scheduled job (`. "$PSScriptRoot\Wait-HeavyJobSlot.ps1" -Name 'daily-backups'`) so heavy jobs run ONE AT A TIME on this PC.
.DESCRIPTION
    After the PC wakes from sleep, Task Scheduler starts every missed job at once (StartWhenAvailable). The nightly backups, the Hugging Face and personal-folder uploads and the vault reindex
    together used all the memory on 2026-10-17 and the daily backup was killed. This takes a machine-wide named mutex (Global\RabbitOS-HeavyJob); a job that cannot get it waits its turn
    (up to -MaxWaitMinutes, default 180) and then proceeds anyway, so a hung holder can never block a backup forever. Windows frees the lock when the process exits, even if it crashes.
    The wait is written to the job's own log through the optional -Log scriptblock. Nothing is stored on disk.
#>
param(
    [Parameter(Mandatory)][string]$Name,
    [int]$MaxWaitMinutes = 180,
    [scriptblock]$Log = { param($m) Write-Host $m }
)
$script:HeavySlot = New-Object System.Threading.Mutex($false, 'Global\RabbitOS-HeavyJob')
$acquired = $false
$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
$announced = $false
while (-not $acquired) {
    try { $acquired = $script:HeavySlot.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }   # the previous holder died; the lock is ours
    if (-not $acquired) {
        if (-not $announced) { & $Log "$Name is waiting for another heavy job to finish (one at a time, to keep memory free)"; $announced = $true }
        if ((Get-Date) -gt $deadline) { & $Log "$Name waited $MaxWaitMinutes minutes; running anyway"; break }
    }
}
if ($acquired) { & $Log "$Name has the heavy-job slot" }
