<#
.SYNOPSIS
    Searches your Obsidian vault copy in Google Cloud with Vertex AI Search. Read-only. Only you can run it (it uses your own gcloud sign-in).
.EXAMPLE
    pwsh -File scripts\powershell\Search-Vault.ps1 'hub key rotation' -Top 5
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][ValidateLength(2, 300)][string]$Query,
    [ValidateRange(1, 25)][int]$Top = 8,
    [string]$Project = 'rabbitsoftware-io',
    [string]$Engine = 'rabbit-vault-search'
)
$ErrorActionPreference = 'Stop'
$tok = (& gcloud auth print-access-token).Trim()
$h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
$url = "https://discoveryengine.googleapis.com/v1/projects/$Project/locations/global/collections/default_collection/engines/$Engine/servingConfigs/default_search:search"
$body = @{ query = $Query; pageSize = $Top; contentSearchSpec = @{ snippetSpec = @{ returnSnippet = $true } } } | ConvertTo-Json -Depth 6
try { $r = Invoke-RestMethod -Method Post -Uri $url -Headers $h -ContentType 'application/json' -Body $body }
catch {
    $msg = ("$($_.ErrorDetails.Message)" -replace '\s+', ' ')
    if (-not $msg) { $msg = "$($_.Exception.Message)" }
    throw ("search failed: " + $msg.Substring(0, [Math]::Min(400, $msg.Length)))
}
if (-not $r.results) { Write-Host 'No matches.'; return }
$i = 0
foreach ($x in $r.results) {
    $i++
    $d = $x.document.derivedStructData
    $path = ($d.link -replace '^gs://[^/]+/vault/', '')
    $snip = if ($d.snippets) { ($d.snippets[0].snippet -replace '<[^>]+>', '' -replace '&nbsp;', ' ' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&amp;', '&' -replace '&lt;', '<' -replace '&gt;', '>' -replace '\s+', ' ').Trim() } else { '' }
    Write-Host ("{0}. {1}" -f $i, $path) -ForegroundColor Cyan
    if ($snip) { Write-Host ("   {0}" -f $snip.Substring(0, [Math]::Min(220, $snip.Length))) }
}
Write-Host ("`n{0} result(s) shown of about {1}." -f $i, $r.totalSize)
