<#
.SYNOPSIS
    Publishes the current Maxwell Core release to Google Cloud storage, as a download mirror next to rabbitsoftware.io. -WhatIf shows the plan and uploads nothing.
.DESCRIPTION
    Uploads site\downloads\maxwell-core-<version>.zip, its .sha256 and maxwell-core-latest.json (the signed pointer) from the rabbitsoftware-cloudflare repository to
    gs://rabbitsoftware-io-ledger-public/releases/maxwell-core/ , which anyone can read:
        https://rabbitsoftware-io-ledger-public.storage.googleapis.com/releases/maxwell-core/maxwell-core-latest.json
    Nothing is uploaded unless scripts\verify-release-pointer.mjs accepts the folder: the pointer must be signed by a project release key, not stale, and the ZIP must match the signed checksum.
    The ZIP and checksum are immutable (cached for a year, old versions stay); the pointer is never cached. After the upload the public copy is downloaded again and compared, byte for byte.
    Installed copies fall back to this mirror by themselves when rabbitsoftware.io is unreachable (the same signature check applies, so a mirror cannot change what they install).
.EXAMPLE
    .\Publish-MaxwellCoreRelease.ps1 -WhatIf
    .\Publish-MaxwellCoreRelease.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SiteRepo = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare',
    [string]$Bucket = 'rabbitsoftware-io-ledger-public',
    [string]$Prefix = 'releases/maxwell-core'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$dir = Join-Path $SiteRepo 'site\downloads'
$check = & node (Join-Path $SiteRepo 'scripts\verify-release-pointer.mjs') $dir 2>&1
if ($LASTEXITCODE -ne 0) { throw "Refusing to publish: $check" }
Write-Host $check
$p = Get-Content (Join-Path $dir 'maxwell-core-latest.json') -Raw | ConvertFrom-Json
$zip = Join-Path $dir $p.file
$sha = Join-Path $dir ($p.file -replace '\.zip$', '.sha256')
$ptr = Join-Path $dir 'maxwell-core-latest.json'
$base = "gs://$Bucket/$Prefix"
$pub = "https://$Bucket.storage.googleapis.com/$Prefix"
if ($preview) {
    Write-Host "What if: upload $($p.file) and its .sha256 to $base/ (immutable), then maxwell-core-latest.json (no cache), then download $pub/$($p.file) and compare it with the local file."
    return
}
$immutable = 'public, max-age=31536000, immutable'
gcloud storage cp $zip "$base/$($p.file)" --cache-control=$immutable --content-type=application/zip --quiet 2>&1 | Out-Null; if ($LASTEXITCODE) { throw 'zip upload failed' }
gcloud storage cp $sha "$base/$(Split-Path $sha -Leaf)" --cache-control=$immutable --content-type=text/plain --quiet 2>&1 | Out-Null; if ($LASTEXITCODE) { throw 'checksum upload failed' }
# the pointer goes last: it only ever names a ZIP that is already there
gcloud storage cp $ptr "$base/maxwell-core-latest.json" --cache-control='no-cache, max-age=0' --content-type=application/json --quiet 2>&1 | Out-Null; if ($LASTEXITCODE) { throw 'pointer upload failed' }
Write-Host "Uploaded to $base/"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "mc-mirror-$([guid]::NewGuid().ToString('N')).zip"
try {
    Invoke-WebRequest "$pub/$($p.file)?cb=$(Get-Random)" -OutFile $tmp -UseBasicParsing
    $got = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $p.sha256) { throw "the public copy does not match: $got" }
    $livePtr = Invoke-RestMethod "$pub/maxwell-core-latest.json?cb=$(Get-Random)"
    if ($livePtr.sha256 -ne $p.sha256 -or $livePtr.version -ne $p.version) { throw 'the public pointer does not match the one uploaded' }
    Write-Host "Verified from the public address: $pub/$($p.file) ($([math]::Round((Get-Item $tmp).Length / 1KB)) KB, sha256 matches the signed pointer)"
} finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
