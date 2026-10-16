<#
.SYNOPSIS
    Moves the research explorer (a PC agent) into Google Cloud (project rabbitsoftware-io, us-west2) as a stateless Cloud Run job that explores queued research topics every hour. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Cloud Run job rabbit-research-explorer runs cloud_explorer.py from research-agents. It keeps NO files: it reads the topic queue from the RabbitOS app (the public data hub table research_topics), explores up to two
    queued topics on PUBLIC sources only (PubMed, Europe PMC, ClinicalTrials.gov) and sends the result back through the signed ingest (topic marked explored, one run, its records). The app is the shared state, so this job
    cannot overwrite what the PC explorers keep, and the ingest upserts by id, so a topic both sides explored is refreshed, never duplicated. No personal data is read or handled.
    Secret: rabbit-ingest-secret (already in Secret Manager); this script holds no secret values.
    Accounts (least privilege):
      rabbit-research-explorer  reads that one secret, nothing else (no project roles, no buckets)
      rabbit-anchor-scheduler   may run this one job (the scheduler account already used by the other jobs)
    Schedule: every hour at :20. The PC explorers can keep running; pause the cloud one any time with: gcloud scheduler jobs pause rabbit-research-explorer-hourly --location us-west2
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\explorer-job',
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
$jobSa = "rabbit-research-explorer@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/explorer-job:latest"
$secret = 'rabbit-ingest-secret'
$files = 'cloud_explorer.py', 'task_worker.py', 'stage_box.py', 'echo_link.py', 'rabbit_sync.py', 'multi_source_research.py', 'extended_research_sources.py', 'research_matcher.py', 'http_util.py', 'brain_research.py', 'crispr_data.py', 'crispr_guide_design.py'

Step 'Check the secret exists (name only) and the files are there'
$have = Exists secrets versions describe latest --secret $secret --project $Project
Write-Host ("{0}: {1}" -f $secret, $(if ($have) { 'has a value' } else { 'MISSING' }))
if (-not $preview -and -not $have) { throw 'Run Setup-GcpMinerSecrets.ps1 first (it stores the ingest secret in Secret Manager).' }
foreach ($f in $files) { if (-not (Test-Path (Join-Path $AgentsDir $f))) { throw "missing $f in $AgentsDir" } }

Step "Service account $jobSa (reads one secret, nothing else)"
Invoke-IfLive 'create the account, let it read rabbit-ingest-secret, and confirm it has no project roles' {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-research-explorer --project $Project --display-name 'RabbitOS task worker (public sources only)' }
    Retry { & gcloud secrets add-iam-policy-binding $secret --member "serviceAccount:$jobSa" --role roles/secretmanager.secretAccessor --project $Project } 'let the task worker read the ingest secret'
    # Notes staged for this job (echo/stage/ in the private reports bucket) can be read and answered, and nothing else in the bucket.
    $condStage = "resource.name.startsWith(""projects/_/buckets/rabbitsoftware-io-reports/objects/echo/stage/"") || api.getAttribute(""storage.googleapis.com/objectListPrefix"", """").startsWith(""echo/stage/"")"
    $condFile = Join-Path ([IO.Path]::GetTempPath()) ('cond-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')   # the expression contains a comma, so it goes in a file
    try {
        ConvertTo-Json -InputObject @{ title = 'only-echo-stage-rabbit-research-explorer-v2'; expression = $condStage } | Set-Content $condFile -Encoding ascii
        Retry { & gcloud storage buckets add-iam-policy-binding "gs://rabbitsoftware-io-reports" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition-from-file $condFile } 'grant echo/stage/'
    } finally { Remove-Item $condFile -Force -ErrorAction SilentlyContinue }
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$jobSa" --format 'value(bindings.role)')
    if ($roles) { throw "The research explorer has project roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step 'Build the image (the ten research-agents files are copied next to the Dockerfile)'
Invoke-IfLive "stage $($files.Count) files + Dockerfile and build $image" {
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('explorer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory $stage | Out-Null
    try {
        foreach ($f in $files) { Copy-Item (Join-Path $AgentsDir $f) $stage }
        Copy-Item (Join-Path $JobDir 'Dockerfile') $stage
        Invoke-Gcloud builds submit $stage --project $Project --tag $image --quiet
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

Step 'Cloud Run job rabbit-research-explorer'
Invoke-IfLive 'deploy the job (512 MiB, 10 minute limit, no retries) with the ingest secret mounted from Secret Manager' {
    Invoke-Gcloud run jobs deploy rabbit-research-explorer --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 600s --max-retries 0 `
        --set-secrets "RABBIT_INGEST_SECRET=${secret}:latest" --set-env-vars 'STAGE_CLOUD_AGENT=cloud_explorer,RABBIT_URL=https://app.rabbitsoftware.io,RABBIT_NODE_ID=cloud-explorer,EXPLORER_TOPICS_PER_RUN=2' --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-research-explorer --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Every hour at :20'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-research-explorer-hourly' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-research-explorer:run"
    if (Exists scheduler jobs describe rabbit-research-explorer-hourly --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-research-explorer-hourly' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-research-explorer-hourly --project $Project --location $Region --schedule '20 * * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

if ($RunNow) {
    Step 'Run once now (this explores up to two queued topics and sends the results to the app)'
    Invoke-IfLive 'gcloud run jobs execute rabbit-research-explorer --wait, then show its log' {
        Invoke-Gcloud run jobs execute rabbit-research-explorer --project $Project --region $Region --wait
        & gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-research-explorer"' --project $Project --limit 8 --freshness 10m --format 'value(timestamp.date("%H:%M:%S"),textPayload)'
    }
}
Write-Host "`nDone." -ForegroundColor Green
