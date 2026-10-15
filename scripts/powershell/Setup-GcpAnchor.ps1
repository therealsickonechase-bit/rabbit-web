<#
.SYNOPSIS
    Bitcoin anchoring for the RabbitOS chains on Google Cloud (project rabbitsoftware-io, us-west2), through OpenTimestamps. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Cloud Run job rabbit-anchor   reads the public ledger head and the Maxwell chain, builds one small public document, sends its SHA-256 digest to the public OpenTimestamps calendars
                                  (they batch many digests into one Bitcoin transaction), stores the proof, and upgrades earlier proofs once Bitcoin has confirmed them.
    Output (public)               gs://rabbitsoftware-io-ledger-public/anchors/<id>/anchor.json and anchor.json.ots, plus anchors/index.json and anchors/latest.json
    Cost                          nothing per anchor (no wallet, no fee); a few seconds of Cloud Run per day
    Account rabbit-anchor-job     may write ONLY objects whose name starts with anchors/ in the public ledger bucket (an IAM condition), and reads nothing private. No keys, no secrets.
    Account rabbit-anchor-scheduler  may run this one job
    Schedule                      every 6 hours (Los Angeles time); it makes a new anchor only when the public heads changed, and upgrades proofs once Bitcoin confirms them
    Anyone can check a proof with the standard `ots verify anchor.json.ots` and a Bitcoin node. What it proves: that exact document existed by that Bitcoin block.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\anchor-job',
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
$jobSa = "rabbit-anchor-job@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/anchor-job:latest"
function Bind($member, $role, [string]$kind, [string]$resource, [string]$condition) {
    foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
        $null = switch ($kind) {
            'bucket' { & gcloud storage buckets add-iam-policy-binding "gs://$resource" --member $member --role $role --project $Project --condition "expression=$condition,title=only-anchors-prefix" 2>&1 }
            'job'    { & gcloud run jobs add-iam-policy-binding $resource --region $Region --project $Project --member $member --role $role --quiet 2>&1 }
        }
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 8
    }
    throw "Could not grant $role to $member on $kind $resource"
}

Step 'Service accounts'
Invoke-IfLive 'create rabbit-anchor-job and rabbit-anchor-scheduler; the job account may write only anchors/ in the public ledger bucket' {
    foreach ($name in 'rabbit-anchor-job', 'rabbit-anchor-scheduler') {
        if (-not (Exists iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $name --project $Project --display-name "RabbitOS $name" }
    }
    $cond = "resource.name.startsWith(""projects/_/buckets/$LedgerBucket/objects/anchors/"")"
    Bind "serviceAccount:$jobSa" 'roles/storage.objectAdmin' 'bucket' $LedgerBucket $cond
}

Step 'Build the image'
Invoke-IfLive "build $JobDir as $image" { Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet }

Step 'Cloud Run job rabbit-anchor'
Invoke-IfLive 'deploy the job (512 MiB, 5 minute limit, no retries)' {
    Invoke-Gcloud run jobs deploy rabbit-anchor --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 300s --max-retries 0 --set-env-vars "LEDGER_BUCKET=$LedgerBucket" --quiet
    Bind "serviceAccount:$schSa" 'roles/run.invoker' 'job' 'rabbit-anchor' $null
}

Step 'Every 6 hours (new anchors only when the public heads changed; the rest of the runs upgrade proofs Bitcoin has confirmed)'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-anchor-daily' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-anchor:run"
    if (Exists scheduler jobs describe rabbit-anchor-daily --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-anchor-daily' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-anchor-daily --project $Project --location $Region --schedule '0 */6 * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

if ($RunNow) {
    Step 'Run the anchor once now'
    Invoke-IfLive 'gcloud run jobs execute rabbit-anchor --wait, then read anchors/latest.json' {
        Invoke-Gcloud run jobs execute rabbit-anchor --project $Project --region $Region --wait
        Invoke-RestMethod "https://$LedgerBucket.storage.googleapis.com/anchors/latest.json?cb=$([guid]::NewGuid().ToString('N'))" | ConvertTo-Json
    }
}
Write-Host "`nDone. Proofs: https://$LedgerBucket.storage.googleapis.com/anchors/index.json" -ForegroundColor Green
