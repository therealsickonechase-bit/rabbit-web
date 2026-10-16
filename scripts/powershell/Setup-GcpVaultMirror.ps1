<#
.SYNOPSIS
    Step 2 of 2: the cloud mirror of the Obsidian vault (project rabbitsoftware-io, us-west2). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Cloud Run job rabbit-vault-mirror   every hour (at :40) clones the vault repository from GitHub with the read-only token from Secret Manager and copies it to
                                        gs://rabbitsoftware-io-vault-private/github-mirror/ . Files removed from GitHub are removed from the mirror (the bucket is versioned, so old versions stay).
                                        Never mirrored: .git, Local/EEG, Local/RabbitOS folder. An almost empty clone is refused so a bad run cannot wipe the mirror.
    Why                                 the PC already uploads the vault hourly; this keeps the cloud copy current from GitHub even when the PC is off, and the Obsidian sync plugin and the PC
                                        sync task keep working unchanged (they only talk to GitHub).
    Account rabbit-vault-mirror         reads the one secret (step 1) and may read and write objects in the private vault bucket; it has no project roles and no key access.
    Cost                                cents a month.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$JobDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\vault-mirror-job',
    [string]$VaultBucket = 'rabbitsoftware-io-vault-private',
    [string]$Repo = 'therealsickonechase-bit/obsidian-rabbitos-vault',
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
$jobSa = "rabbit-vault-mirror@$Project.iam.gserviceaccount.com"; $schSa = "rabbit-anchor-scheduler@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/vault-mirror-job:latest"

Step 'Check step 1 was done'
Invoke-IfLive 'confirm the secret rabbit-vault-github-token has a version and the account exists' {
    if (-not (Exists secrets versions describe latest --secret rabbit-vault-github-token --project $Project)) { throw 'No token stored yet. Run Setup-GcpVaultMirrorSecrets.ps1 first (you paste a read-only GitHub token there).' }
    if (-not (Exists iam service-accounts describe $jobSa --project $Project)) { throw "Missing $jobSa. Run Setup-GcpVaultMirrorSecrets.ps1 first." }
    Write-Host 'token stored; account exists'
}

Step 'Vault bucket access for the mirror account'
Invoke-IfLive "let $jobSa read and write objects in gs://$VaultBucket (no project roles)" {
    Retry { & gcloud storage buckets add-iam-policy-binding "gs://$VaultBucket" --member "serviceAccount:$jobSa" --role roles/storage.objectAdmin --project $Project --condition=None } 'grant vault bucket access'
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$jobSa" --format 'value(bindings.role)')
    if ($roles) { throw "The mirror account has project roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step 'Build the image'
Invoke-IfLive "build $JobDir as $image" { Invoke-Gcloud builds submit $JobDir --project $Project --tag $image --quiet }

Step 'Cloud Run job rabbit-vault-mirror'
Invoke-IfLive 'deploy the job (1 GiB, 30 minute limit, no retries) with the token mounted from Secret Manager' {
    Invoke-Gcloud run jobs deploy rabbit-vault-mirror --project $Project --region $Region --image $image --service-account $jobSa --memory 1Gi --cpu 1 --task-timeout 1800s --max-retries 0 `
        --set-env-vars "VAULT_REPO=$Repo,VAULT_BUCKET=$VaultBucket" --set-secrets 'GITHUB_TOKEN=rabbit-vault-github-token:latest' --quiet
    Retry { & gcloud run jobs add-iam-policy-binding rabbit-vault-mirror --region $Region --project $Project --member "serviceAccount:$schSa" --role roles/run.invoker --quiet } 'let the scheduler run the job'
}

Step 'Every hour at :40'
Invoke-IfLive 'create the Cloud Scheduler job rabbit-vault-mirror-hourly' {
    $uri = "https://run.googleapis.com/v2/projects/$Project/locations/$Region/jobs/rabbit-vault-mirror:run"
    if (Exists scheduler jobs describe rabbit-vault-mirror-hourly --project $Project --location $Region) { Write-Host 'scheduler job exists: rabbit-vault-mirror-hourly' }
    else { Invoke-Gcloud scheduler jobs create http rabbit-vault-mirror-hourly --project $Project --location $Region --schedule '40 * * * *' --time-zone 'America/Los_Angeles' --uri $uri --http-method POST --message-body '{}' --headers 'Content-Type=application/json' --oauth-service-account-email $schSa --oauth-token-scope 'https://www.googleapis.com/auth/cloud-platform' }
}

Step 'Alert if the mirror fails'
Invoke-IfLive 'create the log metric vault_mirror_failed and an email alert policy' {
    $f = 'resource.type="cloud_run_job" AND resource.labels.job_name="rabbit-vault-mirror" AND (jsonPayload.event="vault_mirror_failed" OR severity>=ERROR)'
    if (Exists logging metrics describe vault_mirror_failed --project $Project) { Invoke-Gcloud logging metrics update vault_mirror_failed --project $Project --description 'The vault mirror failed' --log-filter $f }
    else { Invoke-Gcloud logging metrics create vault_mirror_failed --project $Project --description 'The vault mirror failed' --log-filter $f }
    $tok = (gcloud auth print-access-token).Trim()
    $h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
    $mon = "https://monitoring.googleapis.com/v3/projects/$Project"
    $channel = (Invoke-RestMethod "$mon/notificationChannels" -Headers $h).notificationChannels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
    if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
    $name = 'RabbitOS: the vault mirror failed'
    if ((Invoke-RestMethod "$mon/alertPolicies" -Headers $h).alertPolicies | Where-Object { $_.displayName -eq $name }) { Write-Host "alert policy exists: $name"; return }
    $cond = @{ displayName = 'Vault mirror failed'; conditionThreshold = @{ filter = 'metric.type="logging.googleapis.com/user/vault_mirror_failed" AND resource.type="cloud_run_job"'; aggregations = @(@{ alignmentPeriod = '3600s'; perSeriesAligner = 'ALIGN_SUM' }); comparison = 'COMPARISON_GT'; thresholdValue = 0; duration = '0s'; trigger = @{ count = 1 } } }
    $body = @{ displayName = $name; combiner = 'OR'; enabled = $true; conditions = @($cond); notificationChannels = @($channel.name)
        documentation = @{ mimeType = 'text/markdown'; content = 'The hourly mirror of the Obsidian vault from GitHub to Google Cloud failed. The usual cause is an expired or revoked GitHub token: create a new read-only token and run Setup-GcpVaultMirrorSecrets.ps1 -Refresh. Logs: Cloud Run job rabbit-vault-mirror.' } } | ConvertTo-Json -Depth 8
    $created = $false
    foreach ($try in 1..24) {
        try { [void](Invoke-RestMethod -Method Post -Uri "$mon/alertPolicies" -Headers $h -ContentType 'application/json' -Body $body); $created = $true; break }
        catch { if ("$($_.ErrorDetails.Message)" -notmatch 'Cannot find metric') { throw }; Write-Host "metric not visible to Monitoring yet (attempt $try of 24); waiting"; Start-Sleep -Seconds 30 }
    }
    if (-not $created) { throw 'Monitoring still cannot see the new metric; run this script again in a few minutes.' }
    Write-Host "created alert policy: $name"
}

if ($RunNow) {
    Step 'Run the mirror once now'
    Invoke-IfLive 'gcloud run jobs execute rabbit-vault-mirror --wait, then count the mirrored objects' {
        Invoke-Gcloud run jobs execute rabbit-vault-mirror --project $Project --region $Region --wait
        Write-Host ("objects under github-mirror/: {0}" -f ((& gcloud storage ls -r "gs://$VaultBucket/github-mirror/**" --project $Project 2>$null | Measure-Object).Count))
    }
}
Write-Host "`nDone. Mirror: gs://$VaultBucket/github-mirror/" -ForegroundColor Green
