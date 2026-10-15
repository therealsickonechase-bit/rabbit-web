<#
.SYNOPSIS
    Security fix 2: records every use of the wallet key and every read of a secret. Turns on Data Access audit logs for Cloud KMS and Secret Manager. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Without this, only changes (Admin Activity) are logged. A signing request to the wallet key, or a job reading a secret, would leave no record.
    Turned on for   cloudkms.googleapis.com          ADMIN_READ, DATA_READ, DATA_WRITE   (DATA_WRITE includes every AsymmetricSign request)
                    secretmanager.googleapis.com     ADMIN_READ, DATA_READ               (every secret access)
    Where to look   Cloud Logging, log "cloudaudit.googleapis.com%2Fdata_access". The platform's own log retention (30 days by default) applies; they are not copied anywhere else.
    Cost            these two services produce very little volume (a few entries per job run); the first 50 GiB of logs per project each month are free.
    The rest of the project's audit configuration is left exactly as it is.
    Undo            run gcloud projects get-iam-policy, delete the two entries under auditConfigs, and run gcloud projects set-iam-policy with the file.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
$want = @(
    @{ service = 'cloudkms.googleapis.com'; types = @('ADMIN_READ', 'DATA_READ', 'DATA_WRITE') },
    @{ service = 'secretmanager.googleapis.com'; types = @('ADMIN_READ', 'DATA_READ') }
)

Step 'Current audit configuration'
$policy = (& gcloud projects get-iam-policy $Project --format json) | ConvertFrom-Json
$configs = @(); if ($policy.PSObject.Properties['auditConfigs']) { $configs = @($policy.auditConfigs) }
if (-not $configs.Count) { Write-Host 'none (only Admin Activity logs, which are always on)' }
foreach ($c in $configs) { Write-Host ("{0}: {1}" -f $c.service, (($c.auditLogConfigs | ForEach-Object { $_.logType }) -join ', ')) }

$changed = $false
foreach ($w in $want) {
    $existing = $configs | Where-Object { $_.service -eq $w.service } | Select-Object -First 1
    if (-not $existing) {
        $configs += [pscustomobject]@{ service = $w.service; auditLogConfigs = @($w.types | ForEach-Object { [pscustomobject]@{ logType = $_ } }) }
        $changed = $true; continue
    }
    $have = @($existing.auditLogConfigs | ForEach-Object { $_.logType })
    foreach ($t in $w.types) { if ($t -notin $have) { $existing.auditLogConfigs = @($existing.auditLogConfigs) + [pscustomobject]@{ logType = $t }; $changed = $true } }
}

Step 'Change'
if (-not $changed) { Write-Host 'already on for both services; nothing to do'; return }
if ($preview) { foreach ($w in $want) { Write-Host ("What if: turn on {0} for {1}" -f ($w.types -join ', '), $w.service) }; return }
if ($policy.PSObject.Properties['auditConfigs']) { $policy.auditConfigs = $configs } else { $policy | Add-Member -NotePropertyName auditConfigs -NotePropertyValue $configs }
$file = Join-Path ([IO.Path]::GetTempPath()) ('iam-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    $policy | ConvertTo-Json -Depth 20 | Set-Content -Path $file -Encoding ascii
    & gcloud projects set-iam-policy $Project $file --quiet | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'set-iam-policy failed (the policy changed since it was read? run the script again)' }
} finally { Remove-Item $file -Force -ErrorAction SilentlyContinue }

Step 'Result'
$after = (& gcloud projects get-iam-policy $Project --format json) | ConvertFrom-Json
foreach ($c in @($after.auditConfigs)) { Write-Host ("{0}: {1}" -f $c.service, (($c.auditLogConfigs | ForEach-Object { $_.logType }) -join ', ')) }
Write-Host "`nDone. Test it: node workers/wallet/derive.mjs --prove, then look for AsymmetricSign in the data_access log." -ForegroundColor Green
