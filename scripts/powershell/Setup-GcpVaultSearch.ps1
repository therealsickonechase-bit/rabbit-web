<#
.SYNOPSIS
    Makes the vault copy in Google Cloud searchable with Vertex AI Search (project rabbitsoftware-io). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Data store   rabbit-vault          reads gs://rabbitsoftware-io-vault-private/vault/** (the private copy made by Sync-VaultToGcs.ps1)
    Search app   rabbit-vault-search   the app you query; nothing about it is public
    Access       only your Google account (and project owners) can search. It is NOT connected to the hub, the guest shell or any Cloud Run service, so no anonymous caller can reach vault text.
    Reader       Google's Discovery Engine service agent gets read-only access to the vault bucket, because it has to read the files to index them. Nothing else gets access.
    -ImportOnly  skip creation and just re-import (picks up new and changed notes). -SkipImport creates things without importing.
    Query it with Search-Vault.ps1.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Bucket = 'rabbitsoftware-io-vault-private',
    [string]$DataStore = 'rabbit-vault',
    [string]$Engine = 'rabbit-vault-search',
    [switch]$ImportOnly,
    [switch]$SkipImport
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
$base = "https://discoveryengine.googleapis.com/v1/projects/$Project/locations/global/collections/default_collection"
function Api([string]$method, [string]$url, $body = $null, [switch]$Quiet404) {
    $tok = (& gcloud auth print-access-token).Trim()
    $h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
    try {
        if ($null -ne $body) { Invoke-RestMethod -Method $method -Uri $url -Headers $h -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10) }
        else { Invoke-RestMethod -Method $method -Uri $url -Headers $h }
    } catch {
        if ($Quiet404 -and $_.Exception.Response.StatusCode.value__ -eq 404) { return $null }
        $msg = ("$($_.ErrorDetails.Message)" -replace '\s+', ' ')
        if (-not $msg) { $msg = "$($_.Exception.Message)" }
        throw ("{0} {1} -> {2}" -f $method, ($url -replace '^https://[^/]+', ''), $msg.Substring(0, [Math]::Min(500, $msg.Length)))
    }
}
function Wait-Operation([string]$name, [int]$maxMinutes = 30) {
    $until = (Get-Date).AddMinutes($maxMinutes)
    while ((Get-Date) -lt $until) {
        $op = Api GET "https://discoveryengine.googleapis.com/v1/$name"
        if ($op.done) { return $op }
        Start-Sleep -Seconds 10
    }
    throw "Timed out waiting for $name"
}

if (-not $ImportOnly) {
    Step 'Turn on the Vertex AI Search API'
    Invoke-IfLive 'enable discoveryengine.googleapis.com' { Invoke-Gcloud services enable discoveryengine.googleapis.com --project $Project }

    Step "Data store $DataStore"
    Invoke-IfLive "create the data store (documents read from gs://$Bucket/vault/)" {
        if (Api GET "$base/dataStores/$DataStore" -Quiet404) { Write-Host "data store exists: $DataStore" }
        else {
            $op = Api POST "$base/dataStores?dataStoreId=$DataStore" @{ displayName = 'RabbitOS vault'; industryVertical = 'GENERIC'; solutionTypes = @('SOLUTION_TYPE_SEARCH'); contentConfig = 'CONTENT_REQUIRED' }
            [void](Wait-Operation $op.name 10); Write-Host "created data store: $DataStore"
        }
    }

    Step "Search app $Engine"
    Invoke-IfLive "create the search app on that data store" {
        if (Api GET "$base/engines/$Engine" -Quiet404) { Write-Host "search app exists: $Engine" }
        else {
            [void](Api POST "$base/engines?engineId=$Engine" @{ displayName = 'RabbitOS vault search'; solutionType = 'SOLUTION_TYPE_SEARCH'; dataStoreIds = @($DataStore); searchEngineConfig = @{ searchTier = 'SEARCH_TIER_STANDARD' } })
            # The long-running operation for an engine is not always readable at its reported address, so wait for the app itself to appear.
            $until = (Get-Date).AddMinutes(10)
            while ((Get-Date) -lt $until -and -not (Api GET "$base/engines/$Engine" -Quiet404)) { Start-Sleep -Seconds 10 }
            if (-not (Api GET "$base/engines/$Engine" -Quiet404)) { throw 'The search app did not appear within 10 minutes.' }
            Write-Host "created search app: $Engine"
        }
    }

    Step 'Read access for the indexer (read-only, this one bucket)'
    Invoke-IfLive "let Google's Discovery Engine service agent read gs://$Bucket" {
        $num = (& gcloud projects describe $Project --format 'value(projectNumber)').Trim()
        $agent = "serviceAccount:service-$num@gcp-sa-discoveryengine.iam.gserviceaccount.com"
        foreach ($try in 1..8) {   # the service agent can take a moment to exist after the API is enabled
            $null = & gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member $agent --role roles/storage.objectViewer --project $Project 2>&1
            if ($LASTEXITCODE -eq 0) { Write-Host 'indexer can read the bucket (read only)'; return }
            Start-Sleep -Seconds 10
        }
        throw 'Could not give the Discovery Engine service agent read access to the bucket.'
    }
}

if (-not $SkipImport) {
    Step 'Import the vault files into the data store'
    Invoke-IfLive "import gs://$Bucket/vault/** (incremental: new and changed notes)" {
        $op = Api POST "$base/dataStores/$DataStore/branches/0/documents:import" @{ gcsSource = @{ inputUris = @("gs://$Bucket/vault/**"); dataSchema = 'content' }; reconciliationMode = 'INCREMENTAL' }
        Write-Host "import started: $($op.name -replace '^.*/operations/', '')"
        $done = Wait-Operation $op.name 45
        if ($done.error) { throw "import failed: $($done.error.message)" }
        $m = $done.metadata
        Write-Host ("imported: {0} documents, {1} failed" -f $m.successCount, $m.failureCount)
        if ($done.response.errorSamples) { $done.response.errorSamples | Select-Object -First 5 | ForEach-Object { Write-Host "  sample error: $($_.message)" } }
    }
}
Write-Host "`nDone. Search with: pwsh -File scripts\powershell\Search-Vault.ps1 'your words'" -ForegroundColor Green
