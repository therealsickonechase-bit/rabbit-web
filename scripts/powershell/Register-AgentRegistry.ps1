<#
.SYNOPSIS
    Lists the RabbitOS agents and MCP servers that run in Google Cloud in the Google Cloud Agent Registry (project rabbitsoftware-io), so they can be found, accessed and governed from there. Idempotent. -WhatIf prints the plan and registers nothing.
.DESCRIPTION
    Reads scripts\agent-registry.json. For each entry it reads the live thing, then creates or updates a registry "service":
      kind agent  fetches the agent's A2A agent card (<url>/.well-known/agent-card.json) and registers it as an Agent (agentSpec type A2A_AGENT_CARD)
      kind mcp    calls tools/list on the MCP server and registers it as an MCP Server (mcpServerSpec type TOOL_SPEC)
    Registering only DESCRIBES where an agent is; it does not give anyone access, deploy anything, or change the agent. Access is whatever the agent itself allows (these two are public and read only).
    Nothing secret is read or sent. Uses your own gcloud sign-in. -Remove deletes the registry entries this script created (never the agents).
.EXAMPLE
    pwsh -File Register-AgentRegistry.ps1 -WhatIf
    pwsh -File Register-AgentRegistry.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Manifest = (Join-Path $PSScriptRoot '..\agent-registry.json'),
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$m = Get-Content $Manifest -Raw | ConvertFrom-Json
$loc = $m.location
$tok = (& gcloud auth print-access-token).Trim()
$h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
$base = "https://agentregistry.googleapis.com/v1alpha/projects/$Project/locations/$loc"
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Api([string]$method, [string]$url, $body) {
    $args2 = @{ Method = $method; Uri = $url; Headers = $h; ContentType = 'application/json'; TimeoutSec = 60 }
    if ($body) { $args2.Body = ($body | ConvertTo-Json -Depth 30 -Compress) }
    Invoke-RestMethod @args2
}
function Wait-Operation($op) {
    if (-not $op -or $op.done) { return $op }
    foreach ($i in 1..30) { Start-Sleep -Seconds 2; $o = Api GET "https://agentregistry.googleapis.com/v1alpha/$($op.name)" $null; if ($o.done) { if ($o.error) { throw ($o.error | ConvertTo-Json -Compress) }; return $o } }
    throw 'The registry operation did not finish in time.'
}

foreach ($e in $m.entries) {
    Step "$($e.displayName) [$($e.kind)] -> services/$($e.id)"
    $name = "projects/$Project/locations/$loc/services/$($e.id)"
    if ($Remove) {
        if ($preview) { Write-Host "What if: delete $name"; continue }
        try { [void](Wait-Operation (Api DELETE "https://agentregistry.googleapis.com/v1alpha/$name" $null)); Write-Host "deleted: $name" } catch { Write-Host "not there: $name" }
        continue
    }
    # 1. read the live thing
    $service = [ordered]@{ displayName = $e.displayName; description = $e.description }
    if ($e.kind -eq 'agent') {
        # For an A2A agent the connection details (url, transport) live inside the agent card, so the service carries no separate interfaces.
        $card = Invoke-RestMethod $e.cardUrl -TimeoutSec 30
        Write-Host ("agent card read: {0} v{1}, {2} skills" -f $card.name, $card.version, $card.skills.Count)
        $service.agentSpec = @{ type = 'A2A_AGENT_CARD'; content = $card }
    } else {
        $service.interfaces = @(@{ url = $e.baseUrl; protocolBinding = $e.protocolBinding })
        $init = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
        $r = Invoke-RestMethod -Method Post -Uri $e.baseUrl -Body $init -ContentType 'application/json' -Headers @{ Accept = 'application/json, text/event-stream' } -TimeoutSec 30
        $tools = @($r.result.tools | ForEach-Object { [ordered]@{ name = $_.name; description = $_.description; inputSchema = $_.inputSchema } })
        Write-Host ("tools read: {0}" -f $tools.Count)
        $service.mcpServerSpec = @{ type = 'TOOL_SPEC'; content = @{ tools = $tools } }
    }
    if ($preview) { Write-Host "What if: create or update $name in the Agent Registry"; continue }
    # 2. create, or update when it already exists
    try {
        $op = Api POST "$base/services?serviceId=$($e.id)" $service
        [void](Wait-Operation $op); Write-Host "registered: $name"
    } catch {
        if ("$($_.ErrorDetails.Message)" -notmatch 'ALREADY_EXISTS|already exists|409') { throw }
        $mask = if ($e.kind -eq 'agent') { 'displayName,description,agentSpec' } else { 'displayName,description,interfaces,mcpServerSpec' }
        $op = Api PATCH "https://agentregistry.googleapis.com/v1alpha/${name}?updateMask=$mask" $service
        [void](Wait-Operation $op); Write-Host "updated: $name"
    }
}
if (-not $Remove -and -not $preview) {
    Step 'What the registry now lists from this project'
    foreach ($kind in 'agents', 'mcpServers') {
        $l = Api GET "$base/${kind}?pageSize=100" $null
        foreach ($x in @($l.$kind)) { Write-Host ("{0,-10} {1}  ({2})" -f $kind, $x.displayName, ($x.name -replace '^projects/[^/]+/locations/', '')) }
    }
}
Write-Host "`nDone." -ForegroundColor Green
