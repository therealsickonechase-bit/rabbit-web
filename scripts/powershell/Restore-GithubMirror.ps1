<#
.SYNOPSIS
    Restores a repository from its cloud bundle (gs://rabbitsoftware-io-vault-private/github-bundles/) into a normal working folder. No GitHub account is needed.
.DESCRIPTION
    Downloads manifest.json and the repo's .bundle, checks the size and SHA-256 against the manifest, then `git clone`s it (all branches and tags are inside the bundle).
    -List shows what is available. The target folder must not exist yet. Nothing is pushed anywhere; to put a restored repo on GitHub, create the empty repo yourself and push it.
.EXAMPLE
    .\Restore-GithubMirror.ps1 -List
    .\Restore-GithubMirror.ps1 -Repo Maxwell-blockchain -Target C:\Users\odaat\Projects\Maxwell-blockchain
#>
[CmdletBinding()]
param(
    [string]$Repo,
    [string]$Target,
    [switch]$List,
    [string]$Bucket = 'rabbitsoftware-io-vault-private',
    [string]$Owner = 'rabbitsoftware-io'
)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('restore-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    gcloud storage cp "gs://$Bucket/github-bundles/manifest.json" $tmp --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the manifest. Run Backup-GithubMirrors.ps1 first, and check gcloud auth.' }
    $m = Get-Content (Join-Path $tmp 'manifest.json') -Raw | ConvertFrom-Json
    if ($List -or -not $Repo) {
        $m.repositories | Where-Object { $_.bundle } | ForEach-Object { '{0,-45} {1,6:N1} MB  {2,5} commits  head {3}' -f $_.repo, ($_.bytes / 1MB), $_.commits, $_.head.Substring(0, 8) }
        return
    }
    if (-not $Target) { throw 'Give -Target, the folder to create.' }
    if (Test-Path $Target) { throw "$Target already exists; restore into a new folder." }
    $entry = $m.repositories | Where-Object { $_.repo -eq "$Owner/$Repo" -and $_.bundle } | Select-Object -First 1
    if (-not $entry) { throw "No bundle for $Owner/$Repo. Run with -List to see what exists." }
    $file = Join-Path $tmp 'repo.bundle'
    gcloud storage cp "gs://$Bucket/github-bundles/$($entry.bundle)" $file --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Download failed.' }
    if ((Get-Item $file).Length -ne $entry.bytes -or (Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256) { throw 'The bundle does not match the manifest (size or SHA-256). Not restoring.' }
    git clone --quiet $file $Target
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }
    git -C $Target remote remove origin 2>$null
    Write-Host ("Restored {0} to {1} ({2} commits, head {3})." -f $entry.repo, $Target, $entry.commits, $entry.head.Substring(0, 8)) -ForegroundColor Green
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
