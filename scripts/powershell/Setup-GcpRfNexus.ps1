<#
.SYNOPSIS
    Hosts the RF Nexus static preview on Cloud Run (project rabbitsoftware-io, region us-west2). Idempotent. Billing runs against the project's credits.
.DESCRIPTION
    Stages ONLY the three reviewed export files (index.html and the two assets) from the Cloudflare preview folder, builds workers\rf-nexus-gcp in Cloud Build and deploys it
    as rf-nexus-preview: scale to zero, max 2 instances, 256 MiB, public URL, its own service account with NO roles, no secrets. The server answers 503 to API/WebSocket
    calls, 405 to writes, 404 to everything else, and sends a strict CSP and noindex. Does not touch Cloudflare: delete the Worker separately once this works.
    -WhatIf prints the plan only.
.EXAMPLE
    .\Setup-GcpRfNexus.ps1 -WhatIf
    .\Setup-GcpRfNexus.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AppDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\rf-nexus-gcp',
    [string]$SourceDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\tools\rf-nexus-preview\public'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$service = 'rf-nexus-preview'; $saName = 'rabbit-rfnexus-runner'; $sa = "$saName@$Project.iam.gserviceaccount.com"
$files = 'index.html', 'assets\index-drmRIFDg.js', 'assets\index--vzZ5AZu.css'
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }

Step 'Stage the three reviewed files'
Invoke-IfLive "copy $($files -join ', ') into $AppDir\public" {
    foreach ($f in $files) { if (-not (Test-Path (Join-Path $SourceDir $f))) { throw "Missing $SourceDir\$f" } }
    $dest = Join-Path $AppDir 'public'
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    foreach ($f in $files) { $t = Join-Path $dest $f; New-Item -ItemType Directory -Force (Split-Path $t) | Out-Null; Copy-Item (Join-Path $SourceDir $f) $t }
    Get-ChildItem $dest -Recurse -File | ForEach-Object { Write-Host ("  {0} ({1:N0} bytes)" -f $_.FullName.Substring($dest.Length + 1), $_.Length) }
}

Step "Service account $sa (no roles)"
Invoke-IfLive 'create the service account and confirm it has no roles' {
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create $saName --project $Project --display-name 'RF Nexus preview runner (no roles)' }
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$sa" --format 'value(bindings.role)')
    if ($roles) { throw "The RF Nexus account has roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step "Build and deploy $service"
Invoke-IfLive 'build workers\rf-nexus-gcp in Cloud Build and deploy to Cloud Run' {
    $image = "us-west2-docker.pkg.dev/$Project/rabbit-software/rf-nexus-preview:latest"
    Invoke-Gcloud builds submit $AppDir --project $Project --tag $image --quiet
    Invoke-Gcloud run deploy $service --project $Project --region $Region --image $image --service-account $sa `
        --concurrency 40 --min-instances 0 --max-instances 2 --cpu 1 --memory 256Mi --timeout 30 --port 8080 --allow-unauthenticated --quiet
    $url = (& gcloud run services describe $service --project $Project --region $Region --format 'value(status.url)').Trim()
    Write-Host "URL: $url"
    $r = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 60
    Write-Host ("page: {0}, banner present: {1}, editor script removed: {2}" -f $r.StatusCode, ($r.Content -match 'static export preview only'), ($r.Content -notmatch 'data-pplx-inline-edit'))
    foreach ($p in '/api/auth/me', '/report.md') { $c = (Invoke-WebRequest "$url$p" -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30).StatusCode; Write-Host "$p answers $c" }
    Write-Host ("POST / answers {0} (expected 405)" -f (Invoke-WebRequest "$url/" -Method Post -Body '{}' -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30).StatusCode)
}
Write-Host "`nDone. Cloudflare was not touched; the old Worker is still up until you delete it." -ForegroundColor Green
