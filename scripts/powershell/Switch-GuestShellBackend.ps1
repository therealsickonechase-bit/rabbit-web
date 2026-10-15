<#
.SYNOPSIS
    Switches the LIVE guest shell (Worker rabbitsoftware-public-shell, used by app.rabbitsoftware.io/cloudshell-public) between the Cloudflare sandbox and the GCP terminal.
.DESCRIPTION
    -To gcp         sets TERMINAL_BACKEND=gcp and GCP_SHELL_URL in wrangler.jsonc, sets the secret PTY_BRIDGE_SECRET on the live Worker (copied from the Cloud Run service,
                    never printed), then deploys. Visitors connecting after the deploy get a terminal on Google Cloud (paid by the project's credits).
    -To cloudflare  removes those two settings and deploys. Visitors get the Cloudflare sandbox again. This is the revert; the secret can stay.
    Running sessions are cut off when the Worker is replaced. The website needs no change: the page already talks to this Worker.
    Before switching to gcp, run Setup-GcpShellStaging.ps1 and see every check pass. -WhatIf prints the plan only.
.EXAMPLE
    .\Switch-GuestShellBackend.ps1 -To gcp -WhatIf
    .\Switch-GuestShellBackend.ps1 -To gcp
    .\Switch-GuestShellBackend.ps1 -To cloudflare
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][ValidateSet('gcp', 'cloudflare')][string]$To,
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$WorkerDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\public-shell',
    [string]$ShellService = 'rabbit-visitor-shell'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }

$configPath = Join-Path $WorkerDir 'wrangler.jsonc'
$text = Get-Content $configPath -Raw
$marker = '"ALLOWED_ORIGINS": "https://app.rabbitsoftware.io"'
if ($text -notmatch [regex]::Escape($marker)) { throw "Could not find the ALLOWED_ORIGINS line in $configPath; refusing to guess." }
$hasGcp = $text -match '"TERMINAL_BACKEND"\s*:\s*"gcp"'

Step "Current setting: $(if ($hasGcp) { 'gcp' } else { 'cloudflare' }). Target: $To."
if ($To -eq 'gcp' -and $hasGcp) { Write-Host 'wrangler.jsonc already selects gcp; will still refresh the secret and deploy.' }
if ($To -eq 'cloudflare' -and -not $hasGcp) { Write-Host 'wrangler.jsonc already selects cloudflare; will still deploy.' }

if ($To -eq 'gcp') {
    Step 'Check the GCP service answers'
    $url = (& gcloud run services describe $ShellService --project $Project --region $Region --format 'value(status.url)').Trim()
    if (-not $url -or -not $url.StartsWith('https://') -or -not $url.EndsWith('.run.app')) { throw "Unexpected service URL: $url" }
    $health = (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 90).Content
    if ($health -ne 'ok') { throw "The GCP shell service did not answer ok (got: $health). Not switching." }
    Write-Host "GCP shell service ok: $url"

    Step 'Edit wrangler.jsonc'
    Invoke-IfLive "add TERMINAL_BACKEND=gcp and GCP_SHELL_URL=$url to $configPath" {
        if (-not $hasGcp) {
            $add = "$marker,`n    `"TERMINAL_BACKEND`": `"gcp`",`n    `"GCP_SHELL_URL`": `"$url`""
            Set-Content $configPath -Value ($text -replace [regex]::Escape($marker), $add.Replace('$', '$$')) -NoNewline -Encoding utf8
        }
    }

    Step 'Secret PTY_BRIDGE_SECRET on the live Worker (value is never printed)'
    Invoke-IfLive 'copy the bridge secret from Cloud Run to the live Worker' {
        $svc = & gcloud run services describe $ShellService --project $Project --region $Region --format json | ConvertFrom-Json
        $bridge = ($svc.spec.template.spec.containers[0].env | Where-Object name -eq 'PTY_BRIDGE_SECRET').value
        if (-not $bridge -or $bridge.Length -lt 32) { throw 'Could not read PTY_BRIDGE_SECRET from the Cloud Run service.' }
        $file = Join-Path ([IO.Path]::GetTempPath()) ('live-secret-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
        try {
            @{ PTY_BRIDGE_SECRET = $bridge } | ConvertTo-Json | Set-Content $file -Encoding ascii
            Push-Location $WorkerDir
            try { & npx wrangler secret bulk $file; if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' } } finally { Pop-Location }
        } finally { Remove-Item $file -Force -ErrorAction SilentlyContinue; $bridge = $null }
    }
} else {
    Step 'Edit wrangler.jsonc'
    Invoke-IfLive "remove TERMINAL_BACKEND and GCP_SHELL_URL from $configPath" {
        $clean = $text -replace ',\s*"TERMINAL_BACKEND"\s*:\s*"[^"]*"', '' -replace ',\s*"GCP_SHELL_URL"\s*:\s*"[^"]*"', ''
        Set-Content $configPath -Value $clean -NoNewline -Encoding utf8
    }
}

Step 'Deploy the live Worker'
Invoke-IfLive "wrangler deploy in $WorkerDir (cuts off running sessions)" {
    Push-Location $WorkerDir
    try { & npx wrangler deploy; if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed; wrangler.jsonc was changed, so rerun or revert it.' } } finally { Pop-Location }
}
Write-Host "`nDone. Guest shell backend: $To. Verify in a browser at https://app.rabbitsoftware.io/cloudshell-public. Revert with: .\Switch-GuestShellBackend.ps1 -To cloudflare" -ForegroundColor Green
