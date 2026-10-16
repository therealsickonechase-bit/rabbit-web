<#
.SYNOPSIS
    Compare a DNA sequence with the public cancer-gene variant index on THIS PC only. The sequence and the result never leave it; only an acknowledgement does (the echo model).
.DESCRIPTION
    Runs research-agents\dna_local.py. RABBIT_INGEST_SECRET is read from research-agents\.env into this process only, to sign the acknowledgement; nothing is printed.
    What is shared (private bucket echo/dna/pc/<date>.json): when, how many sequences, which PUBLIC index root, completed or failed, and a seal that only this PC's key can reproduce.
    What is NOT shared: the sequence, any part or fingerprint of it, which genes or variants it touched, or the result. The result is shown here and saved in ~\RabbitOS\private\dna-results\.
    The cloud echo acknowledges the entry within about 5 minutes; -Status shows announced / acknowledged counts. The agents are told only that a comparison completed.
    Put the FASTA file somewhere that is not synced or backed up if you want it to stay only on this PC (the personal-folder backup copies Downloads, Desktop and Documents).
.EXAMPLE
    pwsh -File Run-DnaLocal.ps1 -Fasta C:\Private\my_region.fasta
    pwsh -File Run-DnaLocal.ps1 -Status
#>
[CmdletBinding()]
param(
    [string]$Fasta,
    [switch]$Status,
    [string]$AgentsDir = 'C:\Users\odaat\Projects\research-agents'
)
$ErrorActionPreference = 'Stop'
foreach ($extra in (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\Scripts'), (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin')) { if ((Test-Path $extra) -and ($env:PATH -notlike "*$extra*")) { $env:PATH = "$env:PATH;$extra" } }
$envFile = Join-Path $AgentsDir '.env'
$l = if (Test-Path $envFile) { Get-Content $envFile | Where-Object { $_ -match '^\s*RABBIT_INGEST_SECRET\s*=' } | Select-Object -First 1 }
if ($l) { $env:RABBIT_INGEST_SECRET = (($l -split '=', 2)[1].Trim().Trim('"').Trim("'")) }
Push-Location $AgentsDir
try {
    if ($Status) { python dna_local.py status }
    elseif ($Fasta) { if (-not (Test-Path $Fasta)) { throw "File not found: $Fasta" }; python dna_local.py compare --fasta $Fasta }
    else { Get-Help $PSCommandPath -Detailed }
} finally { Remove-Item Env:RABBIT_INGEST_SECRET -ErrorAction SilentlyContinue; Pop-Location }
