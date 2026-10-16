<#
.SYNOPSIS
    The cloud side of the PC-to-cloud echo (project rabbitsoftware-io, us-west2): a Cloud Run job that hears the PC, acknowledges it, and is heard back, while the two stay separate. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    There is NO network path between the PC and the cloud. Both sides only talk outward to one private prefix, gs://rabbitsoftware-io-reports/echo/, like notes left in a shared mailbox:
      echo/pc/latest.json, echo/pc/status.json         written by the PC (Run-Echo.ps1, scheduled task "RabbitOS Echo", every 5 minutes)
      echo/cloud/latest.json, echo/cloud/status.json   written by this job (every 5 minutes)
    Each step reads the other side's last message, checks its HMAC signature (the key is the ingest secret), writes its own message carrying an acknowledgement of the one it heard (their nonce and sequence number)
    and a status file saying whether it heard the other side, how old that was, and whether its previous message was acknowledged and how fast. Only counters, random nonces and times are exchanged.
    Account rabbit-echo (least privilege): reads the one secret rabbit-ingest-secret; may read and write ONLY objects whose name starts with echo/ in the reports bucket (IAM condition); no project roles.
    Run it once with -RunNow; the PC side is Run-Echo.ps1 -Register.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\echo-job',
    [string]$Bucket = 'rabbitsoftware-io-reports',
    [string]$StatusBucket = 'rabbitsoftware-io-status-public',
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
$jobSa = "rabbit-echo@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/echo-job:latest"
$secret = 'rabbit-ingest-secret'
foreach ($f in 'echo_link.py', 'echo_record.py', 'stage_box.py') { if (-not (Test-Path (Join-Path $AgentsDir $f))) { throw "missing $f in $AgentsDir" } }

Step "Service account $jobSa (the echo/ prefix of the reports bucket and one secret)"
Invoke-IfLive 'create the account, let it read the secret and use echo/ only; confirm it has no project roles' {
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-echo --project $Project --display-name 'RabbitOS echo (PC and cloud acknowledgement)' }
    Retry { & gcloud secrets add-iam-policy-binding $secret --member "serviceAccount:$jobSa" --role roles/secretmanager.secretAccessor --project $Project } 'let the echo job read the signing key'
    # Reading and writing objects under echo/ AND listing that prefix (listing is authorised by the list prefix, not by an object name).
    $cond = "resource.name.startsWith(""projects/_/buckets/$Bucket/objects/echo/"") || api.getAttribute(""storage.googleapis.com/objectListPrefix"", """").startsWith(""echo/"")"
    $condFile = Join-Path ([IO.Path]::GetTempPath()) ('cond-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')   # the expression contains a comma, so it goes in a file
    try {
        ConvertTo-Json -InputObject @{ title = 'only-echo-prefix-v2'; expression = $cond } | Set-Content $condFile -Encoding ascii
        Retry { & gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition-from-file $condFile } 'grant echo/ access'
    } finally { Remove-Item $condFile -Force -ErrorAction SilentlyContinue }
    # The heartbeat chart: this account may write exactly one public object, status/echo.json, and nothing else in the status bucket.
    $condPub = "resource.name.startsWith(""projects/_/buckets/$StatusBucket/objects/status/echo.json"")"
    Retry { & gcloud storage buckets add-iam-policy-binding "gs://$StatusBucket" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition "expression=$condPub,title=only-echo-heartbeat" } 'grant the heartbeat object'
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$jobSa" --format 'value(bindings.role)')
    if ($roles) { throw "The echo account has project roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step 'Build the image'
Invoke-IfLive "stage echo_link.py + Dockerfile and build $image" {
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('echo-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory $stage | Out-Null
    try {
        Copy-Item (Join-Path $AgentsDir 'echo_link.py') $stage
        Copy-Item (Join-Path $AgentsDir 'echo_record.py') $stage
        Copy-Item (Join-Path $AgentsDir 'stage_box.py') $stage
        Copy-Item (Join-Path $JobDir 'Dockerfile') $stage
        Invoke-Gcloud builds submit $stage --project $Project --tag $image --quiet
    } finally { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

Step 'Cloud Run job rabbit-echo'
Invoke-IfLive 'deploy the job (512 MiB, 2 minute limit, no retries) with the signing key mounted from Secret Manager' {
    Invoke-Gcloud run jobs deploy rabbit-echo --project $Project --region $Region --image $image --service-account $jobSa --memory 512Mi --cpu 1 --task-timeout 120s --max-retries 0 --set-secrets "RABBIT_INGEST_SECRET=${secret}:latest" --set-env-vars "ECHO_BUCKET=$Bucket,ECHO_PUBLIC_BUCKET=$StatusBucket" --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-echo --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Every 5 minutes'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-echo-5min' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-echo:run"
    if (Exists scheduler jobs describe rabbit-echo-5min --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-echo-5min' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-echo-5min --project $Project --location $Region --schedule '2-59/5 * * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

Step 'Watchdog: alert if the PC and the cloud stop hearing each other'
Invoke-IfLive 'create metric echo_pc_heard and the alert "PC echo silent"' {
    $filter = 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-echo" AND jsonPayload.event="echo_heard" AND jsonPayload.peerIsRecent=true'
    if (Exists logging metrics describe echo_pc_heard --project $Project) { Invoke-Gcloud logging metrics update echo_pc_heard --project $Project --description 'Cloud echo steps that heard a fresh note from the PC' --log-filter $filter }
    else { Invoke-Gcloud logging metrics create echo_pc_heard --project $Project --description 'Cloud echo steps that heard a fresh note from the PC' --log-filter $filter }
    $tok = (gcloud auth print-access-token).Trim(); $h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
    $mon = "https://monitoring.googleapis.com/v3/projects/$Project"
    $channel = (Invoke-RestMethod "$mon/notificationChannels" -Headers $h).notificationChannels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
    if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
    $name = 'RabbitOS: PC echo silent'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; notificationChannels = @($channel.name)
        conditions = @(@{ displayName = 'No fresh PC note for 3 hours'; conditionAbsent = @{ filter = 'metric.type="logging.googleapis.com/user/echo_pc_heard" AND resource.type="cloud_run_job"'; aggregations = @(@{ alignmentPeriod = '300s'; perSeriesAligner = 'ALIGN_SUM' }); duration = '10800s'; trigger = @{ count = 1 } } })
        documentation = @{ mimeType = 'text/markdown'; content = 'The cloud has not heard a fresh note from the PC for 3 hours. The PC may be off or asleep. If it is on, check the scheduled task "RabbitOS Echo" (Run-Echo.ps1) and ~/RabbitOS/logs/echo-<date>.log. The heartbeat chart is on rabbitsoftware.io/status.html.' } } | ConvertTo-Json -Depth 20
    $created = $false
    foreach ($try in 1..24) {
        try { [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body); $created = $true; break }
        catch { if ("$($_.ErrorDetails.Message)" -notmatch 'Cannot find metric') { throw }; Write-Host "metric not visible to Monitoring yet (attempt $try of 24); waiting"; Start-Sleep -Seconds 30 }
    }
    if (-not $created) { throw 'Monitoring still cannot see the new metric; run this script again in a few minutes.' }
    Write-Host "created alert policy: $name"
}

if ($RunNow) {
    Step 'Run once now'
    Invoke-IfLive 'gcloud run jobs execute rabbit-echo --wait, then show echo/cloud/status.json and the public heartbeat' {
        Invoke-Gcloud run jobs execute rabbit-echo --project $Project --region $Region --wait
        & gcloud storage cat "gs://$Bucket/echo/cloud/status.json" --project $Project
        Write-Host ('public heartbeat: ' + (Invoke-WebRequest "https://$StatusBucket.storage.googleapis.com/status/echo.json" -UseBasicParsing).Content.Substring(0, 120) + '...')
    }
}
Write-Host "`nDone. Start the PC side: pwsh -File scripts\powershell\Run-Echo.ps1 -Register" -ForegroundColor Green
