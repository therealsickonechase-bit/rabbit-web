<#
.SYNOPSIS
    Deploys the RabbitOS hub MCP server to Cloud Run (project rabbitsoftware-io, region us-west2). Idempotent. Billing runs against the project's credits.
.DESCRIPTION
    Builds workers\hub-mcp in Cloud Build and deploys it as rabbitos-hub-mcp: scale to zero, max 3 instances, 256 MiB, public URL, a service account with NO roles,
    and no secrets at all. Callers authenticate with their existing RabbitOS API key (rbk_...); the server checks it against app.rabbitsoftware.io on first use.
    All tools are read-only. Does not touch Cloudflare, DNS or any other service. -WhatIf prints the plan only.
.EXAMPLE
    .\Setup-GcpHub.ps1 -WhatIf
    .\Setup-GcpHub.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$HubDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\hub-mcp'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$service = 'rabbitos-hub-mcp'; $sa = "rabbit-hub-runner@$Project.iam.gserviceaccount.com"
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }

Step "Service account $sa (no roles)"
Invoke-IfLive 'create the service account and confirm it has no roles' {
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-hub-runner --project $Project --display-name 'Hub MCP runner (no roles)' }
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$sa" --format 'value(bindings.role)')
    if ($roles) { throw "The hub account has roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step "Build and deploy $service"
Invoke-IfLive 'build workers\hub-mcp in Cloud Build and deploy to Cloud Run' {
    if (-not (Test-Path (Join-Path $HubDir 'Dockerfile'))) { throw "Missing $HubDir\Dockerfile" }
    $image = "us-west2-docker.pkg.dev/$Project/rabbit-software/hub-mcp:latest"
    Invoke-Gcloud builds submit $HubDir --project $Project --tag $image --quiet
    Invoke-Gcloud run deploy $service --project $Project --region $Region --image $image --service-account $sa `
        --concurrency 20 --min-instances 0 --max-instances 3 --cpu 1 --memory 256Mi --timeout 60 --port 8080 --allow-unauthenticated --quiet
    $url = (& gcloud run services describe $service --project $Project --region $Region --format 'value(status.url)').Trim()
    Write-Host "MCP URL: $url/mcp"
    Write-Host ("health: " + (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 60).Content)
    $code = try { (Invoke-WebRequest "$url/mcp" -Method Post -Body '{}' -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30).StatusCode } catch { 0 }
    Write-Host "POST without a key answers: $code (expected 200: anonymous callers get the public tools)"
}
Write-Host "`nDone. Nothing else was changed." -ForegroundColor Green
