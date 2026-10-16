<#
.SYNOPSIS
    Builds and deploys rabbit-web to Cloud Run in Google Cloud using Cloud Build.
.DESCRIPTION
    1. Reads Supabase configuration from .env.local.
    2. Submits a Cloud Build job to build the Docker image and push to Artifact Registry.
    3. Deploys the new revision to Cloud Run under service account rabbit-web-runner.
    4. Verifies the service health endpoint.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$Service = 'rabbit-web',
    [string]$EnvFile = 'C:\Users\odaat\Projects\rabbit-web\.env.local'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }

Step '1. Load environment and Supabase config'
if (-not (Test-Path $EnvFile)) { throw "Environment file $EnvFile not found." }
$envContent = Get-Content $EnvFile | Where-Object { $_ -match '^\s*([^#=]+)=(.*)$' }
$config = @{}
foreach ($line in $envContent) {
    if ($line -match '^\s*([^#=]+)=(.*)$') {
        $config[$Matches[1].Trim()] = $Matches[2].Trim()
    }
}

$sbUrl = $config['NEXT_PUBLIC_SUPABASE_URL']
$sbKey = $config['NEXT_PUBLIC_SUPABASE_ANON_KEY']
if (-not $sbUrl -or -not $sbKey) { throw "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in $EnvFile" }

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/${Service}:latest"
$sa = "rabbit-web-runner@$Project.iam.gserviceaccount.com"

Step "2. Build container via Cloud Build ($image)"
$cfg = Join-Path ([IO.Path]::GetTempPath()) ("cloudbuild-web-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + ".yaml")
$yaml = @'
steps:
- name: 'gcr.io/cloud-builders/docker'
  args:
  - 'build'
  - '--build-arg'
  - 'NEXT_PUBLIC_SUPABASE_URL=${_SUPABASE_URL}'
  - '--build-arg'
  - 'NEXT_PUBLIC_SUPABASE_ANON_KEY=${_SUPABASE_KEY}'
  - '-t'
  - '${_IMAGE}'
  - '.'
images:
- '${_IMAGE}'
'@
Set-Content -Path $cfg -Value $yaml -Encoding ascii

try {
    Invoke-IfLive "submit Cloud Build for $Service" {
        Invoke-Gcloud builds submit $repoRoot --project $Project --config $cfg `
            --substitutions "_IMAGE=$image,_SUPABASE_URL=$sbUrl,_SUPABASE_KEY=$sbKey"
    }
} finally {
    Remove-Item $cfg -Force -ErrorAction SilentlyContinue
}

Step "3. Deploy to Cloud Run ($Service in $Region)"
Invoke-IfLive "deploy $Service to Cloud Run" {
    Invoke-Gcloud run deploy $Service `
        --project $Project `
        --region $Region `
        --image $image `
        --service-account $sa `
        --platform managed `
        --allow-unauthenticated `
        --port 8080 `
        --quiet
}

Step '4. Health verification'
Invoke-IfLive 'verify health endpoint' {
    $url = (& gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)').Trim()
    Write-Host "Service URL: $url" -ForegroundColor Green
    $healthUrl = "$url/api/health"
    Write-Host "Probing $healthUrl ..."
    $res = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 15
    Write-Host "Health check response: $($res | ConvertTo-Json -Compress)" -ForegroundColor Green
}

Write-Host "`nDeploy of $Service completed successfully." -ForegroundColor Green
