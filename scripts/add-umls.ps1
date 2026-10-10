<#
.SYNOPSIS
  Adds UMLS CUIs to the body model's organ concepts, asking for your UMLS API key privately.
.DESCRIPTION
  The key is typed into a hidden prompt, kept only in this PowerShell session's environment for the one command, and removed afterwards.
  It is never written to a file or the repo. Get a key at https://uts.nlm.nih.gov/uts/ (profile -> API key).
.EXAMPLE
  .\scripts\add-umls.ps1
#>
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$secure = Read-Host 'Paste your UMLS API key (hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ($plain.Trim().Length -lt 20) { Write-Host 'That does not look like a UMLS API key (too short). Nothing was changed.' -ForegroundColor Red; exit 1 }
    $env:UMLS_API_KEY = $plain.Trim()
    Push-Location $root
    node scripts/build-concepts.mjs
} finally {
    Remove-Item Env:UMLS_API_KEY -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Pop-Location -ErrorAction SilentlyContinue
}
Write-Host 'Done. The key was not saved anywhere. Check src\lib\concepts.generated.json, then tell Claude to run the tests and commit.' -ForegroundColor Green
