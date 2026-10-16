<#
.SYNOPSIS
    Moves the RabbitOS task worker (one of the PC agents) into Google Cloud (project rabbitsoftware-io, us-west2): a Cloud Run job that picks up approved tasks every 5 minutes. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Cloud Run job rabbit-task-worker runs `task_worker.py --once` from research-agents: it claims at most one task from the RabbitOS task queue (Agent tasks page), runs it against PUBLIC sources only
    (research_topic: PubMed, Europe PMC, ClinicalTrials.gov; crispr_guides: NCBI RefSeq; brain_search: PubMed and Europe PMC) and sends back a PROPOSAL. Nothing it finds enters the shared research until
    the owner approves it on the website. No personal data (EEG, wearables, labs) is read or handled.
    Secret: rabbit-ingest-secret (already in Secret Manager from Setup-GcpMinerSecrets.ps1); this script holds no secret values.
    Accounts (least privilege):
      rabbit-task-worker      reads that one secret, nothing else (no project roles, no buckets)
      rabbit-anchor-scheduler may run this one job (the scheduler account already used by the other jobs)
    Schedule: every 5 minutes, like the PC task. The PC task "RabbitOS Task Worker" can keep running: the queue hands each task to one worker only. Disable it with
    Disable-ScheduledTask -TaskName 'RabbitOS Task Worker' once you trust the cloud one.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\task-worker-job',
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
$jobSa = "rabbit-task-worker@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/task-worker-job:latest"
$secret = 'rabbit-ingest-secret'
$files = 'task_worker.py', 'rabbit_sync.py', 'multi_source_research.py', 'extended_research_sources.py', 'research_matcher.py', 'http_util.py', 'brain_research.py', 'crispr_data.py', 'crispr_guide_design.py'

Step 'Check the secret exists (name only) and the files are there'
$have = Exists secrets versions describe latest --secret $secret --project $Project
Write-Host ("{0}: {1}" -f $secret, $(if ($have) { 'has a value' } else { 'MISSING' }))
if (-not $preview -and -not $have) { throw 'Run Setup-GcpMinerSecrets.ps1 first (it stores the ingest secret in Secret Manager).' }
foreach ($f in $files) { if (-not (Test-Path (Join-Path $AgentsDir $f))) { throw "missing $f in $AgentsDir" } }

Step "Service account $jobSa (reads one secret, nothing else)"
Invoke-IfLive 'create the account, let it read rabbit-ingest-secret, and confirm it has no project roles' {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-task-worker --project $Project --display-name 'RabbitOS task worker (public sources only)' }
    Retry { & gcloud secrets add-iam-policy-binding $secret --member "serviceAccount:$jobSa" --role roles/secretmanager.secretAccessor --project $Project } 'let the task worker read the ingest secret'
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$jobSa" --format 'value(bindings.role)')
    if ($roles) { throw "The task worker has project roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step 'Build the image (the nine research-agents files are copied next to the Dockerfile)'
Invoke-IfLive "stage $($files.Count) files + Dockerfile and build $image" {
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('taskworker-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory $stage | Out-Null
    try {
        foreach ($f in $files) { Copy-Item (Join-Path $AgentsDir $f) $stage }
        Copy-Item (Join-Path $JobDir 'Dockerfile') $stage
        Invoke-Gcloud builds submit $stage --project $Project --tag $image --quiet
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

Step 'Cloud Run job rabbit-task-worker'
Invoke-IfLive 'deploy the job (512 MiB, 10 minute limit, no retries) with the ingest secret mounted from Secret Manager' {
    Invoke-Gcloud run jobs deploy rabbit-task-worker --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 600s --max-retries 0 `
        --set-secrets "RABBIT_INGEST_SECRET=${secret}:latest" --set-env-vars 'RABBIT_URL=https://app.rabbitsoftware.io,RABBIT_TASK_NODE_ID=cloud-task-worker' --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-task-worker --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Every 5 minutes'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-task-worker-5min' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-task-worker:run"
    if (Exists scheduler jobs describe rabbit-task-worker-5min --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-task-worker-5min' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-task-worker-5min --project $Project --location $Region --schedule '*/5 * * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

if ($RunNow) {
    Step 'Run once now (an empty queue is a normal, successful result)'
    Invoke-IfLive 'gcloud run jobs execute rabbit-task-worker --wait, then show its log' {
        Invoke-Gcloud run jobs execute rabbit-task-worker --project $Project --region $Region --wait
        & gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-task-worker"' --project $Project --limit 8 --freshness 10m --format 'value(timestamp.date("%H:%M:%S"),textPayload)'
    }
}
Write-Host "`nDone." -ForegroundColor Green
