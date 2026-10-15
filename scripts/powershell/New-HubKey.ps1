<#
.SYNOPSIS
    Creates, lists or revokes keys for the RabbitOS hub MCP (Cloud Run service rabbitos-hub-mcp). Keys are optional: without one, callers get the public read-only tools at a low rate.
.DESCRIPTION
    A key (hub_...) raises the rate limit from 20 to 120 calls per minute and is the only way to reach any future tool that needs approval.
    New key: generated here, COPIED TO YOUR CLIPBOARD, and never printed or saved. Only its SHA-256 hash is stored, on the service, as HUB_KEY_HASHES
    ("name:hash,..."). If you lose a key, revoke its name and make a new one.
    Changing the list creates a new revision of the service (a few seconds); nothing else is touched.
.EXAMPLE
    .\New-HubKey.ps1 -Name laptop          # make a key called laptop and put it on the clipboard
    .\New-HubKey.ps1 -List                 # show the key names (never the keys)
    .\New-HubKey.ps1 -Revoke laptop
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'New')]
param(
    [Parameter(ParameterSetName = 'New', Mandatory)][ValidatePattern('^[a-z0-9-]{1,32}$')][string]$Name,
    [Parameter(ParameterSetName = 'Revoke', Mandatory)][ValidatePattern('^[a-z0-9-]{1,32}$')][string]$Revoke,
    [Parameter(ParameterSetName = 'List')][switch]$List,
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$Service = 'rabbitos-hub-mcp'
)
$ErrorActionPreference = 'Stop'
function Get-Entries {
    $svc = & gcloud run services describe $Service --project $Project --region $Region --format json | ConvertFrom-Json
    $raw = ($svc.spec.template.spec.containers[0].env | Where-Object name -eq 'HUB_KEY_HASHES').value
    $entries = [ordered]@{}
    foreach ($part in ([string]$raw -split ',')) { if ($part.Trim() -match '^([a-z0-9-]{1,32}):([0-9a-f]{64})$') { $entries[$Matches[1]] = $Matches[2] } }
    return $entries
}
function Save-Entries($entries) {
    $value = ($entries.GetEnumerator() | ForEach-Object { "$($_.Key):$($_.Value)" }) -join ','
    if ($value) { & gcloud run services update $Service --project $Project --region $Region --update-env-vars "^@^HUB_KEY_HASHES=$value" --quiet }
    else { & gcloud run services update $Service --project $Project --region $Region --remove-env-vars HUB_KEY_HASHES --quiet }
    if ($LASTEXITCODE -ne 0) { throw 'gcloud run services update failed' }
}

$entries = Get-Entries
if ($List) {
    if ($entries.Count -eq 0) { Write-Host 'No hub keys yet. Anonymous callers get the public tools at 20 calls per minute.' }
    else { Write-Host 'Hub keys (names only):'; $entries.Keys | ForEach-Object { Write-Host "  $_" } }
    return
}
if ($Revoke) {
    if (-not $entries.Contains($Revoke)) { throw "No key named '$Revoke'." }
    if ($PSCmdlet.ShouldProcess($Service, "revoke key '$Revoke'")) { $entries.Remove($Revoke); Save-Entries $entries; Write-Host "Revoked '$Revoke'. It stops working as soon as the new revision serves traffic." }
    return
}
if ($entries.Contains($Name)) { throw "A key named '$Name' already exists. Revoke it first, or pick another name." }
if ($PSCmdlet.ShouldProcess($Service, "add key '$Name'")) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = 'hub_' + [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $hash = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') })
    $entries[$Name] = $hash
    Save-Entries $entries
    Set-Clipboard -Value $key
    Write-Host "Key '$Name' created and copied to your clipboard (ends in ...$($key.Substring($key.Length - 4)))." -ForegroundColor Green
    Write-Host 'It is not shown or saved anywhere else. Paste it where you need it now, e.g. as an Authorization: Bearer header or in your MCP client settings.'
    Write-Host 'Then clear the clipboard, for example:  Set-Clipboard -Value $null'
    $key = $null
}
