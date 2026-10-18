<#
.SYNOPSIS
    Tests the PUBLISHED Maxwell Core release on real Google Cloud machines: arm64 Linux (the Raspberry Pi path), x64 Linux, and Windows Server (machine-wide, as SYSTEM). -WhatIf shows the plan and creates nothing.
.DESCRIPTION
    Each VM downloads the release from rabbitsoftware.io exactly as a user would, checks it against the signed checksum, installs it, checks that the node verifies the chain and matches the cloud gateway,
    then REBOOTS to prove it starts by itself, and checks again. Results are read from each VM's serial console ("MC-TEST:" lines). There is no macOS on Google Cloud.

    Cost and safety: three small VMs for roughly 20 to 40 minutes, a few tens of US cents in total. Every VM is labelled purpose=maxwell-core-test, has no service account and no roles, and is created with a
    maximum run time of 90 minutes after which Google deletes it even if this script dies. They are deleted when the run ends (add -Keep to look around; then delete them with the command printed).
    The existing VM rabbit-egress-proxy is never touched: only VMs named mc-test-* are created or deleted.
.EXAMPLE
    .\Test-CloudPlatforms.ps1 -WhatIf
    .\Test-CloudPlatforms.ps1
    .\Test-CloudPlatforms.ps1 -SkipWindows
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Zone = 'us-central1-a',          # an arm64 (T2A) zone
    [switch]$SkipWindows,
    [string[]]$Only = @(),                     # re-run just some machines, for example -Only mc-test-win
    [switch]$Keep,
    [switch]$FromMirror,                       # download the release from the Google Cloud copy instead of rabbitsoftware.io
    [int]$TimeoutMinutes = 45
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$here = Join-Path $PSScriptRoot 'cloud-test'

$targets = @(
    @{ Name = 'mc-test-arm64'; Type = 't2a-standard-1'; Family = 'debian-12-arm64'; Project = 'debian-cloud'; Script = 'linux-check.sh'; Key = 'startup-script'; Mode = 'pi'; Disk = '20GB'; Label = 'arm64 Linux, Raspberry Pi setup path' },
    @{ Name = 'mc-test-x64'; Type = 'e2-small'; Family = 'debian-12'; Project = 'debian-cloud'; Script = 'linux-check.sh'; Key = 'startup-script'; Mode = 'linux'; Disk = '20GB'; Label = 'x64 Linux, standard installer' }
)
if (-not $SkipWindows) {
    $targets += @{ Name = 'mc-test-win'; Type = 'e2-medium'; Family = 'windows-2022'; Project = 'windows-cloud'; Script = 'windows-check.ps1'; Key = 'windows-startup-script-ps1'; Mode = ''; Disk = '50GB'; Label = 'Windows Server 2022, machine-wide (-System)' }
}
if ($Only.Count) { $targets = @($targets | Where-Object { $Only -contains $_.Name }) }
foreach ($t in $targets) { if (-not (Test-Path (Join-Path $here $t.Script))) { throw "missing $($t.Script)" } }

Write-Host "Project $Project, zone $Zone. VMs: $(($targets | ForEach-Object { $_.Name }) -join ', ')"
Write-Host 'Estimated cost: a few tens of US cents. Each VM deletes itself after 90 minutes at most.'
if ($preview) {
    foreach ($t in $targets) { Write-Host ("What if: create {0} ({1}, {2}) running {3}: {4}" -f $t.Name, $t.Type, $t.Family, $t.Script, $t.Label) }
    Write-Host 'What if: poll the serial consoles for MC-TEST lines until each prints MC-TEST-RESULT, then delete the VMs.'
    return
}

# the run-time limit flag is newer than some gcloud builds: use the beta command if the normal one does not have it
$cmd = @('compute', 'instances', 'create')
if (-not ((gcloud compute instances create --help 2>&1 | Out-String) -match 'max-run-duration')) { $cmd = @('beta', 'compute', 'instances', 'create') }

$created = @()
try {
    foreach ($t in $targets) {
        Write-Host "Creating $($t.Name) ..."
        $args2 = $cmd + @($t.Name, "--project=$Project", "--zone=$Zone", "--machine-type=$($t.Type)", "--image-family=$($t.Family)", "--image-project=$($t.Project)",
            "--boot-disk-size=$($t.Disk)", '--boot-disk-type=pd-balanced', '--labels=purpose=maxwell-core-test', '--max-run-duration=90m', '--instance-termination-action=DELETE',
            '--no-service-account', '--no-scopes', "--metadata-from-file=$($t.Key)=$(Join-Path $here $t.Script)", '--quiet')
        $meta = @(); if ($t.Mode) { $meta += "mc-mode=$($t.Mode)" }; if ($FromMirror) { $meta += 'mc-base=https://rabbitsoftware-io-ledger-public.storage.googleapis.com/releases/maxwell-core' }
        if ($meta.Count) { $args2 += "--metadata=$($meta -join ',')" }
        & gcloud @args2 2>&1 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "could not create $($t.Name)" }
        $created += $t.Name
        $t.Offset = 0; $t.Lines = @(); $t.Result = $null
    }

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    while ((Get-Date) -lt $deadline -and ($targets | Where-Object { -not $_.Result })) {
        Start-Sleep 30
        foreach ($t in $targets | Where-Object { -not $_.Result }) {
            $raw = gcloud compute instances get-serial-port-output $t.Name --project=$Project --zone=$Zone --port=1 --start=$($t.Offset) 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { continue }
            $t.Offset += [Text.Encoding]::UTF8.GetByteCount($raw)
            foreach ($line in ($raw -split "`r?`n")) {
                if ($line -match 'MC-TEST: (.*)$') {
                    $msg = $Matches[1].Trim(); if ($t.Lines -contains $msg) { continue }; $t.Lines += $msg; Write-Host ("[{0}] {1}" -f $t.Name, $msg)
                    if ($msg -match '^MC-TEST-RESULT: (PASS|FAIL.*)$') { $t.Result = $Matches[1] }
                }
            }
        }
    }
}
finally {
    if (-not $Keep) {
        if ($created.Count) {
            Write-Host "Deleting $($created -join ', ') ..."
            gcloud compute instances delete @created --project=$Project --zone=$Zone --quiet 2>&1 | ForEach-Object { Write-Host "  $_" }
        }
    } elseif ($created.Count) { Write-Host "Kept. Delete with: gcloud compute instances delete $($created -join ' ') --project=$Project --zone=$Zone --quiet" }
}

Write-Host ''
Write-Host '=== Summary ==='
$bad = 0
foreach ($t in $targets) {
    $pass = ($t.Lines | Where-Object { $_ -like 'PASS *' }).Count; $failN = ($t.Lines | Where-Object { $_ -like 'FAIL *' }).Count
    $r = if ($t.Result) { $t.Result } else { 'NO RESULT (timed out)' }
    if ($r -ne 'PASS') { $bad++ }
    Write-Host ("{0,-16} {1,-44} {2} ({3} checks passed, {4} failed)" -f $t.Name, $t.Label, $r, $pass, $failN)
}
if ($bad) { exit 1 }
