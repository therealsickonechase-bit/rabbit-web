<#
.SYNOPSIS
    Ethereum and XRP Ledger anchoring for the RabbitOS chains on Google Cloud (project rabbitsoftware-io, us-west2). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Key rabbit-wallet/anchor-signer   a SEPARATE hardware (HSM) secp256k1 key just for anchoring. It holds only a little gas money. The donation key (maxwell-donations) is never used by automation.
    Cloud Run job rabbit-anchor-chains  reads the newest anchor from the public bucket and posts the same SHA-256 digest into one Ethereum transaction (zero value, to itself, data = RBOS + 1 + digest)
                                        and one XRP Ledger AccountSet memo. Output (public): anchors/<id>/ethereum.json, xrpl.json, and anchors/chains.json.
    Account rabbit-anchor-chains      may sign with the anchor-signer key ONLY, and may write ONLY objects under anchors/ in the public ledger bucket (an IAM condition). No secrets.
    Guards (in the code)              nothing is sent until the addresses are funded; Ethereum gas cap 60 gwei; at most one transaction per chain per 20 hours; XRPL fee cap 1000 drops (0.001 XRP).
    Schedule                          every 6 hours, 30 minutes after the Bitcoin anchor job.
    Funding (YOU do this, from your own wallet)  the script prints the two addresses. About 0.003 ETH and 3 XRP last for months (one anchor costs about 0.0005 ETH or less and 0.00001 XRP).
    Cost                              an HSM key is about $1-2.50 a month; the job costs cents.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$KeyRing = 'rabbit-wallet',
    [string]$Key = 'anchor-signer',
    [string]$WalletDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\wallet',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\anchor-chains-job',
    [string]$LedgerBucket = 'rabbitsoftware-io-ledger-public',
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$jobSa = "rabbit-anchor-chains@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/anchor-chains-job:latest"
$pubOut = Join-Path $WalletDir 'anchor-public-key.pem'
function Retry([scriptblock]$run, [string]$what) {
    foreach ($try in 1..6) { $null = & $run 2>&1; if ($LASTEXITCODE -eq 0) { return }; Start-Sleep -Seconds 8 }   # a brand-new account can take a few seconds to be visible to IAM
    throw "Could not: $what"
}

Step "Anchoring key $KeyRing/$Key (secp256k1, hardware protected)"
Invoke-IfLive 'create the key if missing, wait until enabled, save its public key' {
    if (-not (Exists kms keys describe $Key --keyring $KeyRing --location $Region --project $Project)) {
        Invoke-Gcloud kms keys create $Key --keyring $KeyRing --location $Region --project $Project --purpose asymmetric-signing --default-algorithm ec-sign-secp256k1-sha256 --protection-level hsm --destroy-scheduled-duration 30d
        Write-Host "created: $Key"
    } else { Write-Host "key exists: $Key" }
    foreach ($try in 1..12) {
        $state = (& gcloud kms keys versions describe 1 --key $Key --keyring $KeyRing --location $Region --project $Project --format 'value(state)' 2>$null)
        if ("$state".Trim() -eq 'ENABLED') { break }
        Write-Host "key version state: $state (waiting)"; Start-Sleep -Seconds 10
    }
    Invoke-Gcloud kms keys versions get-public-key 1 --key $Key --keyring $KeyRing --location $Region --project $Project --output-file $pubOut
    Write-Host "saved: $pubOut"
}

Step 'Service account (signs with the anchoring key only; writes only anchors/)'
Invoke-IfLive "create $jobSa and grant it signerVerifier on the anchor key and objectAdmin on anchors/" {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-anchor-chains --project $Project --display-name 'RabbitOS Ethereum and XRPL anchoring' }
    Retry { & gcloud kms keys add-iam-policy-binding $Key --keyring $KeyRing --location $Region --project $Project --member "serviceAccount:$jobSa" --role roles/cloudkms.signerVerifier --quiet } 'grant signing on the anchor key'
    $cond = "resource.name.startsWith(""projects/_/buckets/$LedgerBucket/objects/anchors/"")"
    Retry { & gcloud storage buckets add-iam-policy-binding "gs://$LedgerBucket" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition "expression=$cond,title=only-anchors-prefix" } 'grant anchors/ write'
    $wallet = (& gcloud kms keys get-iam-policy maxwell-donations --keyring $KeyRing --location $Region --project $Project --format json | ConvertFrom-Json)
    $bad = @($wallet.bindings | Where-Object { $_.members -contains "serviceAccount:$jobSa" })
    if ($bad.Count) { throw 'The anchoring account can reach the donation key. It must not.' }
    Write-Host 'confirmed: the anchoring account has no access to the donation key'
}

Step 'Stage the code and build'
Invoke-IfLive "copy anchor-chains.mjs and src\*.mjs into $JobDir\app, then build $image" {
    $app = Join-Path $JobDir 'app'
    if (Test-Path $app) { Remove-Item $app -Recurse -Force }
    New-Item -ItemType Directory -Force (Join-Path $app 'src') | Out-Null
    Copy-Item (Join-Path $WalletDir 'anchor-chains.mjs') $app
    Copy-Item (Join-Path $WalletDir 'src\*.mjs') (Join-Path $app 'src')
    Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet
}

Step 'Cloud Run job rabbit-anchor-chains'
Invoke-IfLive 'deploy the job (512 MiB, 5 minute limit, no retries)' {
    Invoke-Gcloud run jobs deploy rabbit-anchor-chains --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 300s --max-retries 0 --set-env-vars "LEDGER_BUCKET=$LedgerBucket" --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-anchor-chains --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Every 6 hours, 30 minutes after the Bitcoin anchor'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-anchor-chains-6h' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-anchor-chains:run"
    if (Exists scheduler jobs describe rabbit-anchor-chains-6h --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-anchor-chains-6h' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-anchor-chains-6h --project $Project --location $Region --schedule '30 */6 * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

Step 'The anchoring addresses (public). Fund them yourself to switch anchoring on.'
Invoke-IfLive 'derive the Ethereum and XRP Ledger addresses from the public key' {
    Push-Location $WalletDir; try { & node derive-anchor.mjs } finally { Pop-Location }
}

if ($RunNow) {
    Step 'Run once now (it will say "waiting for funds" until you fund the addresses)'
    Invoke-IfLive 'gcloud run jobs execute rabbit-anchor-chains --wait, then read anchors/chains.json' {
        Invoke-Gcloud run jobs execute rabbit-anchor-chains --project $Project --region $Region --wait
        Invoke-RestMethod "https://$LedgerBucket.storage.googleapis.com/anchors/chains.json?cb=$([guid]::NewGuid().ToString('N'))" | ConvertTo-Json -Depth 6
    }
}
Write-Host "`nDone. Public status: https://$LedgerBucket.storage.googleapis.com/anchors/chains.json" -ForegroundColor Green
