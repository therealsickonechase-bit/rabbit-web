<#
.SYNOPSIS
    Backs up your Hugging Face buckets and datasets (including private ones) to the PRIVATE Google Cloud backups bucket (gs://rabbitsoftware-io-backups/huggingface/). -WhatIf lists what would be copied.
.DESCRIPTION
    Uses YOUR Hugging Face sign-in on this PC (`hf auth login`, stored by the hf CLI). No token is read by this script, printed, or sent anywhere: the files are downloaded with the hf CLI into a staging folder
    under %LOCALAPPDATA%\RabbitOS\hf-stage, then `gcloud storage rsync` copies them with your own gcloud sign-in.
      buckets   every bucket in your namespace       -> huggingface/buckets/<name>/
      datasets  every dataset you own (public and private) -> huggingface/datasets/<name>/
    Models and Spaces are not copied: their files already live in git on Hugging Face (and the model is large); say so if you want them added.
    Adds and updates only; nothing is ever deleted in the Google Cloud bucket (it is versioned).
    -Register creates the task "RabbitOS Hugging Face to Google Cloud" (nightly 02:30, hidden, up to 6 hours, started late if the PC was asleep); -Remove deletes it.
    Log: ~\RabbitOS\logs\hf-gcs-<date>.log
.EXAMPLE
    pwsh -File Backup-HuggingFace.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Bucket = 'rabbitsoftware-io-backups',
    [switch]$Register,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$taskName = 'RabbitOS Hugging Face to Google Cloud'

if ($Remove) {
    if ($preview) { Write-Host "What if: remove the task '$taskName'"; return }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host "removed: $taskName" } else { Write-Host "no such task: $taskName" }
    return
}
if ($Register) {
    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($preview) { Write-Host "What if: register '$taskName' nightly at 02:30: pwsh $arg"; return }
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg
    $trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "registered: $taskName (nightly 02:30, up to 6 hours). Logs: $HOME\RabbitOS\logs\hf-gcs-<date>.log" -ForegroundColor Green
    return
}

$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("hf-gcs-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $log -Value $line; Write-Host $line }
# A scheduled task can start with a shorter PATH than a terminal: add the usual Python Scripts folders (where pip puts hf.exe) and the Google Cloud SDK.
trap { Log ("FAIL  " + $_.Exception.Message); exit 1 }   # a run started by Task Scheduler has no console, so always leave the reason in the log
foreach ($extra in (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\Scripts'), (Join-Path $env:APPDATA 'Python\Python312\Scripts'), (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin')) { if ((Test-Path $extra) -and ($env:PATH -notlike "*$extra*")) { $env:PATH = "$env:PATH;$extra" } }
foreach ($tool in 'hf', 'gcloud') { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Log "FAIL  $tool is not installed or not on PATH (PATH seen by this run: $($env:PATH.Length) characters)"; exit 1 } }

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\RabbitOS-HfBackup', [ref]$created)
if (-not $created -and -not $preview) { Log 'another run is still going; skipping this one'; return }

$whoRaw = (& hf auth whoami 2>&1 | Out-String)
# The output differs by context: "user=NAME" when piped, "[OK] Logged in  user: NAME" (with colour codes) when the process has a console, as under Task Scheduler.
$who = if (($whoRaw -replace "`e\[[0-9;]*m", '') -match 'user[=:]\s*([A-Za-z0-9_.-]+)') { $Matches[1] } else { $null }
if (-not $who) {
    $clean = ($whoRaw -replace '\s+', ' ').Trim()
    if ($clean.Length -gt 300) { $clean = $clean.Substring(0, 300) }
    throw "Not signed in to Hugging Face. Run: hf auth login. hf said: $clean | HOME=$env:HOME USERPROFILE=$env:USERPROFILE HF_HOME=$env:HF_HOME"
}
$user = $who
Log "signed in to Hugging Face as $user"

$buckets = @(& hf buckets list --format json 2>$null | ConvertFrom-Json)
$datasets = @(& hf datasets list --author $user --format json 2>$null | ConvertFrom-Json)
Log ("{0} buckets, {1} datasets in the namespace {2}" -f $buckets.Count, $datasets.Count, $user)
foreach ($b in $buckets) { Log ("  bucket  {0}  {1:N1} MB, {2} files, {3}" -f $b.id, ($b.size / 1MB), $b.total_files, $(if ($b.private) { 'private' } else { 'public' })) }
foreach ($d in $datasets) { Log ("  dataset {0}  {1}" -f $d.id, $(if ($d.private) { 'private' } else { 'public' })) }
if ($preview) { Write-Host "`nWhat if: nothing was downloaded or uploaded."; return }

$stage = Join-Path $env:LOCALAPPDATA 'RabbitOS\hf-stage'
New-Item -ItemType Directory -Force $stage | Out-Null
$failed = 0
function Copy-Up([string]$local, [string]$kind, [string]$name) {
    $out = & gcloud storage rsync $local "gs://$Bucket/huggingface/$kind/$name" --recursive --project $Project 2>&1
    if ($LASTEXITCODE -ne 0) { throw ("upload failed: " + (($out | Select-Object -Last 2) -join ' | ')) }
}
foreach ($b in $buckets) {
    $name = ($b.id -split '/', 2)[1]
    if ($b.total_files -eq 0) { Log "bucket $name is empty; nothing to copy"; continue }
    try {
        $dir = Join-Path $stage "buckets\$name"; New-Item -ItemType Directory -Force $dir | Out-Null
        Log "download bucket $($b.id)"
        $o = & hf buckets sync "hf://buckets/$($b.id)" $dir 2>&1; if ($LASTEXITCODE -ne 0) { throw ("download failed: " + (($o | Select-Object -Last 2) -join ' | ')) }
        Copy-Up $dir 'buckets' $name; Log "OK    bucket $name"
    } catch { $failed++; Log "FAIL  bucket ${name}: $($_.Exception.Message)" }
}
foreach ($d in $datasets) {
    $name = ($d.id -split '/', 2)[1]
    try {
        $dir = Join-Path $stage "datasets\$name"; New-Item -ItemType Directory -Force $dir | Out-Null
        Log "download dataset $($d.id)"
        $o = & hf download $d.id --repo-type dataset --local-dir $dir 2>&1; if ($LASTEXITCODE -ne 0) { throw ("download failed: " + (($o | Select-Object -Last 2) -join ' | ')) }
        Copy-Up $dir 'datasets' $name; Log "OK    dataset $name"
    } catch { $failed++; Log "FAIL  dataset ${name}: $($_.Exception.Message)" }
}
Log "Hugging Face backup finished; failed items: $failed"
exit ([int]($failed -gt 0))
