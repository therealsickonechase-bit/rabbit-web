<#
.SYNOPSIS
    Step 1 of 2 for the cloud vault mirror: stores a READ-ONLY GitHub token in Google Secret Manager. Run this one yourself; it is the only mirror script that handles a secret value.
.DESCRIPTION
    You create the token (nothing can create it for you):
      GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token
      Repository access: Only select repositories > therealsickonechase-bit/obsidian-rabbitos-vault
      Permissions: Repository permissions > Contents: Read-only  (nothing else). Set an expiry you can live with (for example 1 year).
    Then run this script and paste the token when asked. It is typed hidden, passed to gcloud through a temporary file that is deleted at once, and never printed or put on a command line.
    Secret       rabbit-vault-github-token
    Account      rabbit-vault-mirror (created here) may read this one secret and nothing else
    Safe to run again: an existing secret is kept unless you pass -Refresh (use that when the token expires). -WhatIf shows the plan.
    Step 2 is Setup-GcpVaultMirror.ps1, which holds no secret values.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [switch]$Refresh
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$sa = "rabbit-vault-mirror@$Project.iam.gserviceaccount.com"; $name = 'rabbit-vault-github-token'

Step "Secret $name"
if ($preview) { Write-Host "What if: create $name if missing, ask for the token if there is no version (or -Refresh), create rabbit-vault-mirror and let it read the secret" }
else {
    if (-not (Exists secrets describe $name --project $Project)) {
        Invoke-Gcloud services enable secretmanager.googleapis.com --project $Project
        Invoke-Gcloud secrets create $name --project $Project --replication-policy automatic | Out-Null
        Write-Host "created: $name"
    }
    $hasVersion = Exists secrets versions describe latest --secret $name --project $Project
    if ($Refresh -or -not $hasVersion) {
        $secure = Read-Host 'Paste the read-only GitHub token (hidden)' -AsSecureString
        $value = [System.Net.NetworkCredential]::new('', $secure).Password
        if (-not $value -or $value.Length -lt 20) { throw 'That does not look like a GitHub token.' }
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('sec-' + [guid]::NewGuid().ToString('N'))
        try { [IO.File]::WriteAllText($tmp, $value); Invoke-Gcloud secrets versions add $name --project $Project --data-file $tmp | Out-Null; Write-Host "stored a new version of $name" }
        finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; $value = $null }
    } else { Write-Host "kept the existing value of $name" }
    if (-not (Exists iam service-accounts describe $sa --project $Project)) { Invoke-Gcloud iam service-accounts create rabbit-vault-mirror --project $Project --display-name 'RabbitOS vault mirror' }
    foreach ($try in 1..6) {   # a brand-new account can take a few seconds to be visible to IAM
        $null = & gcloud secrets add-iam-policy-binding $name --member "serviceAccount:$sa" --role roles/secretmanager.secretAccessor --project $Project 2>&1
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 8
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not let $sa read $name" }
    Write-Host "rabbit-vault-mirror can read: $name"
}
Write-Host "`nDone. Next: pwsh -File scripts\powershell\Setup-GcpVaultMirror.ps1 -RunNow  (or ask Claude to run it)." -ForegroundColor Green
