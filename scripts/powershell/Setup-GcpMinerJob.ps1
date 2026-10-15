<#
.SYNOPSIS
    Step 2 of 2: runs the rabbit web data miner on Google Cloud (project rabbitsoftware-io, us-west2) every night. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Cloud Run job rabbit-miner runs run_cloud.py: it reads the public Maxwell chain, mines ONE block (signed RABBITWEB_MINER_CLOUD) only if the public snapshot of the web changed, mirrors it to the app
    through the signed ingest FIRST, and only after the app accepts it writes the chain back to the public bucket. If the app says another miner got that block number first (409), nothing is published.
    Your PC adopts cloud blocks before it mines (Run-DailyBackups.ps1, step "Maxwell: adopt the public chain").
    Needs Setup-GcpMinerSecrets.ps1 first (the only script that touches the secret value). This script holds no secret values.
    Accounts (least privilege):
      rabbit-miner-job        reads the secret rabbit-ingest-secret; may write ONE object, maxwell/maxwell_chain.json, in the public ledger bucket (an IAM condition limits it to that name)
      rabbit-miner-scheduler  may run this one job
    Schedule: 05:00 Los Angeles time, after the PC's 03:00 daily job.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\miner-job',
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
$jobSa = "rabbit-miner-job@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-miner-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/miner-job:latest"
$secret = 'rabbit-ingest-secret'
$files = 'run_cloud.py', 'maxwell_adopt.py', 'maxwell_chain_sync.py', 'maxwell_links.py', 'maxwell_research_anchor.py', 'maxwellblockchain.py', 'rabbitweb_miner.py'
function Bind($member, $role, [string]$kind, [string]$resource, [string]$condition) {
    foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
        $null = switch ($kind) {
            'bucket' {
                if ($condition) { & gcloud storage buckets add-iam-policy-binding "gs://$resource" --member $member --role $role --project $Project --condition "expression=$condition,title=only-the-miner-chain-object" 2>&1 }
                else { & gcloud storage buckets add-iam-policy-binding "gs://$resource" --member $member --role $role --project $Project 2>&1 }
            }
            'job' { & gcloud run jobs add-iam-policy-binding $resource --region $Region --project $Project --member $member --role $role --quiet 2>&1 }
        }
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 8
    }
    throw "Could not grant $role to $member on $kind $resource"
}

Step 'Check the secret exists (name only)'
$have = Exists secrets versions describe latest --secret $secret --project $Project
Write-Host ("{0}: {1}" -f $secret, $(if ($have) { 'has a value' } else { 'MISSING' }))
if (-not $preview -and -not $have) { throw 'Run Setup-GcpMinerSecrets.ps1 first (it stores the ingest secret in Secret Manager).' }
foreach ($f in $files) { if (-not (Test-Path (Join-Path $AgentsDir $f))) { throw "missing $f in $AgentsDir" } }

Step 'Service accounts'
Invoke-IfLive 'create rabbit-miner-job (if Setup-GcpMinerSecrets did not) and rabbit-miner-scheduler; the job account may write only maxwell/maxwell_chain.json in the public ledger bucket' {
    foreach ($name in 'rabbit-miner-job', 'rabbit-miner-scheduler') {
        if (-not (Exists iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $name --project $Project --display-name "RabbitOS $name" }
    }
    $cond = "resource.name == ""projects/_/buckets/$LedgerBucket/objects/maxwell/maxwell_chain.json"""
    Bind "serviceAccount:$jobSa" 'roles/storage.objectAdmin' 'bucket' $LedgerBucket $cond
}

Step 'Build the image (the miner files from research-agents are copied next to the Dockerfile)'
Invoke-IfLive "stage $($files.Count) files + Dockerfile and build $image" {
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('miner-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory $stage | Out-Null
    try {
        foreach ($f in $files) { Copy-Item (Join-Path $AgentsDir $f) $stage }
        Copy-Item (Join-Path $JobDir 'Dockerfile') $stage
        Invoke-Gcloud builds submit $stage --project $Project --tag $image --quiet
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

Step 'Cloud Run job rabbit-miner'
Invoke-IfLive 'deploy the job (512 MiB, 10 minute limit, no retries: a failed night is reported, not repeated)' {
    Invoke-Gcloud run jobs deploy rabbit-miner --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 600s --max-retries 0 --set-secrets "RABBIT_INGEST_SECRET=${secret}:latest" --set-env-vars "RABBIT_URL=https://app.rabbitsoftware.io,LEDGER_BUCKET=$LedgerBucket" --quiet
    Bind "serviceAccount:$schSa" 'roles/run.invoker' 'job' 'rabbit-miner' $null
}

Step 'Every night at 05:00 Los Angeles time'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-miner-nightly' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-miner:run"
    if (Exists scheduler jobs describe rabbit-miner-nightly --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-miner-nightly' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-miner-nightly --project $Project --location $Region --schedule '0 5 * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

if ($RunNow) {
    Step 'Run the miner once now'
    Invoke-IfLive 'gcloud run jobs execute rabbit-miner --wait' {
        Invoke-Gcloud run jobs execute rabbit-miner --project $Project --region $Region --wait
    }
}
Write-Host "`nDone. Check it with: pwsh -File scripts\powershell\Test-CloudMiner.ps1" -ForegroundColor Green
