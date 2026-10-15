<#
.SYNOPSIS
    Security fix 11: turns on Secure Boot for the egress proxy VM. It needs the VM stopped for about a minute. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    The proxy VM (rabbit-egress-proxy) is the only way out to the internet for the visitor shell. While it is stopped, guest terminals cannot reach package registries or the model APIs, and
    the hub and the public RabbitOS app calls from inside a guest terminal fail. This script:
      1. looks for guest sessions in the last few minutes and stops without changing anything if there are some (use -Force to go ahead anyway)
      2. stops the VM, switches Secure Boot on, and ALWAYS starts the VM again, even if a step fails
      3. checks the VM is running and that its proxy still allows the listed hosts and refuses everything else
    Nothing else changes: same internal address (10.20.0.10), same firewall rules, same startup script. Undo: gcloud compute instances stop ..., then update --no-shielded-secure-boot, then start.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Zone = 'us-west2-a',
    [string]$Vm = 'rabbit-egress-proxy',
    [int]$QuietMinutes = 10,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Get-Field($format) { ((& gcloud compute instances describe $Vm --zone $Zone --project $Project --format $format) | Out-String).Trim() }

Step 'Where it stands'
$secure = Get-Field 'value(shieldedInstanceConfig.enableSecureBoot)'
$status = Get-Field 'value(status)'
Write-Host "status: $status   secure boot: $(if ($secure -match 'True') { 'on' } else { 'off' })"
if ($secure -match 'True') { Write-Host 'Secure Boot is already on; nothing to do.' -ForegroundColor Green; return }

Step 'Are guests using it right now?'
$since = (Get-Date).ToUniversalTime().AddMinutes(-$QuietMinutes).ToString('yyyy-MM-ddTHH:mm:ssZ')
# A guest terminal is a WebSocket request (HTTP 101) to /pty on the visitor shell service.
$filter = "resource.type=""cloud_run_revision"" AND resource.labels.service_name=""rabbit-visitor-shell"" AND httpRequest.requestUrl:""/pty"" AND timestamp>=""$since"""
$recent = @(& gcloud logging read $filter --project $Project --limit 5 --format 'value(timestamp)' 2>$null | Where-Object { $_ })
Write-Host "guest sessions started in the last $QuietMinutes minutes: $($recent.Count)"
if ($recent.Count -and -not $Force) { throw "Guests were active in the last $QuietMinutes minutes. Try again later, or use -Force to go ahead." }

if ($preview) { Write-Host "What if: stop $Vm, enable Secure Boot, start it again (about a minute), then test the proxy's allowlist."; return }

Step 'Stop, switch, start (the VM is always started again)'
$started = $false
try {
    Invoke-Gcloud compute instances stop $Vm --zone $Zone --project $Project --quiet
    Invoke-Gcloud compute instances update $Vm --zone $Zone --project $Project --shielded-secure-boot
} finally {
    & gcloud compute instances start $Vm --zone $Zone --project $Project --quiet
    $started = ($LASTEXITCODE -eq 0)
}
if (-not $started) { throw "The VM did not start again. Run: gcloud compute instances start $Vm --zone $Zone --project $Project" }
Write-Host 'started again'

Step 'Check'
$secure = Get-Field 'value(shieldedInstanceConfig.enableSecureBoot)'
Write-Host "secure boot: $(if ($secure -match 'True') { 'on' } else { 'STILL OFF' })   internal address: $(Get-Field 'value(networkInterfaces[0].networkIP)')"
$script = 'for h in pypi.org registry.npmjs.org api.anthropic.com example.com www.google.com; do echo "$h $(curl -s -o /dev/null -m 10 -w %{http_code} -x http://127.0.0.1:3128 https://$h/)"; done'
$ok = $false
foreach ($try in 1..12) {   # the VM and Squid take a little while to come back
    $out = & gcloud compute ssh $Vm --zone $Zone --project $Project --tunnel-through-iap --quiet --command $script 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { $ok = $true; break }
    Start-Sleep -Seconds 10
}
if (-not $ok) { throw 'Could not test the proxy after the restart. Check the VM and Squid by hand.' }
$out | ForEach-Object { Write-Host "  $_" }
$allowedOk = ($out -match '^(pypi.org|registry.npmjs.org|api.anthropic.com) (200|301|302|307|404)').Count -ge 3
$deniedOk = ($out -match '^(example.com|www.google.com) 000').Count -ge 2
if (-not ($allowedOk -and $deniedOk)) { throw 'The proxy does not behave as expected after the restart (allowed hosts should connect, others should be refused).' }
Write-Host "`nSecure Boot is on and the proxy still allows only the listed hosts." -ForegroundColor Green
