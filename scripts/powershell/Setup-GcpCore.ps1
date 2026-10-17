<#
.SYNOPSIS
    Maxwell Core on Google Cloud (project rabbitsoftware-io, us-west2): a Cloud Run service that runs the PUBLIC read-only gateway of the Maxwell chain. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Service maxwell-core    runs maxwell-core/maxwell-core.mjs in `serve --public` mode: JSON-RPC and a REST interface (Bitcoin Core style) over the public Maxwell chain, witnesses and anchors.
                            It serves public data only, has no cookie or secret, allows CORS, and limits each client to 120 requests a minute. Owner methods (sync, stop) do not exist on it.
    Account rabbit-maxwell-core    has NO roles: it can write logs and nothing else. No secrets, no buckets.
    Scale                   0 to 3 instances (it costs nothing while idle); 256 MiB; each new instance downloads the 14 KB chain from the public bucket and verifies it before answering.
    Use it                  curl <url>/rest/chaininfo.json   curl <url>/rest/block/12.json   or from the RabbitOS cloud shell; rabbitsoftware.io/core reads it.
    A node you run yourself (Raspberry Pi or any Linux) is the same program: maxwell-core/README.md.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$CoreDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\maxwell-core'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$sa = "rabbit-maxwell-core@$Project.iam.gserviceaccount.com"
$image = "us-west2-docker.pkg.dev/$Project/rabbit-software/maxwell-core:latest"

Step 'Service account with no roles'
Invoke-IfLive 'create rabbit-maxwell-core (no roles)' {
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-maxwell-core --project $Project --display-name 'RabbitOS Maxwell Core public gateway (no roles)' }
}

Step 'Build the image'
Invoke-IfLive "build $CoreDir as $image" { Invoke-Gcloud builds submit $CoreDir --project $Project --tag $image --quiet }

Step 'Cloud Run service maxwell-core (public read-only gateway)'
Invoke-IfLive 'deploy: public, 256 MiB, 0 to 3 instances, runs `serve --public --bind 0.0.0.0` on the port Cloud Run gives it' {
    Invoke-Gcloud run deploy maxwell-core --project $Project --region $Region --image $image --service-account $sa --allow-unauthenticated --memory 256Mi --cpu 1 --min-instances 0 --max-instances 3 --concurrency 40 --timeout 30s --port 8080 --args 'serve,--public,--bind,0.0.0.0' --set-env-vars 'MAXWELL_DATADIR=/data' --quiet
    $url = (& gcloud run services describe maxwell-core --project $Project --region $Region --format 'value(status.url)').Trim()
    Write-Host "`nURL: $url" -ForegroundColor Green
    Step 'Check it'
    foreach ($path in '/health', '/rest/chaininfo.json') {
        $r = Invoke-RestMethod "$url$path" -TimeoutSec 60
        Write-Host ("{0}  ->  {1}" -f $path, ($r | ConvertTo-Json -Compress -Depth 4).Substring(0, [Math]::Min(170, ($r | ConvertTo-Json -Compress -Depth 4).Length)))
    }
    $owner = Invoke-RestMethod "$url/" -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"sync","params":[]}'
    Write-Host "owner method 'sync' on the public gateway -> $($owner.error.message)"
}
Write-Host "`nDone." -ForegroundColor Green
