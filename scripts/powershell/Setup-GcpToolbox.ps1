<#
.SYNOPSIS
    Lets the cloud agents READ the toolbox (project rabbitsoftware-io): gs://rabbitsoftware-io-backups/toolbox/, the command catalog and the files the commands use. Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    The toolbox is published by rabbit-web\scripts\toolbox-publish.mjs (or Run-Toolbox.ps1) with your own sign-in. This script gives each cloud agent account a READ-ONLY role (roles/storage.objectViewer)
    on that one folder of the private backups bucket and on nothing else in it, using an IAM condition on the folder (object names AND listing). They get no write access and no access to the rest of the
    backups bucket (personal folders, EEG, the Supabase dump). Accounts: the task worker job and the research explorer job; add others with -Accounts.
    -Check lists who can read the toolbox and confirms none of them can read anything else in the bucket.
.EXAMPLE
    pwsh -File Setup-GcpToolbox.ps1 -WhatIf
    pwsh -File Setup-GcpToolbox.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Bucket = 'rabbitsoftware-io-backups',
    [string[]]$Accounts = @('rabbit-task-worker', 'rabbit-research-explorer'),
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Retry([scriptblock]$run, [string]$what) {
    foreach ($try in 1..6) { $null = & $run 2>&1; if ($LASTEXITCODE -eq 0) { return }; Start-Sleep -Seconds 8 }
    throw "Could not: $what"
}
$expr = "resource.name.startsWith(""projects/_/buckets/$Bucket/objects/toolbox/"") || api.getAttribute(""storage.googleapis.com/objectListPrefix"", """").startsWith(""toolbox/"")"

if ($Check) {
    Step "Who can read gs://$Bucket/toolbox/"
    $pol = gcloud storage buckets get-iam-policy "gs://$Bucket" --project $Project --format=json | ConvertFrom-Json
    foreach ($b in $pol.bindings) {
        if ($b.condition -and $b.condition.title -like 'toolbox-read-only*') { Write-Host ("{0}  {1}  [{2}]" -f $b.role, ($b.members -join ', '), $b.condition.title) }
    }
    $broad = $pol.bindings | Where-Object { -not $_.condition -and ($_.members | Where-Object { $_ -match 'rabbit-(task-worker|research-explorer)@' }) }
    if ($broad) { Write-Host "WARNING: an unconditional binding gives a toolbox account access to the whole bucket: $($broad.role -join ', ')" -ForegroundColor Yellow } else { Write-Host 'confirmed: no toolbox account has an unconditional role on the bucket' -ForegroundColor Green }
    return
}

foreach ($a in $Accounts) {
    $sa = "$a@$Project.iam.gserviceaccount.com"
    Step "$sa may read the toolbox folder (and only that)"
    if ($preview) { Write-Host "What if: grant roles/storage.objectViewer on gs://$Bucket with the condition: $expr"; continue }
    $file = Join-Path ([IO.Path]::GetTempPath()) ('cond-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    try {
        ConvertTo-Json -InputObject @{ title = "toolbox-read-only-$a"; expression = $expr } | Set-Content $file -Encoding ascii
        Retry { & gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$sa" --role roles/storage.objectViewer --project $Project --condition-from-file $file } "grant toolbox read to $sa"
    } finally { Remove-Item $file -Force -ErrorAction SilentlyContinue }
    Write-Host 'done'
}
Write-Host "`nDone. Publish the toolbox with: node scripts\toolbox-publish.mjs   Check with: pwsh -File scripts\powershell\Setup-GcpToolbox.ps1 -Check" -ForegroundColor Green
