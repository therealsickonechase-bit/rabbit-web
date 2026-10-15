<#
.SYNOPSIS
    One command to give the cloud backup its read-only Cloudflare token. Run it yourself: it asks you to paste the token, which is the one step nobody can do for you.
.DESCRIPTION
    1. Opens the Cloudflare page with the permissions already filled in (D1 read, Workers KV Storage read, Workers R2 Storage read). You press Create token and copy the value once.
    2. You paste it here. The box hides what you type; the value is never printed or written to a log.
    3. The script checks the token with Cloudflare (it must be active) and that it can list D1 databases, KV namespaces and R2 buckets. If a permission is missing it says which one.
    4. It saves the token in your user variable RABBIT_CF_BACKUP_TOKEN (the local backup uses it too), then runs Setup-GcpBackupSecrets.ps1 -Refresh to copy it into Secret Manager.
    -FromClipboard takes the token from your clipboard instead of asking you to paste it, and clears the clipboard afterwards (no browser opens).
    -SkipSecretManager stops after step 3 and 4's variable. -WhatIf shows the plan and asks for nothing.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$SkipSecretManager,
    [switch]$NoBrowser,
    [switch]$FromClipboard
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$url = 'https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22read%22%7D%5D&name=rabbit-backup-readonly'
if ($preview) {
    Write-Host "What if: open the token page, ask you to paste the token (hidden), verify it with Cloudflare, save RABBIT_CF_BACKUP_TOKEN$(if (-not $SkipSecretManager) { ', then run Setup-GcpBackupSecrets.ps1 -Refresh' })"
    return
}
if ($FromClipboard) {
    $token = ((Get-Clipboard -Raw) | Out-String).Trim()
    Write-Host "`n1-2. Using the token on your clipboard (it will be cleared when the check is done)." -ForegroundColor Cyan
} else {
    Write-Host "`n1. In the Cloudflare page that opens: choose the account if asked, press 'Continue to summary', then 'Create Token', and copy the token (it is shown once)." -ForegroundColor Cyan
    if (-not $NoBrowser) { Start-Process $url } else { Write-Host $url }
    $secure = Read-Host '2. Paste the token here (hidden)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $token = $token.Trim()
}
if ($token.Length -lt 30 -or $token -match '\s') { throw 'That does not look like a Cloudflare token (too short, or not a single line). Nothing was saved.' }

$h = @{ Authorization = "Bearer $token" }
function Api($path) { try { Invoke-RestMethod "https://api.cloudflare.com/client/v4$path" -Headers $h } catch { $null } }
Write-Host "`n3. Checking the token with Cloudflare (nothing is changed)..." -ForegroundColor Cyan
$accounts = Api '/accounts'
if (-not $accounts -or -not $accounts.success -or -not $accounts.result) { throw 'Cloudflare did not accept this token (could not list the account). Nothing was saved.' }
$acct = $accounts.result[0].id
$verify = Api "/accounts/$acct/tokens/verify"; if (-not $verify) { $verify = Api '/user/tokens/verify' }
if ($verify -and $verify.result.status -and $verify.result.status -ne 'active') { throw "The token is not active (status: $($verify.result.status)). Nothing was saved." }
$missing = @()
if (-not (Api "/accounts/$acct/d1/database?per_page=1")) { $missing += 'D1 read' }
if (-not (Api "/accounts/$acct/storage/kv/namespaces?per_page=1")) { $missing += 'Workers KV Storage read' }
if (-not (Api "/accounts/$acct/r2/buckets")) { $missing += 'Workers R2 Storage read' }
if ($missing.Count) { throw "The token is missing: $($missing -join ', '). Make a new one with the link above. Nothing was saved." }
Write-Host 'The token is active and can read D1, KV and R2.' -ForegroundColor Green

[Environment]::SetEnvironmentVariable('RABBIT_CF_BACKUP_TOKEN', $token, 'User')
$env:RABBIT_CF_BACKUP_TOKEN = $token
Write-Host 'Saved to your user variable RABBIT_CF_BACKUP_TOKEN (new PowerShell windows will see it).' -ForegroundColor Green
$token = $null
if ($FromClipboard) { Set-Clipboard -Value ' '; Write-Host 'Clipboard cleared.' }
if (-not $SkipSecretManager) {
    Write-Host "`n4. Copying it into Google Secret Manager..." -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'Setup-GcpBackupSecrets.ps1') -Refresh
}
Write-Host "`nDone. Tell Claude 'token done' and the cloud backup will be run and checked." -ForegroundColor Green
