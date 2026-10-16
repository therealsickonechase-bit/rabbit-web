<#
.SYNOPSIS
    One command to give the owner cloud shell its Gemini API key. Run it yourself: it asks you to paste the key, which is the one step nobody can do for you. -Remove takes the key away again.
.DESCRIPTION
    The Gemini CLI is installed in the owner shell's working session. It needs a Gemini API key, which this script stores as the Cloudflare secret GEMINI_API_KEY on the Worker
    rabbitsoftware-cloudshell. The Worker hands it ONLY to commands run in a working session (as that command's environment, never written into the sandbox), the one-command shell never
    sees it, and if a command prints it the Worker replaces it with [redacted] before the output leaves.
    1. You paste the key (or use -FromClipboard / -FromEnv). The box hides what you type; the value is never printed or written to a log.
    2. The script checks the shape of the key, then asks Google whether it works (a read-only "list models" call). A key Google rejects is not saved.
    3. It stores the key with `wrangler secret put` (piped in, not on a command line). Nothing else is changed or redeployed.
    -Remove   deletes the secret. Gemini then stays installed but cannot call the API.
    -FromClipboard  takes the key from your clipboard and clears the clipboard afterwards.   -FromEnv  takes it from your GEMINI_API_KEY environment variable.   -WhatIf  shows the plan only.
    Get a key at https://aistudio.google.com/apikey . Treat it like a password; use a key with a spending limit.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Remove,
    [switch]$FromClipboard,
    [switch]$FromEnv,
    [switch]$SkipCheck,
    [string]$WorkerDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\cloudshell'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$worker = 'rabbitsoftware-cloudshell'

if ($Remove) {
    if ($preview) { Write-Host "What if: delete the secret GEMINI_API_KEY from the Worker $worker."; return }
    Push-Location $WorkerDir
    try { & npx wrangler secret delete GEMINI_API_KEY --name $worker; if ($LASTEXITCODE -ne 0) { throw 'wrangler could not delete the secret (it may not exist).' } } finally { Pop-Location }
    Write-Host 'The key is removed. Gemini stays installed in the working session but cannot call the API.' -ForegroundColor Green
    return
}
if ($preview) {
    Write-Host "What if: take the key from $(if ($FromClipboard) { 'your clipboard' } elseif ($FromEnv) { 'your GEMINI_API_KEY variable' } else { 'a hidden prompt' }), check it with Google$(if ($SkipCheck) { ' (skipped)' }), store it as the Cloudflare secret GEMINI_API_KEY on $worker. The key is never printed."
    return
}

if ($FromClipboard) {
    $key = ((Get-Clipboard -Raw) | Out-String).Trim()
    Write-Host "`n1. Using the key on your clipboard (it will be cleared when this is done)." -ForegroundColor Cyan
} elseif ($FromEnv) {
    $key = "$env:GEMINI_API_KEY".Trim()
    Write-Host "`n1. Using your GEMINI_API_KEY environment variable." -ForegroundColor Cyan
} else {
    Write-Host "`n1. Create or copy a key at https://aistudio.google.com/apikey (a key with a spending limit is best)." -ForegroundColor Cyan
    $secure = Read-Host '2. Paste the key here (hidden)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $key = $key.Trim()
}
if ($key -notmatch '^AIza[0-9A-Za-z_-]{30,80}$') { throw 'That does not look like a Gemini API key (it should start with AIza and be a single token). Nothing was saved.' }

if (-not $SkipCheck) {
    Write-Host "`n3. Asking Google whether the key works (a read-only call that lists models)..." -ForegroundColor Cyan
    try {
        $r = Invoke-WebRequest 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1' -Headers @{ 'x-goog-api-key' = $key } -UseBasicParsing -TimeoutSec 30
        if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        throw "Google did not accept this key$(if ($code) { " (HTTP $code)" } else { ' (could not reach Google)' }). Nothing was saved."
    }
    Write-Host 'Google accepted the key.' -ForegroundColor Green
}

Write-Host "`n4. Storing it as the Cloudflare secret GEMINI_API_KEY on $worker (piped in, never printed)..." -ForegroundColor Cyan
Push-Location $WorkerDir
try {
    $key | & npx wrangler secret put GEMINI_API_KEY --name $worker
    if ($LASTEXITCODE -ne 0) { throw 'wrangler could not store the secret. Nothing else was changed.' }
} finally { Pop-Location; $key = $null }
if ($FromClipboard) { Set-Clipboard -Value ' '; Write-Host 'Clipboard cleared.' }
Write-Host "`nDone. Reload /cloudshell, tick 'Keep a working session', and the page will say Gemini is ready. Try: gemini -p ""say hello""" -ForegroundColor Green
