<#
.SYNOPSIS
    OPTIONAL. Creates a small GKE Autopilot cluster in rabbitsoftware-io and runs the hub MCP on it (private, no load balancer). NOT run by default; read docs\gcp-kubernetes.md first.
.DESCRIPTION
    Nothing on the platform depends on this. It exists so Kubernetes is one command away if you want it.
    -WhatIf prints the plan. -Delete removes the cluster again (the only way to stop its charges).
    The cluster: name rabbit-cluster, region us-west2, Autopilot (Google manages the nodes), regular release channel, deletion protection ON until -Delete lifts it.
    The workload: workers\hub-mcp\k8s\hub.yaml, ClusterIP only. Reach it with:  kubectl -n rabbitos port-forward svc/hub-mcp 8081:80
.EXAMPLE
    .\Setup-GcpGke.ps1 -WhatIf
    .\Setup-GcpGke.ps1
    .\Setup-GcpGke.ps1 -Delete
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$Cluster = 'rabbit-cluster',
    [string]$Manifest = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\hub-mcp\k8s\hub.yaml',
    [switch]$Delete
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }

if ($Delete) {
    Step "Delete cluster $Cluster"
    Invoke-IfLive "lift deletion protection and delete $Cluster" {
        Invoke-Gcloud container clusters update $Cluster --project $Project --region $Region --no-enable-deletion-protection --quiet
        Invoke-Gcloud container clusters delete $Cluster --project $Project --region $Region --quiet
    }
    return
}

Step 'Kubernetes Engine API'
Invoke-IfLive 'enable container.googleapis.com' { Invoke-Gcloud services enable container.googleapis.com --project $Project }

Step "Cluster $Cluster (Autopilot, $Region)"
Invoke-IfLive "create the Autopilot cluster $Cluster with deletion protection" {
    if (Exists container clusters describe $Cluster --project $Project --region $Region) { Write-Host "cluster exists: $Cluster" }
    else { Invoke-Gcloud container clusters create-auto $Cluster --project $Project --region $Region --release-channel regular --enable-deletion-protection }   # takes about ten minutes
}

Step 'Deploy the hub (private, ClusterIP only)'
Invoke-IfLive "kubectl apply $Manifest" {
    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { throw 'kubectl is not installed.' }
    if (-not (Get-Command gke-gcloud-auth-plugin -ErrorAction SilentlyContinue)) { throw 'gke-gcloud-auth-plugin is missing: gcloud components install gke-gcloud-auth-plugin' }
    Invoke-Gcloud container clusters get-credentials $Cluster --project $Project --region $Region
    & kubectl apply -f $Manifest
    if ($LASTEXITCODE -ne 0) { throw 'kubectl apply failed' }
    & kubectl -n rabbitos rollout status deployment/hub-mcp --timeout=300s
}
Write-Host "`nDone. Reach the hub with:  kubectl -n rabbitos port-forward svc/hub-mcp 8081:80   Remove everything with:  .\Setup-GcpGke.ps1 -Delete" -ForegroundColor Green
