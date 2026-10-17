<#
.SYNOPSIS
    Backs up your Downloads, Desktop and Documents folders to the PRIVATE Google Cloud backups bucket (gs://rabbitsoftware-io-backups/personal/). -WhatIf shows what would be sent and uploads nothing.
.DESCRIPTION
    Also Pictures (OneDrivePictures), Music and Videos in full, and a short list of AppData settings files (VS Code settings, keybindings, snippets and the extension list, Windows Terminal settings, .gitconfig) -> personal/AppSettings/.
    The rest of AppData is deliberately NOT copied: it holds browser profiles, cookies, saved logins, cloud-tool tokens (gcloud, GitHub, npm) and gigabytes of caches.
    Folders (the real Windows locations, so OneDrive redirection is followed):
      Downloads    -> personal/Downloads/
      Desktop      -> personal/Desktop/      (C:\Users\<you>\OneDrive\Desktop on this PC)
      Documents    -> personal/Documents/    (C:\Users\<you>\OneDrive\Documents, plus any other files in C:\Users\<you>\Documents)
    The Obsidian vault in C:\Users\<you>\Documents\RabbitOS Vault is NOT copied here: it has its own upload (Sync-VaultToGcs.ps1) and linking its folders would copy other places twice.
    Never copied (and listed in the log by name): files that look like keys or secrets (.env, *.pem, *.key, *.ppk, *.pfx, *.p12, id_rsa*, *.kdbx, wallet.dat) and single files over 2 GB.
    Also skipped as noise: node_modules, .venv, __pycache__, Thumbs.db, desktop.ini, Office lock files (~$*) and *.tmp.
    How: `gcloud storage rsync` per folder with your own gcloud sign-in. It only adds and updates; it never deletes anything in the bucket (the bucket is versioned, so overwritten and removed files stay recoverable for the bucket's retention).
    OneDrive "online-only" files are downloaded by Windows when they are read, which is normal.
    -Register   creates the task "RabbitOS Personal folders to Google Cloud": every night at 01:30, hidden, one run at a time, up to 12 hours, started late if the PC was asleep; -Remove deletes it.
    Log: ~\RabbitOS\logs\personal-gcs-<date>.log. The first run uploads everything; later runs send only what changed.
.EXAMPLE
    pwsh -File Backup-PersonalFolders.ps1 -WhatIf
.EXAMPLE
    pwsh -File Backup-PersonalFolders.ps1 -Register
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Bucket = 'rabbitsoftware-io-backups',
    [switch]$Register,
    [switch]$Remove,
    [long]$MaxFileBytes = 2GB
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$taskName = 'RabbitOS Personal folders to Google Cloud'

if ($Remove) {
    if ($preview) { Write-Host "What if: remove the task '$taskName'"; return }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host "removed: $taskName" } else { Write-Host "no such task: $taskName" }
    return
}
if ($Register) {
    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($preview) { Write-Host "What if: register '$taskName' nightly at 01:30: pwsh $arg"; return }
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg
    $trigger = New-ScheduledTaskTrigger -Daily -At '01:30'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "registered: $taskName (nightly 01:30, up to 12 hours). Logs: $HOME\RabbitOS\logs\personal-gcs-<date>.log" -ForegroundColor Green
    return
}

$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("personal-gcs-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $log -Value $line; Write-Host $line }
# Heavy jobs run one at a time (after a wake-up Task Scheduler starts every missed job at once and memory runs out).
. (Join-Path $PSScriptRoot 'Wait-HeavyJobSlot.ps1') -Name 'personal-folders-backup' -Log { param($m) Log $m }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'gcloud is not installed or not on PATH.' }

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\RabbitOS-PersonalBackup', [ref]$created)
if (-not $created -and -not $preview) { Log 'another run is still going; skipping this one'; return }

$downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
$legacyDocs = Join-Path $HOME 'Documents'
$sources = [ordered]@{
    'Downloads' = @($downloads)
    'Desktop'   = @([Environment]::GetFolderPath('Desktop'))
    # C:\Users\<you>\Documents (the old, non-OneDrive folder) holds only the Obsidian vault, which has its own upload, and shortcut folders; scanning it walks the vault's linked folders for no gain, so it is not included.
    'Documents' = @([Environment]::GetFolderPath('MyDocuments'))
    'Pictures'  = @([Environment]::GetFolderPath('MyPictures'), (Join-Path $HOME 'Pictures') | Select-Object -Unique)
    'Music'     = @([Environment]::GetFolderPath('MyMusic'))
    'Videos'    = @([Environment]::GetFolderPath('MyVideos'))
}
$secretNames = '(^|[\\/])(\.env(\..*)?|id_rsa.*|id_ed25519.*|wallet\.dat)$|\.(pem|key|ppk|pfx|p12|kdbx|jks)$'
$noise = '(^|[\\/])(node_modules|\.venv|__pycache__|RabbitOS Vault)([\\/]|$)|(^|[\\/])(Thumbs\.db|desktop\.ini)$|(^|[\\/])~\$|\.tmp$'

# The same rules as a regular expression for `gcloud storage rsync --exclude`, which matches from the start of the path relative to the folder.
$gcloudExclude = '(.*[\\/])?(\.env(\..*)?|id_rsa.*|id_ed25519.*|wallet\.dat)$|.*\.(pem|key|ppk|pfx|p12|kdbx|jks)$|(.*[\\/])?(node_modules|\.venv|__pycache__|RabbitOS Vault)([\\/].*)?$|(.*[\\/])?(Thumbs\.db|desktop\.ini|~\$.*)$|.*\.tmp$'

$failed = 0
$jobStarted = Get-Date
$totalFiles = 0; $totalBytes = 0L
foreach ($area in $sources.Keys) {
    $stage = Join-Path $env:LOCALAPPDATA ("RabbitOS\personal-stage\$area")
    $skippedSecret = @(); $skippedBig = @(); $count = 0; $bytes = 0L
    foreach ($root in $sources[$area]) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)) {
            $rel = $f.FullName.Substring($root.Length).TrimStart('\')
            if ($f.FullName -match $noise.Replace('RabbitOS Vault', 'RabbitOS Vault')) { continue }
            if ($rel -match $secretNames) { $skippedSecret += $rel; continue }
            if ($f.Length -gt $MaxFileBytes) { $skippedBig += $rel; continue }
            $count++; $bytes += $f.Length; $totalFiles++; $totalBytes += $f.Length
        }
    }
    Log ("{0}: {1:N0} files, {2:N2} GB to send; skipped {3} secret-looking and {4} over {5:N0} GB" -f $area, $count, ($bytes / 1GB), $skippedSecret.Count, $skippedBig.Count, ($MaxFileBytes / 1GB))
    foreach ($s in $skippedSecret) { Log "    skipped (looks like a key or secret): $s" }
    foreach ($s in $skippedBig) { Log "    skipped (too big): $s" }
    if ($preview) { continue }
    # Build a clean staging view only for areas with several roots; single-root areas are synced in place with an exclude pattern.
    $exclude = $gcloudExclude
    foreach ($root in $sources[$area]) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $dest = "gs://$Bucket/personal/$area"
        if ($sources[$area].Count -gt 1 -and $root -ne $sources[$area][0]) { $dest = "gs://$Bucket/personal/$area/_other_documents_folder" }
        Log "rsync $root -> $dest"
        $out = & gcloud storage rsync $root $dest --recursive --ignore-symlinks --project $Project --exclude $exclude 2>&1
        if ($LASTEXITCODE -ne 0) { $failed++; Log ("FAIL  {0}: {1}" -f $root, (($out | Select-Object -Last 3) -join ' | ')) } else { Log "OK    $root" }
    }
}
# AppData is NOT copied wholesale: it holds browser profiles, cookies, saved logins, cloud-tool tokens (gcloud, GitHub, npm) and gigabytes of caches.
# Only a short list of settings files that rebuild a working setup is copied, through a staging folder: VS Code user settings, keybindings and snippets plus the list of
# installed extensions, Windows Terminal settings, and .gitconfig. Nothing in this list holds a credential.
$appFiles = @(
    @{ From = Join-Path $env:APPDATA 'Code\User\settings.json';      To = 'VSCode\settings.json' }
    @{ From = Join-Path $env:APPDATA 'Code\User\keybindings.json';   To = 'VSCode\keybindings.json' }
    @{ From = Join-Path $env:APPDATA 'Code\User\snippets';           To = 'VSCode\snippets' }
    @{ From = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'; To = 'WindowsTerminal\settings.json' }
    @{ From = Join-Path $HOME '.gitconfig';                          To = 'git\.gitconfig' }
)
$appStage = Join-Path $env:LOCALAPPDATA 'RabbitOS\personal-stage\AppSettings'
if ($preview) {
    $present = @($appFiles | Where-Object { Test-Path -LiteralPath $_.From })
    Log ("AppSettings: {0} of {1} settings files present (VS Code, Windows Terminal, git); the rest of AppData is not copied" -f $present.Count, $appFiles.Count)
} else {
    if (Test-Path $appStage) { Remove-Item $appStage -Recurse -Force }
    New-Item -ItemType Directory -Force $appStage | Out-Null
    foreach ($a in $appFiles) {
        if (-not (Test-Path -LiteralPath $a.From)) { continue }
        $target = Join-Path $appStage $a.To
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        Copy-Item -LiteralPath $a.From -Destination $target -Recurse -Force
    }
    $code = Get-Command code -ErrorAction SilentlyContinue
    if ($code) { New-Item -ItemType Directory -Force (Join-Path $appStage 'VSCode') | Out-Null; & code --list-extensions --show-versions 2>$null | Set-Content (Join-Path $appStage 'VSCode\extensions.txt') -Encoding UTF8 }
    Log "rsync AppSettings (curated) -> gs://$Bucket/personal/AppSettings"
    $out = & gcloud storage rsync $appStage "gs://$Bucket/personal/AppSettings" --recursive --project $Project 2>&1
    if ($LASTEXITCODE -ne 0) { $failed++; Log ("FAIL  AppSettings: {0}" -f (($out | Select-Object -Last 3) -join ' | ')) } else { Log 'OK    AppSettings' }
}
if ($preview) { Write-Host "`nWhat if: nothing was uploaded." } else {
    Log "personal folders backup finished; failed folders: $failed"
    . (Join-Path $PSScriptRoot 'Write-CloudLog.ps1')
    Write-CloudLog -Job 'personal-folders' -Event 'backup_done' -Ok ($failed -eq 0) -Started $jobStarted -Fields @{ failedFolders = $failed; filesConsidered = $totalFiles; megabytesConsidered = [math]::Round($totalBytes / 1MB, 1) } -CacheFolders @((Join-Path $env:LOCALAPPDATA 'RabbitOS\personal-stage'))
}
exit ([int]($failed -gt 0))
