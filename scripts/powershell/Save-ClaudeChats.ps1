<#
.SYNOPSIS
    Saves your Claude Code chats to the private Google Cloud backups bucket, with keys and tokens redacted first.
.DESCRIPTION
    Takes every chat transcript (*.jsonl) under ~\.claude\projects, replaces anything that looks like a secret with [redacted] (Google/Anthropic/OpenAI-style keys, GitHub tokens,
    JWTs, hub keys, private key blocks), and copies the result to gs://rabbitsoftware-io-backups/claude-chats/<project>/<chat id>.jsonl. A chat is only uploaded again when its size or
    modified time changed since the last save (state in ~\RabbitOS\chat-backup-state.json). The redacted copy is built in a temp folder and deleted afterwards; the original is never touched.
    The bucket is private. Chats can still contain personal text, so the redaction is a safety net, not a guarantee. -WhatIf lists what would be uploaded.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Bucket = 'gs://rabbitsoftware-io-backups/claude-chats',
    [string]$Source = (Join-Path $HOME '.claude\projects'),
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'gcloud is not installed or not on PATH.' }

$patterns = @(
    'AQ\.[A-Za-z0-9_-]{30,}', 'AIza[0-9A-Za-z_-]{30,}', '\bsk-[A-Za-z0-9_-]{16,}', '\bgh[pousr]_[A-Za-z0-9]{20,}',
    'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*', '\bhub_[A-Za-z0-9_-]{32,}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'
)
$stateFile = Join-Path $HOME 'RabbitOS\chat-backup-state.json'
$state = @{}
if (Test-Path $stateFile) { (Get-Content $stateFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value } }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("chatsave-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
$done = 0; $skipped = 0
try {
    foreach ($f in Get-ChildItem $Source -Recurse -Filter *.jsonl -File) {
        $project = $f.Directory.Name
        $key = "$project/$($f.Name)"
        $stamp = "$($f.Length)-$($f.LastWriteTimeUtc.Ticks)"
        if (-not $Force -and $state[$key] -eq $stamp) { $skipped++; continue }
        if ($preview) { Write-Host "What if: upload $key ($([math]::Round($f.Length/1MB,1)) MB) to $Bucket/$project/"; continue }
        $text = [IO.File]::ReadAllText($f.FullName)
        $hits = 0
        foreach ($p in $patterns) { $n = [regex]::Matches($text, $p).Count; if ($n) { $hits += $n; $text = [regex]::Replace($text, $p, '[redacted]') } }
        $out = Join-Path $tmp $f.Name
        [IO.File]::WriteAllText($out, $text)
        gcloud storage cp $out "$Bucket/$project/$($f.Name)" --quiet 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "upload failed for $key" }
        Remove-Item $out -Force
        $state[$key] = $stamp
        $done++
        Write-Host "saved $key ($hits redacted)"
    }
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    if (-not $preview) {
        New-Item -ItemType Directory -Force (Split-Path $stateFile) | Out-Null
        $state | ConvertTo-Json | Set-Content $stateFile
    }
}
Write-Host "Done. Saved $done chat(s), $skipped unchanged."
