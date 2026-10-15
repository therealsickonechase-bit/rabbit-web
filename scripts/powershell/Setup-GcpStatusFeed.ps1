<#
.SYNOPSIS
    The live status feed for rabbitsoftware.io (project rabbitsoftware-io, us-west2). A Cloud Run job checks the PUBLIC parts of the platform every 5 minutes and writes a small public feed
    that the website's status page reads; every check is also recorded in BigQuery through the log sink. Idempotent. -WhatIf prints the plan.
.DESCRIPTION
    Public bucket   gs://rabbitsoftware-io-status-public   world-readable on purpose, CORS limited to rabbitsoftware.io, holds only status/latest.json and status/history.json
    Job             rabbit-status   same image as the weekly audit, runs `node src/status.mjs`; account rabbit-status-job can write to this one bucket and nothing else
    Trigger         Cloud Scheduler rabbit-status-5min   every 5 minutes; account rabbit-status-scheduler may run this one job
    Recording       the job logs one "status_check" line; the BigQuery sink rabbit-analytics is widened to keep it (and the weekly "qa_report")
    Watchdog        a log metric counts status checks; an alert emails you if none arrive for 30 minutes
    Also refreshes the weekly audit job to the new image, so its report includes the database tree.
    The feed holds service names, up or down, timings, chain lengths and the public data tree. No addresses, no findings, no private services.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AuditDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\qa-audit',
    [string]$Bucket = 'rabbitsoftware-io-status-public',
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Bind($member, $role, [string]$kind, [string]$resource) {
    foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
        $null = switch ($kind) {
            'bucket' { & gcloud storage buckets add-iam-policy-binding "gs://$resource" --member $member --role $role --project $Project 2>&1 }
            'job'    { & gcloud run jobs add-iam-policy-binding $resource --region $Region --project $Project --member $member --role $role --quiet 2>&1 }
        }
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 8
    }
    throw "Could not grant $role to $member on $kind $resource"
}
$jobSa = "rabbit-status-job@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-status-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/qa-audit:latest"
$origins = @('https://rabbitsoftware.io', 'https://www.rabbitsoftware.io')

Step "Public status bucket gs://$Bucket"
Invoke-IfLive "create the bucket, make its objects world-readable, allow GET from $($origins -join ', ') only" {
    if (-not (Exists storage buckets describe "gs://$Bucket" --project $Project)) {
        Invoke-Gcloud storage buckets create "gs://$Bucket" --project $Project --location $Region --uniform-bucket-level-access
        Write-Host "created bucket: $Bucket"
    } else { Write-Host "bucket exists: $Bucket" }
    Invoke-Gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --project $Project --member allUsers --role roles/storage.objectViewer | Out-Null
    $cors = Join-Path ([IO.Path]::GetTempPath()) ('cors-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    try {
        ConvertTo-Json -InputObject @(@{ origin = $origins; method = @('GET', 'HEAD'); responseHeader = @('Content-Type', 'Cache-Control'); maxAgeSeconds = 300 }) -Depth 5 | Set-Content $cors -Encoding ascii
        Invoke-Gcloud storage buckets update "gs://$Bucket" --project $Project --cors-file $cors
    } finally { Remove-Item $cors -Force -ErrorAction SilentlyContinue }
}

Step 'Service accounts'
Invoke-IfLive 'create rabbit-status-job and rabbit-status-scheduler; the job account may write only to the status bucket' {
    foreach ($name in 'rabbit-status-job', 'rabbit-status-scheduler') { if (-not (Exists iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $name --project $Project --display-name $name } }
    Bind "serviceAccount:$jobSa" 'roles/storage.objectAdmin' 'bucket' $Bucket
}

Step 'Build the image (status recorder, audit, database tree)'
Invoke-IfLive "build $AuditDir as $image" { Invoke-Gcloud builds submit $AuditDir --project $Project --tag $image --quiet }

Step 'Cloud Run jobs'
Invoke-IfLive 'deploy rabbit-status; refresh rabbit-qa to the new image' {
    Invoke-Gcloud run jobs deploy rabbit-status --project $Project --region $Region --image $image --service-account $jobSa --command node --args 'src/status.mjs' --memory 256Mi --cpu 1 --task-timeout 120s --max-retries 0 --set-env-vars "STATUS_BUCKET=$Bucket" --quiet
    if (Exists run jobs describe rabbit-qa --project $Project --region $Region) { Invoke-Gcloud run jobs update rabbit-qa --project $Project --region $Region --image $image --quiet }
    Bind "serviceAccount:$schSa" 'roles/run.invoker' 'job' 'rabbit-status'
}

Step 'Every five minutes'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-status-5min' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-status:run"
    if (Exists scheduler jobs describe rabbit-status-5min --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-status-5min' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-status-5min --project $Project --location $Region --schedule '*/5 * * * *' --time-zone 'Etc/UTC' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa; Write-Host 'created scheduler job: rabbit-status-5min' }
}

Step 'Record every check in BigQuery'
Invoke-IfLive 'widen the rabbit-analytics sink to keep status_check and qa_report events' {
    $current = (& gcloud logging sinks describe rabbit-analytics --project $Project --format 'value(filter)').Trim()
    $addition = '(resource.type="cloud_run_job" AND jsonPayload.event=("status_check" OR "qa_report"))'
    if ($current -match 'status_check') { Write-Host 'sink already keeps status_check' }
    else { Invoke-Gcloud logging sinks update rabbit-analytics --project $Project --log-filter "($current) OR $addition"; Write-Host 'sink now keeps status_check and qa_report' }
}

Step 'Watchdog: alert if the recorder stops'
Invoke-IfLive 'create metric status_checks and the alert "status recorder stopped"' {
    $filter = 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-status" AND jsonPayload.event="status_check"'
    if (Exists logging metrics describe status_checks --project $Project) { Invoke-Gcloud logging metrics update status_checks --project $Project --description 'Status feed runs completed' --log-filter $filter }
    else { Invoke-Gcloud logging metrics create status_checks --project $Project --description 'Status feed runs completed' --log-filter $filter }
    $tok = (gcloud auth print-access-token).Trim(); $h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
    $mon = "https://monitoring.googleapis.com/v3/projects/$Project"
    $channel = (Invoke-RestMethod "$mon/notificationChannels" -Headers $h).notificationChannels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
    if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
    $name = 'RabbitOS: status recorder stopped'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; notificationChannels = @($channel.name)
        conditions = @(@{ displayName = 'No status check for 30 minutes'; conditionAbsent = @{ filter = 'metric.type="logging.googleapis.com/user/status_checks" AND resource.type="cloud_run_job"'; aggregations = @(@{ alignmentPeriod = '300s'; perSeriesAligner = 'ALIGN_SUM' }); duration = '1800s'; trigger = @{ count = 1 } } })
        documentation = @{ mimeType = 'text/markdown'; content = 'The status recorder has not reported for 30 minutes, so the status page on rabbitsoftware.io is going stale (it says so itself after 30 minutes). Check the Cloud Run job rabbit-status and the Cloud Scheduler job rabbit-status-5min.' } } | ConvertTo-Json -Depth 20
    $created = $false
    foreach ($try in 1..24) {
        try { [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body); $created = $true; break }
        catch { if ("$($_.ErrorDetails.Message)" -notmatch 'Cannot find metric') { throw }; Write-Host "metric not visible to Monitoring yet (attempt $try of 24); waiting"; Start-Sleep -Seconds 30 }
    }
    if (-not $created) { throw 'Monitoring still cannot see the new metric; run this script again in a few minutes.' }
    Write-Host "created alert policy: $name"
}

if ($RunNow) {
    Step 'Run the recorder once'
    Invoke-IfLive 'gcloud run jobs execute rabbit-status --wait, then read the public feed' {
        Invoke-Gcloud run jobs execute rabbit-status --project $Project --region $Region --wait
        $feed = Invoke-RestMethod "https://$Bucket.storage.googleapis.com/status/latest.json"
        Write-Host ("public feed: {0} of {1} services answering, generated {2}" -f $feed.up, $feed.total, $feed.generatedAt)
        $cors = Invoke-WebRequest "https://$Bucket.storage.googleapis.com/status/latest.json" -Headers @{ Origin = 'https://rabbitsoftware.io' } -UseBasicParsing
        Write-Host ("CORS for rabbitsoftware.io: " + $cors.Headers['Access-Control-Allow-Origin'])
    }
}
Write-Host "`nDone. Feed: https://$Bucket.storage.googleapis.com/status/latest.json . No live site was changed." -ForegroundColor Green
