<#
.SYNOPSIS
    The wallet's receiving account on Google Cloud (project rabbitsoftware-io, us-west2): a job that watches the wallet addresses and records and announces what arrives. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Receiving itself needs nothing but the public addresses: anyone can send to them at any time, and the funds are controlled by the hardware key in Cloud KMS.
    This adds the Google Cloud side that SEES and RECORDS what arrives:
    Cloud Run job rabbit-wallet-watch   every 30 minutes reads the balances of the two donation addresses (Bitcoin, Ethereum) and the two anchoring fee accounts (Ethereum, XRP Ledger) from public networks,
                                        compares with the last reading, and writes gs://rabbitsoftware-io-reports/wallet/state.json (PRIVATE): balances, total ever received on Bitcoin, the last 50 receipts.
    Alert                               a log line "wallet_received" feeds a log-based metric and an email alert ("RabbitOS: money arrived at a wallet address"), on the same email channel as the other alerts.
    Account rabbit-wallet-watch         no project roles, NO signing permission on any key; it may read and write only objects under wallet/ in the private reports bucket (an IAM condition).
    Cost                                cents a month.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$WalletDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\wallet',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\wallet-watch-job',
    [string]$ReportsBucket = 'rabbitsoftware-io-reports',
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
function Retry([scriptblock]$run, [string]$what) {
    foreach ($try in 1..6) { $null = & $run 2>&1; if ($LASTEXITCODE -eq 0) { return }; Start-Sleep -Seconds 8 }
    throw "Could not: $what"
}
$jobSa = "rabbit-wallet-watch@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/wallet-watch-job:latest"

Step 'Service account (no roles; wallet/ in the private reports bucket only)'
Invoke-IfLive "create $jobSa and let it read and write wallet/ in gs://$ReportsBucket" {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-wallet-watch --project $Project --display-name 'RabbitOS wallet watcher (read only)' }
    $cond = "resource.name.startsWith(""projects/_/buckets/$ReportsBucket/objects/wallet/"")"
    Retry { & gcloud storage buckets add-iam-policy-binding "gs://$ReportsBucket" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition "expression=$cond,title=only-wallet-prefix" } 'grant wallet/ access'
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$jobSa" --format 'value(bindings.role)')
    if ($roles) { throw "The watcher has project roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles, no key access'
}

Step 'Stage the code and build'
Invoke-IfLive "copy wallet-watch.mjs, wallet.json and src\*.mjs into $JobDir\app, then build $image" {
    $app = Join-Path $JobDir 'app'
    if (Test-Path $app) { Remove-Item $app -Recurse -Force }
    New-Item -ItemType Directory -Force (Join-Path $app 'src') | Out-Null
    Copy-Item (Join-Path $WalletDir 'wallet-watch.mjs') $app
    Copy-Item (Join-Path $WalletDir 'wallet.json') $app
    Copy-Item (Join-Path $WalletDir 'src\*.mjs') (Join-Path $app 'src')
    Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet
}

Step 'Cloud Run job rabbit-wallet-watch'
Invoke-IfLive 'deploy the job (512 MiB, 3 minute limit, no retries) and let the scheduler run it' {
    Invoke-Gcloud run jobs deploy rabbit-wallet-watch --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 180s --max-retries 0 --set-env-vars "REPORTS_BUCKET=$ReportsBucket,LEDGER_BUCKET=$LedgerBucket" --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-wallet-watch --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Every 30 minutes'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-wallet-watch-30min' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-wallet-watch:run"
    if (Exists scheduler jobs describe rabbit-wallet-watch-30min --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-wallet-watch-30min' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-wallet-watch-30min --project $Project --location $Region --schedule '*/30 * * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

Step 'Alert when money arrives'
Invoke-IfLive 'create the log-based metrics wallet_received and wallet_watch_failed, and the email alert policy' {
    $base = 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-wallet-watch"'
    $metrics = [ordered]@{
        wallet_received     = @{ d = 'Money arrived at a RabbitOS wallet address'; f = "$base AND jsonPayload.event=`"wallet_received`"" }
        wallet_watch_failed = @{ d = 'The wallet watcher could not read a network or failed'; f = "$base AND (jsonPayload.event=`"wallet_watch_failed`" OR severity>=ERROR)" }
    }
    foreach ($m in $metrics.Keys) {
        if (Exists logging metrics describe $m --project $Project) { Invoke-Gcloud logging metrics update $m --project $Project --description $metrics[$m].d --log-filter $metrics[$m].f }
        else { Invoke-Gcloud logging metrics create $m --project $Project --description $metrics[$m].d --log-filter $metrics[$m].f }
    }
    $tok = (gcloud auth print-access-token).Trim()
    $h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
    $mon = "https://monitoring.googleapis.com/v3/projects/$Project"
    $channel = (Invoke-RestMethod "$mon/notificationChannels" -Headers $h).notificationChannels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
    if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
    $name = 'RabbitOS: money arrived at a wallet address'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    $cond = @{ displayName = 'Money arrived'; conditionThreshold = @{ filter = 'metric.type="logging.googleapis.com/user/wallet_received" AND resource.type="cloud_run_job"'; aggregations = @(@{ alignmentPeriod = '1800s'; perSeriesAligner = 'ALIGN_SUM' }); comparison = 'COMPARISON_GT'; thresholdValue = 0; duration = '0s'; trigger = @{ count = 1 } } }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; conditions = @($cond); notificationChannels = @($channel.name)
        documentation = @{ mimeType = 'text/markdown'; content = 'A RabbitOS wallet address (donation or anchoring fee account) received money. Details: gs://rabbitsoftware-io-reports/wallet/state.json (private). Nothing needs doing unless you did not expect it.' } } | ConvertTo-Json -Depth 8
    $created = $false
    foreach ($try in 1..24) {
        try { [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body); $created = $true; break }
        catch { if ("$($_.ErrorDetails.Message)" -notmatch 'Cannot find metric') { throw }; Write-Host "metric not visible to Monitoring yet (attempt $try of 24); waiting"; Start-Sleep -Seconds 30 }
    }
    if (-not $created) { throw 'Monitoring still cannot see the new metric; run this script again in a few minutes.' }
    Write-Host "created alert policy: $name"
}

if ($RunNow) {
    Step 'Run the watcher once now'
    Invoke-IfLive 'gcloud run jobs execute rabbit-wallet-watch --wait, then read wallet/state.json' {
        Invoke-Gcloud run jobs execute rabbit-wallet-watch --project $Project --region $Region --wait
        gcloud storage cat "gs://$ReportsBucket/wallet/state.json" --project $Project
    }
}
Write-Host "`nDone. State (private): gs://$ReportsBucket/wallet/state.json" -ForegroundColor Green
