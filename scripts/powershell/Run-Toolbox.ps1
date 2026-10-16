<#
.SYNOPSIS
    Publishes the toolbox (the command catalog and the files the commands use) to the private cloud bucket, or checks what would be published. Used by the daily backup job.
.DESCRIPTION
    Runs rabbit-web\scripts\toolbox-publish.mjs with Node (the PATH is extended with the usual install folders, because a scheduled task may not have it). Your own gcloud sign-in uploads.
    Only git-tracked code, scripts and documents that pass the secret scan are published; see the script and src\lib\toolbox.ts.
.EXAMPLE
    pwsh -File Run-Toolbox.ps1 -DryRun
    pwsh -File Run-Toolbox.ps1
#>
[CmdletBinding()]
param([switch]$DryRun, [string]$WebDir = 'C:\Users\odaat\Projects\rabbit-web')
$ErrorActionPreference = 'Stop'
foreach ($extra in 'C:\Program Files\nodejs', (Join-Path $env:APPDATA 'npm'), (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin'), 'C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin') {
    if ((Test-Path $extra) -and ($env:PATH -notlike "*$extra*")) { $env:PATH = "$env:PATH;$extra" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found on PATH.' }
Push-Location $WebDir
try {
    $args2 = @('scripts/toolbox-publish.mjs'); if ($DryRun) { $args2 += '--dry-run' }
    & node @args2
    if ($LASTEXITCODE -ne 0) { throw "toolbox-publish failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
