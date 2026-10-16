<#
.SYNOPSIS
    Deploys the RabbitOS Research Agent to Cloud Run as an A2A (Agent2Agent) server (project rabbitsoftware-io, region us-west2). Idempotent. Billing runs against the project's credits. -WhatIf prints the plan only.
.DESCRIPTION
    Builds workers\agent-a2a in Cloud Build and deploys it as rabbit-research-agent: scale to zero, max 2 instances, 256 MiB, public URL, its own service account with NO roles, no secrets.
    What it does: searches PubMed, Europe PMC, ClinicalTrials.gov and openFDA live (fixed public hosts, read only, nothing stored) and answers in the A2A JSON-RPC protocol (message/send).
    The agent card is at <url>/.well-known/agent-card.json. Register it in the Google Cloud Agent Registry with Register-AgentRegistry.ps1.
.EXAMPLE
    .\Setup-GcpResearchAgent.ps1 -WhatIf
    .\Setup-GcpResearchAgent.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$AgentDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\agent-a2a',
    [string]$HubSrc = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\hub-mcp\src\research.mjs'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$service = 'rabbit-research-agent'; $saName = 'rabbit-research-agent'; $sa = "$saName@$Project.iam.gserviceaccount.com"
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }

Step "Service account $sa (no roles)"
Invoke-IfLive 'create the service account and confirm it has no roles' {
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create $saName --project $Project --display-name 'Research agent (A2A, no roles)' }
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$sa" --format 'value(bindings.role)')
    if ($roles) { throw "The research agent account has roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: no project roles'
}

Step "Build and deploy $service"
Invoke-IfLive "copy the hub's research.mjs next to server.mjs, build workers\agent-a2a in Cloud Build and deploy to Cloud Run" {
    if (-not (Test-Path $HubSrc)) { throw "Missing $HubSrc" }
    $copy = Join-Path $AgentDir 'research.mjs'
    $original = Get-Content $copy -Raw
    try {
        Copy-Item $HubSrc $copy -Force
        $image = "us-west2-docker.pkg.dev/$Project/rabbit-software/research-agent:latest"
        Invoke-Gcloud builds submit $AgentDir --project $Project --tag $image --quiet
    } finally { Set-Content -Path $copy -Value $original -NoNewline }   # put the one-line re-export back so the repository stays clean
    Invoke-Gcloud run deploy $service --project $Project --region $Region --image $image --service-account $sa `
        --concurrency 20 --min-instances 0 --max-instances 2 --cpu 1 --memory 256Mi --timeout 60 --port 8080 --allow-unauthenticated --quiet
    $url = (& gcloud run services describe $service --project $Project --region $Region --format 'value(status.url)').Trim()
    Write-Host "A2A URL: $url"
    Write-Host ("health: " + (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 60).Content)
    $card = Invoke-RestMethod "$url/.well-known/agent-card.json" -TimeoutSec 30
    Write-Host ("agent card: {0} v{1}, {2} skills, url {3}" -f $card.name, $card.version, $card.skills.Count, $card.url)
    $body = '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"kind":"message","role":"user","messageId":"smoke","parts":[{"kind":"text","text":"what sources can you search?"}]}}}'
    $r = Invoke-RestMethod -Method Post -Uri $url -Body $body -ContentType 'application/json' -TimeoutSec 30
    Write-Host ("message/send answers: " + ($r.result.parts[0].text -split "`n")[0])
}
Write-Host "`nDone. Nothing else was changed." -ForegroundColor Green
