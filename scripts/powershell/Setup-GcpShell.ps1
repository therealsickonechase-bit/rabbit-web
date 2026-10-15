<#
.SYNOPSIS
    Builds the GCP side of the public visitor shell (project rabbitsoftware-io, region us-west2). Idempotent. Billing runs against the project's credits.
.DESCRIPTION
    1. Enables Compute Engine.
    2. Network: VPC rabbit-shell-net, subnet 10.20.0.0/24, firewall rules. Cloud Run instances carry the tag shell-client and may ONLY send TCP 3128 to the proxy;
       everything else outbound is denied. The proxy VM accepts 3128 only from shell-client (plus SSH through IAP for you).
    3. Proxy: e2-micro VM rabbit-egress-proxy (10.20.0.10) running Squid. CONNECT is allowed on port 443 to the exact hosts below, nothing else.
    4. Service account rabbit-shell-runner with NO roles (the visitor can reach its token, so it must be worth nothing).
    5. Cloud Run service rabbit-visitor-shell: built in Cloud Build from workers\public-shell-gcp, gen2, concurrency 1, max 6 instances, Direct VPC egress for all traffic.
       The bridge secret is generated here, never printed, and set as an environment variable on the service (not in Secret Manager: that would need a role on the runner account).
    Does NOT change Cloudflare, DNS or the live guest shell. -WhatIf prints the plan only. -SkipDeploy builds the network and proxy but not the service.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$Zone = 'us-west2-a',
    [string]$WorkersDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers',
    [switch]$SkipDeploy
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$net = 'rabbit-shell-net'; $subnet = 'rabbit-shell-subnet'; $proxyName = 'rabbit-egress-proxy'; $proxyIp = '10.20.0.10'
$service = 'rabbit-visitor-shell'; $sa = "rabbit-shell-runner@$Project.iam.gserviceaccount.com"
$allowed = 'registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org', 'github.com', 'raw.githubusercontent.com', 'codeload.github.com',
    'objects.githubusercontent.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.githubcopilot.com', 'api.github.com', 'app.rabbitsoftware.io'

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }

Step 'Compute Engine API'
Invoke-IfLive 'enable compute.googleapis.com' { Invoke-Gcloud services enable compute.googleapis.com --project $Project }

Step "Network $net"
Invoke-IfLive 'create VPC, subnet and firewall rules' {
    if (-not (Exists compute networks describe $net --project $Project)) { Invoke-Gcloud compute networks create $net --project $Project --subnet-mode custom }
    if (-not (Exists compute networks subnets describe $subnet --project $Project --region $Region)) {
        Invoke-Gcloud compute networks subnets create $subnet --project $Project --region $Region --network $net --range 10.20.0.0/24
    }
    $rules = @(
        @('rabbit-shell-allow-proxy-out', @('--direction', 'EGRESS', '--action', 'ALLOW', '--rules', 'tcp:3128', '--destination-ranges', "$proxyIp/32", '--target-tags', 'shell-client', '--priority', '900')),
        @('rabbit-shell-deny-all-out', @('--direction', 'EGRESS', '--action', 'DENY', '--rules', 'all', '--destination-ranges', '0.0.0.0/0', '--target-tags', 'shell-client', '--priority', '1000')),
        @('rabbit-shell-proxy-in', @('--direction', 'INGRESS', '--action', 'ALLOW', '--rules', 'tcp:3128', '--source-tags', 'shell-client', '--target-tags', 'egress-proxy', '--priority', '900')),
        @('rabbit-shell-iap-ssh', @('--direction', 'INGRESS', '--action', 'ALLOW', '--rules', 'tcp:22', '--source-ranges', '35.235.240.0/20', '--target-tags', 'egress-proxy', '--priority', '900'))
    )
    foreach ($r in $rules) {
        $ruleName = $r[0]; $ruleArgs = $r[1]
        if (-not (Exists compute firewall-rules describe $ruleName --project $Project)) { Invoke-Gcloud compute firewall-rules create $ruleName --project $Project --network $net @ruleArgs }
        else { Write-Host "firewall rule exists: $($r[0])" }
    }
}

Step "Proxy VM $proxyName (Squid, exact-host CONNECT allowlist)"
$startup = @'
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y squid
cat > /etc/squid/squid.conf <<'CONF'
http_port 3128
acl allowed_hosts dstdomain __HOSTS__
acl tls_port port 443
acl connect_method method CONNECT
http_access deny !connect_method
http_access deny connect_method !tls_port
http_access allow connect_method allowed_hosts
http_access deny all
cache deny all
via off
forwarded_for delete
access_log stdio:/var/log/squid/access.log
CONF
systemctl enable squid && systemctl restart squid
'@
$startupFile = Join-Path ([IO.Path]::GetTempPath()) ('squid-startup-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.sh')
Set-Content $startupFile -Encoding ascii -Value (($startup -replace '__HOSTS__', ($allowed -join ' ')) -replace "`r`n", "`n")
try {
    Invoke-IfLive "create e2-micro $proxyName at $proxyIp with the allowlist: $($allowed -join ', ')" {
        if (-not (Exists compute instances describe $proxyName --project $Project --zone $Zone)) {
            Invoke-Gcloud compute instances create $proxyName --project $Project --zone $Zone --machine-type e2-micro --subnet $subnet --private-network-ip $proxyIp `
                --tags egress-proxy --image-family debian-12 --image-project debian-cloud --boot-disk-size 10GB --metadata-from-file "startup-script=$startupFile"
        } else {
            Write-Host 'proxy VM exists; refreshing its allowlist'
            Invoke-Gcloud compute instances add-metadata $proxyName --project $Project --zone $Zone --metadata-from-file "startup-script=$startupFile"
        }
    }
} finally { Remove-Item $startupFile -Force -ErrorAction SilentlyContinue }

Step "Service account $sa (no roles)"
Invoke-IfLive 'create the service account' {
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-shell-runner --project $Project --display-name 'Visitor shell runner (no roles)' }
    $roles = (& gcloud projects get-iam-policy $Project --flatten 'bindings[].members' --filter "bindings.members:serviceAccount:$sa" --format 'value(bindings.role)')
    if ($roles) { throw "The runner account has roles ($($roles -join ', ')). It must have none." }
    Write-Host 'confirmed: the runner account has no project roles'
}

if ($SkipDeploy) { Write-Host "`nSkipDeploy: network and proxy done." -ForegroundColor Green; return }

Step "Cloud Run service $service"
Invoke-IfLive 'build the image in Cloud Build and deploy' {
    if (-not (Test-Path (Join-Path $WorkersDir 'public-shell-gcp\Dockerfile'))) { throw "Missing $WorkersDir\public-shell-gcp\Dockerfile" }
    # Reuse the bridge secret when the service already exists, otherwise make a new one. It is never printed.
    $secret = $null
    if (Exists run services describe $service --project $Project --region $Region) {
        $secret = (& gcloud run services describe $service --project $Project --region $Region --format 'json(spec.template.spec.containers)' | ConvertFrom-Json).spec.template.spec.containers[0].env | Where-Object name -eq 'PTY_BRIDGE_SECRET' | ForEach-Object value
    }
    if (-not $secret) {
        $bytes = New-Object byte[] 36; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', 'c')
    }
    $image = "us-west2-docker.pkg.dev/$Project/rabbit-software/visitor-shell:latest"
    $cfg = Join-Path ([IO.Path]::GetTempPath()) ('cloudbuild-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.yaml')
    Set-Content $cfg -Encoding ascii -Value "steps:`n- name: gcr.io/cloud-builders/docker`n  args: ['build', '-f', 'public-shell-gcp/Dockerfile', '-t', '$image', '.']`nimages: ['$image']`ntimeout: 1800s"
    try { Invoke-Gcloud builds submit $WorkersDir --project $Project --config $cfg --quiet } finally { Remove-Item $cfg -Force -ErrorAction SilentlyContinue }
    Invoke-Gcloud run deploy $service --project $Project --region $Region --image $image --service-account $sa --execution-environment gen2 `
        --concurrency 1 --min-instances 0 --max-instances 6 --cpu 1 --memory 1Gi --timeout 1800 --port 8080 `
        --network $net --subnet $subnet --network-tags shell-client --vpc-egress all-traffic `
        --set-env-vars "PTY_BRIDGE_SECRET=$secret,EGRESS_PROXY_URL=http://${proxyIp}:3128" --allow-unauthenticated --quiet
    $url = (& gcloud run services describe $service --project $Project --region $Region --format 'value(status.url)').Trim()
    Write-Host "Service URL: $url"
    Write-Host ("health: " + (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 60).Content)
}
Write-Host "`nDone. The live guest shell and Cloudflare were not changed." -ForegroundColor Green
