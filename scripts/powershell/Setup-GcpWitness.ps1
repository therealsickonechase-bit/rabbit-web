<#
.SYNOPSIS
    The cloud witness of the Maxwell chain on Google Cloud (project rabbitsoftware-io, us-west2): a Cloud Run job with its OWN key that independently checks the public chain and signs the head. Idempotent. -WhatIf prints the plan.
.DESCRIPTION
    A witness is a peer that downloads the public chain, recomputes every hash, link and work target itself, remembers the last head it signed, and signs only what it verified (docs/peer-review.md).
    The owner's PC runs one witness (Run-Witness.ps1). This is a second one on different infrastructure with a different key, so a head signed by both has been checked twice by separate parties.
    Cloud Run job rabbit-witness      runs workers/witness-job/run.mjs. Its private key lives ONLY in Secret Manager (cloud-witness-key) and reaches the job as an environment variable.
    Key creation                      the key is generated in memory and piped straight into Secret Manager: it is never written to disk, never printed, never in the repository. Only the PUBLIC half is shown (and saved to
                                      ~\RabbitOS\witness\cloud-witness.pub) so you can list it in site/witness/registry.json.
    Account rabbit-witness-job        may write ONLY objects named witness/cloud-witness/... in the public ledger bucket (an IAM condition) and read ONLY the one secret. No other access.
    Account rabbit-witness-scheduler  may run this one job
    Schedule                          every 6 hours at :45 (Los Angeles time), after the anchor job
    Output (public)                   gs://rabbitsoftware-io-ledger-public/witness/cloud-witness/cosignature.json and state.json
    A refused run (the chain does not verify, is shorter, or has a different history) logs an ERROR with the event witness_conflict or witness_refused and exits non-zero.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\witness-job',
    [string]$LedgerBucket = 'rabbitsoftware-io-ledger-public',
    [string]$WitnessName = 'cloud-witness',
    [string]$SecretName = 'cloud-witness-key',
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$jobSa = "rabbit-witness-job@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-witness-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/witness-job:latest"
function Bind($member, $role, [string]$kind, [string]$resource, [string]$condition) {
    foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
        $null = switch ($kind) {
            'bucket' { & gcloud storage buckets add-iam-policy-binding "gs://$resource" --member $member --role $role --project $Project --condition "expression=$condition,title=only-own-witness-prefix" 2>&1 }
            'secret' { & gcloud secrets add-iam-policy-binding $resource --member $member --role $role --project $Project --quiet 2>&1 }
            'job'    { & gcloud run jobs add-iam-policy-binding $resource --region $Region --project $Project --member $member --role $role --quiet 2>&1 }
        }
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 8
    }
    throw "Could not grant $role to $member on $kind $resource"
}

Step 'Service accounts'
Invoke-IfLive "create rabbit-witness-job and rabbit-witness-scheduler; the job account may write only witness/$WitnessName/ in the public ledger bucket" {
    foreach ($name in 'rabbit-witness-job', 'rabbit-witness-scheduler') {
        if (-not (Exists iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $name --project $Project --display-name "RabbitOS $name" }
    }
    $cond = "resource.name.startsWith(""projects/_/buckets/$LedgerBucket/objects/witness/$WitnessName/"")"
    Bind "serviceAccount:$jobSa" 'roles/storage.objectAdmin' 'bucket' $LedgerBucket $cond
}

Step "The witness key ($SecretName in Secret Manager)"
Invoke-IfLive "generate an Ed25519 key in memory, pipe the private half into Secret Manager, show only the public half" {
    $pubOut = Join-Path $HOME "RabbitOS\witness\$WitnessName.pub"
    New-Item -ItemType Directory -Force (Split-Path $pubOut) | Out-Null
    if (Exists secrets describe $SecretName --project $Project) {
        Write-Host "secret exists: $SecretName (not changed). Its public key is in $pubOut if it was created from this PC."
    } else {
        $tmpPub = Join-Path $env:TEMP ("witness-pub-" + [guid]::NewGuid().ToString('N') + '.json')
        node (Join-Path $JobDir 'keygen-to-stdout.mjs') $WitnessName $tmpPub | & gcloud secrets create $SecretName --project $Project --replication-policy automatic --data-file=-
        if ($LASTEXITCODE -ne 0) { Remove-Item $tmpPub -ErrorAction SilentlyContinue; throw 'could not create the secret' }
        Move-Item $tmpPub $pubOut -Force
        Write-Host "created secret $SecretName. PUBLIC key (safe to publish):" -ForegroundColor Green
        Get-Content $pubOut
    }
    Bind "serviceAccount:$jobSa" 'roles/secretmanager.secretAccessor' 'secret' $SecretName $null
}

Step 'Build the image'
Invoke-IfLive "build $JobDir as $image" { Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet }

Step 'Cloud Run job rabbit-witness'
Invoke-IfLive 'deploy the job (512 MiB, 2 minute limit, no retries; the key comes from Secret Manager)' {
    Invoke-Gcloud run jobs deploy rabbit-witness --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 120s --max-retries 0 --set-env-vars "LEDGER_BUCKET=$LedgerBucket,WITNESS_NAME=$WitnessName" --set-secrets "WITNESS_KEY_PEM=${SecretName}:latest"
    Bind "serviceAccount:$schSa" 'roles/run.invoker' 'job' 'rabbit-witness' $null
}

Step 'Every 6 hours at :45'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-witness-6h' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-witness:run"
    if (Exists scheduler jobs describe rabbit-witness-6h --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-witness-6h' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-witness-6h --project $Project --location $Region --schedule '45 */6 * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa }
}

if ($RunNow) {
    Step 'Run the witness once now'
    Invoke-IfLive "gcloud run jobs execute rabbit-witness --wait, then read witness/$WitnessName/cosignature.json" {
        Invoke-Gcloud run jobs execute rabbit-witness --project $Project --region $Region --wait
        Invoke-RestMethod "https://$LedgerBucket.storage.googleapis.com/witness/$WitnessName/cosignature.json?cb=$([guid]::NewGuid().ToString('N'))" | ConvertTo-Json
    }
}
Write-Host "`nDone. Next: add the public key above to site/witness/registry.json (name $WitnessName) and deploy the site." -ForegroundColor Green
