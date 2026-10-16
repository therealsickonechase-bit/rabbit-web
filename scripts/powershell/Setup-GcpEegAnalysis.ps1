<#
.SYNOPSIS
    Private EEG analysis in Google Cloud (project rabbitsoftware-io, us-west2): a Cloud Run job that computes band-power summaries from the EEG sample recordings in the private backups bucket. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Cloud Run job rabbit-eeg-analysis (no URL, not public, not in the Agent Registry) reads the PhysioNet EEG Motor Movement/Imagery recordings (public sample data) that the nightly backup keeps under
    gs://rabbitsoftware-io-backups/maxwell/current/eeg_data/ plus eeg_runs/metrics.json, and writes analysis/eeg/summary.json and analysis/eeg/latest.txt (per recording and per condition band power, the alpha
    eyes-closed/eyes-open ratio, the classifier's held-out accuracy) to the same private bucket.
    Account rabbit-eeg-analysis (least privilege, enforced by IAM conditions on the bucket):
      may READ only objects under maxwell/current/eeg_data/ and maxwell/current/eeg_runs/
      may WRITE only objects under analysis/eeg/
      no project roles, no secrets. It never lists the bucket.
    The owner's own EEG notes live in the Obsidian vault (Local/EEG) and are NOT in this bucket and not read here. The headset bridge (BrainFlow) needs the physical device and stays on the PC.
    Schedule: weekly, Sundays 06:00 Los Angeles time (the data changes rarely). -RunNow runs it once.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\eeg-analysis-job',
    [string]$Bucket = 'rabbitsoftware-io-backups',
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
$jobSa = "rabbit-eeg-analysis@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/eeg-analysis-job:latest"

Step "Service account $jobSa (read the EEG samples, write analysis/eeg/ only)"
Invoke-IfLive 'create the account and grant two conditional bucket roles; confirm it has no project roles' {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-eeg-analysis --project $Project --display-name 'RabbitOS EEG sample analysis (private)' }
    $read = "resource.name.startsWith(""projects/_/buckets/$Bucket/objects/maxwell/current/eeg_data/"") || resource.name.startsWith(""projects/_/buckets/$Bucket/objects/maxwell/current/eeg_runs/"")"
    $write = "resource.name.startsWith(""projects/_/buckets/$Bucket/objects/analysis/eeg/"")"
    Retry { & gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$jobSa" --role roles/storage.objectViewer --project $Project --condition "expression=$read,title=only-eeg-sample-backups" } 'grant read on the EEG sample backups'
    Retry { & gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition "expression=$write,title=only-analysis-eeg" } 'grant write on analysis/eeg/'
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$jobSa" --format 'value(bindings.role)')
    if ($roles) { throw "The EEG analysis account has project roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step 'Build the image'
Invoke-IfLive "build $JobDir as $image" { Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet }

Step 'Cloud Run job rabbit-eeg-analysis'
Invoke-IfLive 'deploy the job (1 GiB, 20 minute limit, no retries); no public URL exists for a job' {
    Invoke-Gcloud run jobs deploy rabbit-eeg-analysis --project $Project --region $Region --image $image --service-account $jobSa --memory 1Gi --cpu 1 --task-timeout 1200s --max-retries 0 --set-env-vars "BACKUP_BUCKET=$Bucket" --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-eeg-analysis --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Weekly, Sundays 06:00 Los Angeles time'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-eeg-analysis-weekly' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-eeg-analysis:run"
    if (Exists scheduler jobs describe rabbit-eeg-analysis-weekly --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-eeg-analysis-weekly' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-eeg-analysis-weekly --project $Project --location $Region --schedule '0 6 * * 0' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

if ($RunNow) {
    Step 'Run once now, then read the summary'
    Invoke-IfLive 'gcloud run jobs execute rabbit-eeg-analysis --wait, then show analysis/eeg/latest.txt' {
        Invoke-Gcloud run jobs execute rabbit-eeg-analysis --project $Project --region $Region --wait
        & gcloud storage cat "gs://$Bucket/analysis/eeg/latest.txt" --project $Project
    }
}
Write-Host "`nDone. The summary is private: gs://$Bucket/analysis/eeg/summary.json" -ForegroundColor Green
