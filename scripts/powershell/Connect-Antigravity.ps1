<#
.SYNOPSIS
    Connects Google Antigravity (the `agy` CLI and IDE) to the RabbitOS Hub so its agent can use the research tools (research_link, research_search, research_feed ...).
.DESCRIPTION
    Antigravity reads MCP servers from its own config. This registers the RabbitOS Hub (MCP over HTTP, public read-only research tools) with `agy mcp add`.
    It changes nothing if the server is already registered. No key or token is involved; the Hub's research tools are public and read only.
    -Remove   unregisters it.   -WhatIf  shows what would run.   -Test  runs one research_link search from the terminal afterwards.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Remove,
    [switch]$Test,
    [string]$Name = 'rabbitos-hub',
    [string]$HubUrl = 'https://rabbitos-hub-mcp-vxx5lz7c5a-wl.a.run.app/mcp'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false

$agy = Get-Command agy -ErrorAction SilentlyContinue
if (-not $agy) { $p = Join-Path $env:USERPROFILE '.gemini\bin\agy.exe'; if (Test-Path $p) { $agy = $p } else { throw 'The Antigravity CLI (agy) was not found. Install Antigravity first.' } }
$agyPath = if ($agy -is [string]) { $agy } else { $agy.Source }

$list = (& $agyPath mcp list 2>&1 | Out-String)
$present = $list -match [regex]::Escape($Name)

if ($Remove) {
    if (-not $present) { Write-Host "$Name is not registered. Nothing to do."; return }
    if ($preview) { Write-Host "What if: agy mcp remove $Name"; return }
    & $agyPath mcp remove $Name
    Write-Host "Removed $Name from Antigravity." -ForegroundColor Green
    return
}

if ($present) { Write-Host "$Name is already registered with Antigravity. Nothing changed." -ForegroundColor Green }
elseif ($preview) { Write-Host "What if: agy mcp add --type http $Name $HubUrl" }
else {
    & $agyPath mcp add --type http $Name $HubUrl
    if ($LASTEXITCODE -ne 0) { throw "agy mcp add failed (exit $LASTEXITCODE). Run 'agy mcp --help' to check the syntax for this version." }
    Write-Host "Registered $Name. Check it with: agy mcp list" -ForegroundColor Green
}

if ($Test -and -not $preview) {
    $repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    node (Join-Path $repo 'scripts\research-search.mjs') antigravity --limit 2
}
Write-Host "In Antigravity ask: 'Use research_link to search antigravity and tell me which results Maxwell already covers.'"
