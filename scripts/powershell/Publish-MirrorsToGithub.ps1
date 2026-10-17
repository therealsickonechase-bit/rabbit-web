<#
.SYNOPSIS
    Puts GitHub Live mirrors back on GitHub as NEW PRIVATE repositories under your own account (default: the signed-in gh account). -WhatIf shows the plan and changes nothing.
.DESCRIPTION
    Built for the rabbitsoftware-io organisation mirrors whose admin account is suspended. For each mirror that has commits and has no repository of that name under your account:
      1. creates a private repository (GitHub API, private = true, no auto-init),
      2. pushes every local branch and tag from the mirror (the mirror itself is only read).
    Never overwrites or force-pushes: an existing repository with the same name is skipped. Public repositories become PRIVATE copies; make one public later on GitHub if you want that.
    Uses the signed-in `gh` account (check with `gh auth status`) as the git credential for the push. Nothing secret is printed.
    -Only 'name1','name2' limits the run. -Exclude skips names. Log: ~\RabbitOS\logs\github-publish-<date>.log
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Vault = (Join-Path $HOME 'Documents\RabbitOS Vault'),
    [string]$Owner = 'rabbitsoftware-io',
    [string]$Account,
    [string[]]$Only = @(),
    [string[]]$Exclude = @()
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
$logDir = Join-Path $HOME 'RabbitOS\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("github-publish-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
function Log($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Add-Content -Path $log -Value $line; Write-Host $line }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'The GitHub CLI (gh) is not installed.' }
if (-not $Account) { $Account = (gh api user --jq .login).Trim() }
if (-not $Account) { throw 'Could not read the signed-in gh account.' }
$root = Join-Path $Vault "GitHub Live\Repositories\$Owner"
if (-not (Test-Path $root)) { throw "No mirrors at $root" }
$existing = @{}
gh repo list $Account --limit 500 --json name --jq '.[].name' | ForEach-Object { $existing[$_.Trim()] = $true }
Log "Account $Account has $($existing.Count) repositories. Mode: $(if ($preview) { 'plan only' } else { 'create and push' })."

$created = 0; $skipped = 0; $failed = 0
foreach ($dir in Get-ChildItem $root -Directory | Sort-Object Name) {
    $name = $dir.Name
    if ($Only.Count -and $name -notin $Only) { continue }
    if ($name -in $Exclude) { Log "skip   $name (excluded)"; $skipped++; continue }
    $refs = @(git -C $dir.FullName for-each-ref refs/heads refs/tags --format='%(refname)')
    if ($refs.Count -eq 0) { Log "skip   $name (no commits)"; $skipped++; continue }
    if ($existing.ContainsKey($name) -or $existing.ContainsKey($name.TrimStart('-'))) { Log "skip   $name (already under $Account)"; $skipped++; continue }
    if ($preview) { Log "would create private $Account/$name and push $($refs.Count) ref(s)"; continue }
    try {
        $desc = "Restored from the $Owner mirror on $(Get-Date -Format 'yyyy-MM-dd')"
        gh api user/repos -f "name=$name" -F private=true -f "description=$desc" --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'repository could not be created' }
        $url = "https://github.com/$Account/$name.git"
        git -C $dir.FullName -c "credential.helper=" -c "credential.helper=!gh auth git-credential" push $url 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*' 2>&1 | Select-Object -Last 2 | ForEach-Object { Log "       $_" }
        if ($LASTEXITCODE -ne 0) { throw 'push failed' }
        Log "pushed $Account/$name (private, $($refs.Count) ref(s))"; $created++
    } catch { Log "FAILED $name : $($_.Exception.Message)"; $failed++ }
}
Log "Done. created $created, skipped $skipped, failed $failed."
if ($failed) { exit 1 }
