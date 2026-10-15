<#
.SYNOPSIS
    Sets up GCP as the backup, mirror and standby for rabbitsoftware.io (project rabbitsoftware-io). Idempotent; changes no DNS and no Cloudflare setting.
.DESCRIPTION
    1. Artifact Registry: cleanup policy in DRY-RUN mode (keep the 5 newest versions, drop test* tags and untagged images older than 7 days). Nothing is
       deleted until you run:  gcloud artifacts repositories set-cleanup-policies rabbit-software --location us-west2 --policy <file> --no-dry-run
    2. Backups bucket: non-current versions move to Nearline after 30 days and are deleted after 365; unfinished uploads are cleaned after 7 days.
    3. Standby site: builds an nginx image from the rabbitsoftware-cloudflare\site folder in Cloud Build and deploys it to Cloud Run as
       rabbit-site-standby (public, scale to zero, max 1 instance, 256 MiB). It is a copy of the public static site only: no secrets.
    Failover to the standby is a manual DNS change in Cloudflare; see docs\gcp-standby.md. Re-run this script after the site changes to refresh the copy.
.EXAMPLE
    .\Setup-GcpStandby.ps1 -WhatIf     # print what would run
    .\Setup-GcpStandby.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$SiteDir = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\site',
    [string]$Service = 'rabbit-site-standby',
    [switch]$SkipSite
)
$ErrorActionPreference = 'Stop'
# -WhatIf previews the GCP calls only. Local temp-file work still runs so the preview can check the site folder.
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..2] -join ' ') failed (exit $LASTEXITCODE)" } }

$work = Join-Path ([IO.Path]::GetTempPath()) ('rabbit-standby-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
try {
    # 1. Artifact Registry cleanup, dry run
    Step 'Artifact Registry cleanup policy (dry run)'
    $ar = @(
        @{ name = 'delete-test-tags'; action = @{ type = 'Delete' }; condition = @{ tagState = 'TAGGED'; tagPrefixes = @('test') } },
        @{ name = 'delete-untagged-after-7d'; action = @{ type = 'Delete' }; condition = @{ tagState = 'UNTAGGED'; olderThan = '7d' } },
        @{ name = 'keep-latest-5'; action = @{ type = 'Keep' }; mostRecentVersions = @{ keepCount = 5 } }
    ) | ConvertTo-Json -Depth 6
    $arFile = Join-Path $work 'ar-cleanup.json'; Set-Content $arFile $ar -Encoding utf8
    Invoke-IfLive 'set the rabbit-software cleanup policy (dry run)' {
        Invoke-Gcloud artifacts repositories set-cleanup-policies rabbit-software --project $Project --location $Region --policy $arFile --dry-run
    }

    # 2. Backups bucket lifecycle
    Step 'Backups bucket lifecycle'
    $lc = @{ rule = @(
        @{ action = @{ type = 'SetStorageClass'; storageClass = 'NEARLINE' }; condition = @{ daysSinceNoncurrentTime = 30; isLive = $false } },
        @{ action = @{ type = 'Delete' }; condition = @{ daysSinceNoncurrentTime = 365; isLive = $false } },
        @{ action = @{ type = 'AbortIncompleteMultipartUpload' }; condition = @{ age = 7 } }
    ) } | ConvertTo-Json -Depth 6
    $lcFile = Join-Path $work 'lifecycle.json'; Set-Content $lcFile $lc -Encoding utf8
    Invoke-IfLive 'set the lifecycle on gs://rabbitsoftware-io-backups' {
        Invoke-Gcloud storage buckets update gs://rabbitsoftware-io-backups --project $Project --lifecycle-file $lcFile
    }

    # 3. Standby site on Cloud Run
    if (-not $SkipSite) {
        Step "Standby site from $SiteDir"
        if (-not (Test-Path (Join-Path $SiteDir 'index.html'))) { throw "No index.html in $SiteDir" }
        $ctx = Join-Path $work 'ctx'
        New-Item -ItemType Directory -Force $ctx | Out-Null
        Copy-Item $SiteDir (Join-Path $ctx 'site') -Recurse
        # Cloudflare-only files must not be served as pages.
        Remove-Item (Join-Path $ctx 'site\_headers') -Force -ErrorAction SilentlyContinue
        # Fail before uploading if anything that looks like a secret is in the copy.
        $bad = Get-ChildItem (Join-Path $ctx 'site') -Recurse -File | Where-Object { $_.Name -match '^\.env|\.(pem|key|sqlite|db)$|\.dev\.vars' }
        if ($bad) { throw "Refusing to publish: $($bad.FullName -join ', ')" }
        Set-Content (Join-Path $ctx 'Dockerfile') -Encoding ascii -Value @'
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
'@
        Set-Content (Join-Path $ctx 'nginx.conf') -Encoding ascii -Value @'
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header X-Served-By gcp-standby always;
  location / { try_files $uri $uri.html $uri/ =404; }
  error_page 404 /404.html;
}
'@
        Invoke-IfLive "build and deploy $Service to Cloud Run" {
            Invoke-Gcloud run deploy $Service --project $Project --region $Region --source $ctx --allow-unauthenticated --max-instances 1 --min-instances 0 --memory 256Mi --cpu 1 --port 8080 --quiet
            $url = (& gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)').Trim()
            Write-Host "Standby URL: $url"
            foreach ($path in '/', '/chain.html', '/privacy.html') {
                try { $r = Invoke-WebRequest "$url$path" -UseBasicParsing -TimeoutSec 30; Write-Host ("  {0} {1}" -f $r.StatusCode, $path) }
                catch { Write-Host "  FAIL $path : $($_.Exception.Message)" -ForegroundColor Yellow }
            }
        }
    }
    Write-Host "`nDone. Nothing was deleted and no DNS was changed." -ForegroundColor Green
}
finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
