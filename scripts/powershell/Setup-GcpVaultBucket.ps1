<#
.SYNOPSIS
    Creates the private Google Cloud bucket for the Obsidian vault (project rabbitsoftware-io, us-west2). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    gs://rabbitsoftware-io-vault-private
      private       uniform access, public access prevention ENFORCED (nothing in it can ever be made public), no allUsers / allAuthenticatedUsers
      versioned     every overwrite or delete keeps the old copy; versions you replaced are deleted after 90 days
      cheap         Standard storage; the vault set is a few hundred MB
    Nothing reads it except your own Google account and the project owners. The guest shell, the hub and the Cloud Run services have no access to it.
    Fill it with Sync-VaultToGcs.ps1.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$Bucket = 'rabbitsoftware-io-vault-private'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }

Step "Bucket gs://$Bucket"
Invoke-IfLive "create the bucket (private, versioned, public access prevention enforced), keep replaced versions 90 days" {
    if (-not (Exists storage buckets describe "gs://$Bucket" --project $Project)) {
        Invoke-Gcloud storage buckets create "gs://$Bucket" --project $Project --location $Region --uniform-bucket-level-access --public-access-prevention --default-storage-class STANDARD
        Write-Host "created bucket: $Bucket"
    } else { Write-Host "bucket exists: $Bucket" }
    Invoke-Gcloud storage buckets update "gs://$Bucket" --project $Project --versioning --public-access-prevention --uniform-bucket-level-access
    $rules = Join-Path ([IO.Path]::GetTempPath()) ('lifecycle-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    try {
        $json = '{"rule":[{"action":{"type":"Delete"},"condition":{"daysSinceNoncurrentTime":90,"isLive":false}}]}'
        [IO.File]::WriteAllText($rules, $json)
        Invoke-Gcloud storage buckets update "gs://$Bucket" --project $Project --lifecycle-file $rules
    } finally { Remove-Item $rules -Force -ErrorAction SilentlyContinue }
}

Step 'Check: nothing here is public'
Invoke-IfLive 'read the bucket policy and settings back' {
    $iam = (& gcloud storage buckets get-iam-policy "gs://$Bucket" --project $Project --format json | ConvertFrom-Json)
    $public = @($iam.bindings | Where-Object { $_.members -match 'allUsers|allAuthenticatedUsers' })
    Write-Host ("public bindings: {0}" -f $public.Count)
    if ($public.Count) { throw 'The bucket has a public binding. Remove it before putting anything in.' }
    & gcloud storage buckets describe "gs://$Bucket" --project $Project --format 'value(public_access_prevention,uniform_bucket_level_access,versioning_enabled,location)'
}
Write-Host "`nDone. Next: pwsh -File scripts\powershell\Sync-VaultToGcs.ps1 -WhatIf   then without -WhatIf." -ForegroundColor Green
