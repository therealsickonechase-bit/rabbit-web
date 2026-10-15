<#
.SYNOPSIS
    Stages and tests the GCP terminal backend through a SEPARATE Worker, rabbitsoftware-public-shell-gcp-test. The live guest shell is not touched.
.DESCRIPTION
    1. Deploys workers\public-shell with wrangler.gcp-test.jsonc (workers.dev only, no containers, no routes, its own Durable Objects and quotas).
    2. Sets three secrets on that staging Worker from a temporary file that is deleted at once; none is printed:
         TURNSTILE_SECRET_KEY  Cloudflare's published always-pass TEST key (so a script can open sessions; useless for the real page)
         SESSION_SIGNING_KEY   fresh random value
         PTY_BRIDGE_SECRET     read from the Cloud Run service rabbit-visitor-shell, so both sides match
    3. Runs the end-to-end smoke test: Worker (gate, quotas) -> Cloud Run (terminal) -> VPC proxy (allowlist), including the egress checks.
    -SkipTest only deploys and sets secrets. -WhatIf prints the plan.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$WorkerDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\public-shell',
    [string]$SmokeScript = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\public-shell-gcp\scripts\smoke.mjs',
    [string]$WorkerUrl = 'https://rabbitsoftware-public-shell-gcp-test.rabbitsoftware-gateway.workers.dev',
    [switch]$SkipTest
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
$config = 'wrangler.gcp-test.jsonc'

Step 'Deploy the staging Worker'
Invoke-IfLive "deploy $config from $WorkerDir" {
    Push-Location $WorkerDir
    try { & npx wrangler deploy -c $config; if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' } } finally { Pop-Location }
}

Step 'Staging secrets (values are never printed)'
Invoke-IfLive 'set TURNSTILE_SECRET_KEY (test key), SESSION_SIGNING_KEY (random), PTY_BRIDGE_SECRET (from Cloud Run)' {
    $svc = & gcloud run services describe rabbit-visitor-shell --project $Project --region $Region --format json | ConvertFrom-Json
    $bridge = ($svc.spec.template.spec.containers[0].env | Where-Object name -eq 'PTY_BRIDGE_SECRET').value
    if (-not $bridge -or $bridge.Length -lt 32) { throw 'Could not read PTY_BRIDGE_SECRET from the rabbit-visitor-shell service.' }
    $bytes = New-Object byte[] 36; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $signing = [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', 'c')
    $file = Join-Path ([IO.Path]::GetTempPath()) ('staging-secrets-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    try {
        @{ TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'; SESSION_SIGNING_KEY = $signing; PTY_BRIDGE_SECRET = $bridge } | ConvertTo-Json | Set-Content $file -Encoding ascii
        Push-Location $WorkerDir
        try { & npx wrangler secret bulk $file -c $config; if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' } } finally { Pop-Location }
    } finally { Remove-Item $file -Force -ErrorAction SilentlyContinue; $bridge = $null; $signing = $null }
}

if ($SkipTest) { Write-Host "`nSkipTest: deployed and configured." -ForegroundColor Green; return }

Step 'End-to-end test through the staging Worker'
Invoke-IfLive "node smoke.mjs against $WorkerUrl with the egress checks" {
    $env:WORKER_URL = $WorkerUrl; $env:EGRESS_CHECK = '1'
    try { & node $SmokeScript; if ($LASTEXITCODE -ne 0) { throw 'The end-to-end test failed. The live guest shell was not changed.' } } finally { $env:WORKER_URL = $null; $env:EGRESS_CHECK = $null }
}
Write-Host "`nDone. The live guest shell (rabbitsoftware-public-shell) was not changed." -ForegroundColor Green
