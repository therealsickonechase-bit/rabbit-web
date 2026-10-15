<#
.SYNOPSIS
    The weekly platform audit on Google Cloud (project rabbitsoftware-io, us-west2): a Cloud Run job, a Workflow that runs it, a Scheduler trigger and an alert. Idempotent. -WhatIf prints the plan.
.DESCRIPTION
    Every Monday 09:00 (Los Angeles time), Cloud Scheduler starts the Workflow "rabbit-qa". The Workflow runs the Cloud Run job "rabbit-qa", which crawls rabbitsoftware.io and the RabbitOS app,
    checks the platform's services and the chain copies, and writes a report (HTML with maps, plus a JSON summary) to the private bucket gs://rabbitsoftware-io-reports.
    The job logs one "qa_report" line; log-based metrics count reports and high-severity ones, and an alert emails you when a report has high-severity findings or the audit fails.
    Accounts, each with only what it needs:
      rabbit-qa-job        writes objects in the reports bucket (nothing else)
      rabbit-qa-workflow   runs the job, reads the reports bucket, writes logs
      rabbit-qa-scheduler  starts the workflow
    The job only reads public pages. Nothing on the live sites is changed.
    -RunNow runs the workflow once at the end and prints the summary.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AuditDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\qa-audit',
    [string]$Bucket = 'rabbitsoftware-io-reports',
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Bind($member, $role, [string]$resourceKind, [string]$resource) {
    # IAM changes for a brand-new account can lag by a few seconds, so retry.
    foreach ($try in 1..6) {
        $out = switch ($resourceKind) {
            'project' { & gcloud projects add-iam-policy-binding $Project --member $member --role $role --condition=None --quiet 2>&1 }
            'bucket'  { & gcloud storage buckets add-iam-policy-binding "gs://$resource" --member $member --role $role --project $Project 2>&1 }
            'job'     { & gcloud run jobs add-iam-policy-binding $resource --region $Region --project $Project --member $member --role $role --quiet 2>&1 }
        }
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 8
    }
    throw "Could not grant $role to $member on $resourceKind $resource"
}
$job = "rabbit-qa-job@$Project.iam.gserviceaccount.com"; $wf = "rabbit-qa-workflow@$Project.iam.gserviceaccount.com"; $sch = "rabbit-qa-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/qa-audit:latest"

Step 'APIs'
Invoke-IfLive 'enable workflows, workflowexecutions and cloudscheduler' { Invoke-Gcloud services enable workflows.googleapis.com workflowexecutions.googleapis.com cloudscheduler.googleapis.com --project $Project }

Step "Reports bucket gs://$Bucket (private)"
Invoke-IfLive "create the bucket in $Region, uniform access, public access blocked, reports deleted after 180 days" {
    if (-not (Exists storage buckets describe "gs://$Bucket" --project $Project)) {
        Invoke-Gcloud storage buckets create "gs://$Bucket" --project $Project --location $Region --uniform-bucket-level-access --public-access-prevention
        $rule = Join-Path ([IO.Path]::GetTempPath()) ('lifecycle-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
        try { '{"rule":[{"action":{"type":"Delete"},"condition":{"age":180}}]}' | Set-Content $rule -Encoding ascii; Invoke-Gcloud storage buckets update "gs://$Bucket" --project $Project --lifecycle-file $rule } finally { Remove-Item $rule -Force -ErrorAction SilentlyContinue }
        Write-Host "created bucket: $Bucket"
    } else { Write-Host "bucket exists: $Bucket" }
}

Step 'Service accounts'
Invoke-IfLive 'create rabbit-qa-job, rabbit-qa-workflow, rabbit-qa-scheduler and grant each only what it needs' {
    foreach ($name in 'rabbit-qa-job', 'rabbit-qa-workflow', 'rabbit-qa-scheduler') {
        if (-not (Exists iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $name --project $Project --display-name $name }
    }
    Bind "serviceAccount:$job" 'roles/storage.objectAdmin' 'bucket' $Bucket
    Bind "serviceAccount:$wf" 'roles/storage.objectViewer' 'bucket' $Bucket
    Bind "serviceAccount:$wf" 'roles/logging.logWriter' 'project' $null
    Bind "serviceAccount:$sch" 'roles/workflows.invoker' 'project' $null
}

Step 'Build the audit image'
Invoke-IfLive "build $AuditDir in Cloud Build as $image" {
    if (-not (Test-Path (Join-Path $AuditDir 'Dockerfile'))) { throw "Missing $AuditDir\Dockerfile" }
    Invoke-Gcloud builds submit $AuditDir --project $Project --tag $image --quiet
}

Step 'Cloud Run job rabbit-qa'
Invoke-IfLive 'deploy the job (512 MiB, 10-minute limit, one retry)' {
    Invoke-Gcloud run jobs deploy rabbit-qa --project $Project --region $Region --image $image --service-account $job --memory 512Mi --cpu 1 --task-timeout 600s --max-retries 1 `
        --set-env-vars "REPORT_BUCKET=$Bucket" --quiet
    # The workflow account may run this one job and nothing else. If the run is refused, the fallback is the broader run.developer role.
    Bind "serviceAccount:$wf" 'roles/run.invoker' 'job' 'rabbit-qa'
    Bind "serviceAccount:$wf" 'roles/run.viewer' 'project' $null
}

Step 'Workflow rabbit-qa'
Invoke-IfLive 'deploy workflow.yaml' {
    # A just-created service account or a just-enabled API can take a minute to be usable here, so retry.
    $deployed = $false
    foreach ($try in 1..6) {
        & gcloud workflows deploy rabbit-qa --project $Project --location $Region --source (Join-Path $AuditDir 'workflow.yaml') --service-account $wf --description 'Weekly audit of rabbitsoftware.io and RabbitOS' --quiet
        if ($LASTEXITCODE -eq 0) { $deployed = $true; break }
        Write-Host "workflow deploy not ready yet (attempt $try of 6); waiting"; Start-Sleep -Seconds 15
    }
    if (-not $deployed) { throw 'Could not deploy the workflow.' }
}

Step 'Weekly trigger (Mondays 09:00, Los Angeles time)'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-qa-weekly' {
    $uri = "https://workflowexecutions.googleapis.com/v1/projects/$Project/locations/$Region/workflows/rabbit-qa/executions"
    if (Exists scheduler jobs describe rabbit-qa-weekly --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-qa-weekly' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-qa-weekly --project $Project --location $Region --schedule '0 9 * * 1' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $sch; Write-Host 'created scheduler job: rabbit-qa-weekly' }
}

Step 'Log-based metrics and the alert'
Invoke-IfLive 'create metrics qa_reports, qa_high_findings, qa_failed and the alert policy' {
    $base = 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-qa"'
    $metrics = [ordered]@{
        qa_reports       = @{ d = 'Weekly audit reports written'; f = "$base AND jsonPayload.event=`"qa_report`"" }
        qa_high_findings = @{ d = 'Weekly audit reports that found high-severity issues'; f = "$base AND jsonPayload.event=`"qa_report`" AND jsonPayload.high>0" }
        qa_failed        = @{ d = 'Weekly audit runs that failed'; f = "$base AND (jsonPayload.event=`"qa_failed`" OR severity>=ERROR)" }
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
    $name = 'RabbitOS: weekly audit needs attention'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    function Cond($display, $metric) { @{ displayName = $display; conditionThreshold = @{ filter = "metric.type=`"logging.googleapis.com/user/$metric`" AND resource.type=`"cloud_run_job`""; aggregations = @(@{ alignmentPeriod = '3600s'; perSeriesAligner = 'ALIGN_SUM' }); comparison = 'COMPARISON_GT'; thresholdValue = 0; duration = '0s'; trigger = @{ count = 1 } } } }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; conditions = @((Cond 'The audit found high-severity issues' 'qa_high_findings'), (Cond 'The audit failed to run' 'qa_failed')); notificationChannels = @($channel.name)
        documentation = @{ mimeType = 'text/markdown'; content = 'The weekly RabbitOS and rabbitsoftware.io audit found high-severity issues or failed. Open the latest report: gs://rabbitsoftware-io-reports/latest.html (Cloud Storage console), or ask the hub for the audit summary. Logs: Logs Explorer, Cloud Run job rabbit-qa.' } } | ConvertTo-Json -Depth 20
    # Monitoring can take up to ten minutes to see a brand-new log-based metric, so retry while it says "not found".
    $created = $false
    foreach ($try in 1..24) {
        try { [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body); $created = $true; break }
        catch { if ("$($_.ErrorDetails.Message)" -notmatch 'Cannot find metric') { throw }; Write-Host "metric not visible to Monitoring yet (attempt $try of 24); waiting"; Start-Sleep -Seconds 30 }
    }
    if (-not $created) { throw 'Monitoring still cannot see the new metrics; run this script again in a few minutes.' }
    Write-Host "created alert policy: $name"
}

if ($RunNow) {
    Step 'Run the workflow once'
    Invoke-IfLive 'gcloud workflows run rabbit-qa' {
        Invoke-Gcloud workflows run rabbit-qa --project $Project --location $Region --data '{}'
        Write-Host "`nlatest summary:"; & gcloud storage cat "gs://$Bucket/latest.json" --project $Project
    }
}
Write-Host "`nDone. Reports: gs://$Bucket/latest.html and gs://$Bucket/latest.json. No live site was changed." -ForegroundColor Green
