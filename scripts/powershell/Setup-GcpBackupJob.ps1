<#
.SYNOPSIS
    Moves the heavy part of the nightly platform backup off this PC and onto Google Cloud (project rabbitsoftware-io, us-west2). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    A Cloud Run job, rabbit-backup, runs pg_dump against Supabase and reads Cloudflare D1, KV and R2 through the API, then writes everything to
    gs://rabbitsoftware-io-backups/platform-cloud/<date>/ (its own prefix: the local backup's platform/<date>/ is never touched). Cloud Scheduler starts it at 03:30 Los Angeles time.
    Nothing here needs Docker or wrangler on your PC, and nothing slows your PC down.

    Step 2 of 2. Step 1 is Setup-GcpBackupSecrets.ps1 (you run it once; it is the only script that handles secret values). This script holds no secret values: it only checks the secrets exist.
    Accounts (least privilege):
      rabbit-backup-job        may create objects in the backups bucket and read the two secrets, nothing else
      rabbit-backup-scheduler  may run this one job

    Keep the local daily backup running until you have compared a cloud run with it (-RunNow, then look in the bucket).
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\backup-job',
    [string]$Bucket = 'rabbitsoftware-io-backups',
    [string]$EnvFile = 'C:\Users\odaat\Projects\rabbit-web\.env.local',
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Get-EnvValue($file, $name) {
    if (-not (Test-Path $file)) { return $null }
    $line = Get-Content $file | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if (-not $line) { return $null }
    ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}
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
$jobSa = "rabbit-backup-job@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-backup-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/backup-job:latest"
$dbSecret = 'rabbit-supabase-db-url'; $cfSecret = 'rabbit-cf-backup-token'

Step 'Check the secrets exist (names only)'
$pubUrl = Get-EnvValue $EnvFile 'NEXT_PUBLIC_SUPABASE_URL'
$haveDb = Exists secrets versions describe latest --secret $dbSecret --project $Project
$haveCf = Exists secrets versions describe latest --secret $cfSecret --project $Project
Write-Host ("{0}: {1}" -f $dbSecret, $(if ($haveDb) { 'has a value' } else { 'MISSING' }))
Write-Host ("{0}: {1}" -f $cfSecret, $(if ($haveCf) { 'has a value' } else { 'none (Cloudflare parts will be skipped)' }))
if (-not $pubUrl) { throw 'NEXT_PUBLIC_SUPABASE_URL was not found in .env.local.' }
if (-not $preview -and -not $haveDb) { throw 'Run Setup-GcpBackupSecrets.ps1 first (it stores the Supabase connection string in Secret Manager).' }

Step 'Service accounts'
Invoke-IfLive 'create rabbit-backup-job and rabbit-backup-scheduler; the job account may only create objects in the backups bucket' {
    foreach ($name in 'rabbit-backup-job', 'rabbit-backup-scheduler') {
        if (-not (Exists iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $name --project $Project --display-name "RabbitOS $name" }
    }
    Bind "serviceAccount:$jobSa" 'roles/storage.objectCreator' 'bucket' $Bucket
}

Step 'Build the image'
Invoke-IfLive "build $JobDir as $image (pg_dump 17 and the job code)" { Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet }

Step 'Cloud Run job rabbit-backup'
Invoke-IfLive 'deploy the job with 2 GiB, a 1 hour limit and no retries (a failed night is reported, not repeated)' {
    $secrets = "SUPABASE_DB_URL=${dbSecret}:latest"
    if ($haveCf) { $secrets += ",CLOUDFLARE_API_TOKEN=${cfSecret}:latest" }
    $envVars = "BACKUP_BUCKET=$Bucket,NEXT_PUBLIC_SUPABASE_URL=$pubUrl"
    Invoke-Gcloud run jobs deploy rabbit-backup --project $Project --region $Region --image $image --service-account $jobSa --memory 2Gi --cpu 1 --task-timeout 3600s --max-retries 0 --set-secrets $secrets --set-env-vars $envVars --quiet
    Bind "serviceAccount:$schSa" 'roles/run.invoker' 'job' 'rabbit-backup'
}

Step 'Every night at 03:30 Los Angeles time'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-backup-nightly' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-backup:run"
    if (Exists scheduler jobs describe rabbit-backup-nightly --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-backup-nightly' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-backup-nightly --project $Project --location $Region --schedule '30 3 * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

if ($RunNow) {
    Step 'Run the backup once now'
    Invoke-IfLive 'gcloud run jobs execute rabbit-backup --wait, then list what it wrote' {
        Invoke-Gcloud run jobs execute rabbit-backup --project $Project --region $Region --wait
        $day = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        Invoke-Gcloud storage ls -r "gs://$Bucket/platform-cloud/$day/" --project $Project | Select-Object -First 25
        Write-Host 'Read the manifest: gcloud storage cat gs://$Bucket/platform-cloud/<date>/manifest/manifest.json'
    }
}
Write-Host "`nDone. The local backup is unchanged. Compare the first cloud run with it before relying on the cloud copy." -ForegroundColor Green
