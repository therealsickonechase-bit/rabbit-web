<#
.SYNOPSIS
    Security fix 1: stops public Cloud Run services running as the default compute account (which has the project-wide Editor role). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Before   rabbit-web, rabbit-web-workerd, rabbit-site-standby and hello-world run as 1087712653995-compute@developer (role Editor, and it can read the Supabase service-role key).
             Cloud Build also runs as that account, so Editor cannot simply be removed.
    Steps    1. create rabbit-web-runner (reads ONLY the secret supabase-service-role-key) and rabbit-standby-runner (no roles)
             2. give the default account only what builds need: push images (artifactregistry.writer), write logs (logging.logWriter), read build sources (objectViewer on the two source buckets)
             3. move the three services to their new accounts and check each one answers (stops here, changing nothing more, if one does not)
             4. delete the unused hello-world service
             5. remove Editor, and the secret access, from the default account
             6. prove builds still work with a small test build; if it fails, Editor is put back and the script stops
    Undo     gcloud projects add-iam-policy-binding <project> --member serviceAccount:<number>-compute@developer.gserviceaccount.com --role roles/editor
             gcloud run services update <service> --region <region> --service-account <number>-compute@developer.gserviceaccount.com
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$num = (& gcloud projects describe $Project --format 'value(projectNumber)').Trim()
$default = "$num-compute@developer.gserviceaccount.com"
$webSa = "rabbit-web-runner@$Project.iam.gserviceaccount.com"; $standbySa = "rabbit-standby-runner@$Project.iam.gserviceaccount.com"
$secret = 'supabase-service-role-key'
$moves = @(
    @{ Service = 'rabbit-web'; Sa = $webSa; Health = { param($u) "$u/api/health" }; Expect = '"status":"ok"' },
    # rabbit-web-workerd is an experimental runtime image (:test3). Its /api/health already reported "database down" (a 7 s timeout) BEFORE this change, on the old revision too,
    # so the check here is only that it still serves its pages. That database fault is a separate, older problem.
    @{ Service = 'rabbit-web-workerd'; Sa = $webSa; Health = { param($u) "$u/" }; Expect = '<!DOCTYPE html>' },
    @{ Service = 'rabbit-site-standby'; Sa = $standbySa; Health = { param($u) "$u/" }; Expect = 'RabbitSoftware' }
)
function Bind-Project($member, $role) { Invoke-Gcloud projects add-iam-policy-binding $Project --member $member --role $role --condition=None --quiet | Out-Null }
function Retry-Bind([scriptblock]$bind) { foreach ($try in 1..6) { & $bind 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { return }; Start-Sleep -Seconds 8 }; throw 'IAM binding failed after retries' }

Step '1. Minimal accounts'
Invoke-IfLive 'create rabbit-web-runner and rabbit-standby-runner; rabbit-web-runner may read only the secret supabase-service-role-key' {
    foreach ($n in 'rabbit-web-runner', 'rabbit-standby-runner') {
        if (-not (Exists iam service-accounts describe "$n@$Project.iam.gserviceaccount.com" --project $Project)) { Invoke-Gcloud iam service-accounts create $n --project $Project --display-name "RabbitOS $n" }
    }
    Retry-Bind { gcloud secrets add-iam-policy-binding $secret --project $Project --member "serviceAccount:$webSa" --role roles/secretmanager.secretAccessor }
}

Step '2. Give the default account only what builds need'
Invoke-IfLive "grant ${default} artifactregistry.writer, logging.logWriter (project) and objectViewer on the two build-source buckets" {
    Bind-Project "serviceAccount:$default" roles/artifactregistry.writer
    Bind-Project "serviceAccount:$default" roles/logging.logWriter
    foreach ($b in "$Project`_cloudbuild", "run-sources-$Project-$Region") {
        if (Exists storage buckets describe "gs://$b" --project $Project) { Retry-Bind { gcloud storage buckets add-iam-policy-binding "gs://$b" --project $Project --member "serviceAccount:$default" --role roles/storage.objectViewer } }
    }
}

Step '3. Move the services to their new accounts, one at a time, and check each'
foreach ($m in $moves) {
    Invoke-IfLive "update $($m.Service) to run as $($m.Sa), then check it answers" {
        Invoke-Gcloud run services update $m.Service --project $Project --region $Region --service-account $m.Sa --quiet | Out-Null
        $url = (& gcloud run services describe $m.Service --project $Project --region $Region --format 'value(status.url)').Trim()
        $ok = $false
        foreach ($try in 1..10) {
            try { $r = Invoke-WebRequest -Uri (& $m.Health $url) -UseBasicParsing -TimeoutSec 20; if ($r.Content -like "*$($m.Expect)*") { $ok = $true; break } } catch { }
            Start-Sleep -Seconds 6
        }
        if (-not $ok) { throw "$($m.Service) does not answer after the move. Nothing further was changed. Undo: gcloud run services update $($m.Service) --region $Region --service-account $default" }
        Write-Host "$($m.Service): runs as $($m.Sa) and answers"
    }
}

Step '4. Delete the unused hello-world service'
Invoke-IfLive 'delete hello-world (the Google sample container; nothing uses it)' {
    if (Exists run services describe hello-world --project $Project --region $Region) { Invoke-Gcloud run services delete hello-world --project $Project --region $Region --quiet; Write-Host 'deleted hello-world' } else { Write-Host 'hello-world already gone' }
}

Step '5. Remove Editor and the secret access from the default account'
Invoke-IfLive "remove roles/editor from $default and its read access to $secret" {
    $null = & gcloud secrets remove-iam-policy-binding $secret --project $Project --member "serviceAccount:$default" --role roles/secretmanager.secretAccessor 2>&1
    $null = & gcloud projects remove-iam-policy-binding $Project --member "serviceAccount:$default" --role roles/editor --condition=None --quiet 2>&1
    Write-Host 'removed'
}

Step '6. Prove builds still work (small test build; Editor is restored if it fails)'
Invoke-IfLive 'run a tiny Cloud Build and push a tiny test image' {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('buildtest-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory $dir | Out-Null
    try {
        Set-Content -Path (Join-Path $dir 'Dockerfile') -Value "FROM busybox:stable`nCMD [""echo"", ""ok""]" -Encoding ascii
        $tag = "us-west2-docker.pkg.dev/$Project/rabbit-software/build-permission-test:latest"
        & gcloud builds submit $dir --project $Project --tag $tag --quiet 2>&1 | Select-Object -Last 3
        if ($LASTEXITCODE -ne 0) {
            $null = & gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$default" --role roles/editor --condition=None --quiet 2>&1
            throw 'The test build failed with the narrower roles, so Editor was put back. Look at the build log, add the missing role, and run this script again.'
        }
        $null = & gcloud artifacts docker images delete $tag --project $Project --delete-tags --quiet 2>&1
        Write-Host 'builds work with the narrower roles; test image removed'
    } finally { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

Step 'Result'
Invoke-IfLive 'show who runs what now' {
    foreach ($s in (& gcloud run services list --project $Project --region $Region --format 'value(metadata.name)')) {
        $s = $s.Trim(); $sa = (& gcloud run services describe $s --project $Project --region $Region --format 'value(spec.template.spec.serviceAccountName)').Trim()
        Write-Host ("{0,-22} runs as {1}" -f $s, ($sa -replace "@$Project.iam.gserviceaccount.com", '@...'))
    }
    $roles = (& gcloud projects get-iam-policy $Project --format json | ConvertFrom-Json).bindings | Where-Object { $_.members -contains "serviceAccount:$default" } | ForEach-Object { $_.role -replace 'roles/', '' }
    Write-Host ("default account roles now: {0}" -f ($roles -join ', '))
}
Write-Host "`nDone." -ForegroundColor Green
