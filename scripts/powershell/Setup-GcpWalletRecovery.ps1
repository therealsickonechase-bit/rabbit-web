<#
.SYNOPSIS
    Protects the wallet key from being lost on Google Cloud (project rabbitsoftware-io). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    The wallet key was created inside a hardware security module. It can never be exported, so there is no seed phrase and no backup file: the key exists only while the project and the key version exist.
    "Recovery" therefore means (1) not losing the key by accident and (2) never keeping more in the wallet than you could lose. This script does the first part:
    1. Project lien      a lien that blocks deleting the project (resourcemanager.projects.delete) until you remove the lien on purpose. Deleting the project would destroy the key.
    2. Key alert         a log-based metric and email alert whenever anything on key ring rabbit-wallet is destroyed, disabled, restored, updated, or has its permissions changed (Admin Activity logs, always on).
    3. Status report     prints the key's state, its destroy delay (a destroyed key version stays recoverable for 30 days), who is Owner, who can sign, and whether the lien and alert exist.
    It cannot add a second Owner for you: that needs a second Google account you choose (see docs/wallet.md, "Recovery").
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Location = 'us-west2',
    [string]$KeyRing = 'rabbit-wallet'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$number = (& gcloud projects describe $Project --format 'value(projectNumber)').Trim()
$tok = (gcloud auth print-access-token).Trim()
$h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }

Step 'Project lien (blocks deleting the project)'
$lienUri = 'https://cloudresourcemanager.googleapis.com/v1/liens'
$have = @((Invoke-RestMethod "$lienUri`?parent=projects/$number" -Headers $h).liens | Where-Object { $_.restrictions -contains 'resourcemanager.projects.delete' })
if ($have.Count) { Write-Host "lien exists: $($have[0].name) - $($have[0].reason)" }
else {
    Invoke-IfLive 'create a lien that blocks resourcemanager.projects.delete' {
        $body = @{ parent = "projects/$number"; restrictions = @('resourcemanager.projects.delete'); origin = 'rabbit-wallet-recovery'; reason = 'Holds the hardware wallet key (it cannot be exported). Deleting the project would destroy it. Remove this lien only on purpose.' } | ConvertTo-Json
        $l = Invoke-RestMethod -Method Post -Uri $lienUri -Headers $h -ContentType 'application/json' -Body $body
        Write-Host "created lien: $($l.name)"
    }
}

Step 'Alert when the wallet keys are changed'
Invoke-IfLive 'create the log-based metric wallet_key_change and an email alert policy' {
    $f = 'protoPayload.serviceName="cloudkms.googleapis.com" AND protoPayload.resourceName:"keyRings/' + $KeyRing + '/" AND protoPayload.methodName:("DestroyCryptoKeyVersion" OR "RestoreCryptoKeyVersion" OR "UpdateCryptoKeyVersion" OR "UpdateCryptoKey" OR "SetIamPolicy" OR "DestroyCryptoKey" OR "CreateCryptoKeyVersion" OR "ImportCryptoKeyVersion")'
    if (Exists logging metrics describe wallet_key_change --project $Project) { Invoke-Gcloud logging metrics update wallet_key_change --project $Project --description 'A wallet key on Cloud KMS was destroyed, disabled, restored, updated or had its permissions changed' --log-filter $f }
    else { Invoke-Gcloud logging metrics create wallet_key_change --project $Project --description 'A wallet key on Cloud KMS was destroyed, disabled, restored, updated or had its permissions changed' --log-filter $f }
    $mon = "https://monitoring.googleapis.com/v3/projects/$Project"
    $channel = (Invoke-RestMethod "$mon/notificationChannels" -Headers $h).notificationChannels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
    if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
    $name = 'RabbitOS: a wallet key was changed'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    # A log-match alert fires straight from the Admin Activity log, so it needs no metric and no waiting for Monitoring to see one.
    $cond = @{ displayName = 'Wallet key change'; conditionMatchedLog = @{ filter = $f } }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; conditions = @($cond); notificationChannels = @($channel.name)
        alertStrategy = @{ notificationRateLimit = @{ period = '300s' } }
        documentation = @{ mimeType = 'text/markdown'; content = 'Something changed on the Cloud KMS key ring rabbit-wallet (a key version was destroyed or restored, a key was updated or created, or permissions changed). If you did not do this, check Cloud Logging for the principal and treat it as an incident. A destroyed key version stays recoverable for 30 days: restore it with gcloud kms keys versions restore.' } } | ConvertTo-Json -Depth 8
    $created = $false
    foreach ($try in 1..24) {
        try { [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body); $created = $true; break }
        catch { if ("$($_.ErrorDetails.Message)" -notmatch 'Cannot find metric') { throw }; Write-Host "metric not visible to Monitoring yet (attempt $try of 24); waiting"; Start-Sleep -Seconds 30 }
    }
    if (-not $created) { throw 'Monitoring still cannot see the new metric; run this script again in a few minutes.' }
    Write-Host "created alert policy: $name"
}

Step 'Status of the wallet keys'
foreach ($key in 'maxwell-donations', 'anchor-signer') {
    $k = & gcloud kms keys describe $key --keyring $KeyRing --location $Location --project $Project --format json 2>$null | ConvertFrom-Json
    if (-not $k) { Write-Host "${key}: not found"; continue }
    $v = & gcloud kms keys versions list --key $key --keyring $KeyRing --location $Location --project $Project --format 'value(name.basename(),state)' 2>$null
    Write-Host ("{0}: algorithm {1}, protection {2}, destroy delay {3}s, versions: {4}" -f $key, $k.versionTemplate.algorithm, $k.versionTemplate.protectionLevel, ($k.destroyScheduledDuration -replace 's$', ''), (($v -join '; ') -replace "`t", ' '))
    $pol = & gcloud kms keys get-iam-policy $key --keyring $KeyRing --location $Location --project $Project --format json | ConvertFrom-Json
    $signers = @($pol.bindings | Where-Object { $_.role -match 'signer' } | ForEach-Object { $_.members } )
    Write-Host ("  who can sign: {0}" -f $(if ($signers.Count) { $signers -join ', ' } else { 'nobody (only you, from your own sign-in, through withdraw.mjs after granting yourself)' }))
}
$owners = (& gcloud projects get-iam-policy $Project --flatten 'bindings[]' --filter 'bindings.role:roles/owner' --format 'value(bindings.members)') -join ', '
Write-Host "project Owner(s): $owners"
if (($owners -split ',').Count -lt 2) { Write-Host 'WARNING: only one Owner. If that Google account is lost or locked, the key is unreachable. Consider adding a second Owner you trust (see docs/wallet.md).' -ForegroundColor Yellow }
Write-Host "`nDone." -ForegroundColor Green
