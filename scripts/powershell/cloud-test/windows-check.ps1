# Runs on a Google Cloud Windows Server test VM at every boot (as SYSTEM). It installs Node.js, downloads the PUBLISHED Maxwell Core release as a user would, installs it machine-wide
# (-System), and prints lines starting "MC-TEST:" (they appear on the serial console), ending with "MC-TEST-RESULT: PASS" or "FAIL". Phase 1 installs and reboots; phase 2 proves the SYSTEM task started it.
$ErrorActionPreference = 'Continue'
$global:fail = $false
function P($m) { Write-Host "MC-TEST: $m" }
function Ok([bool]$cond, [string]$what) { if ($cond) { P "PASS  $what" } else { P "FAIL  $what"; $global:fail = $true } }
function WaitVerified { for ($i = 0; $i -lt 90; $i++) { try { if ((Invoke-WebRequest 'http://127.0.0.1:8646/api/summary' -UseBasicParsing -TimeoutSec 5).Content -match '"verified":true') { return $true } } catch { }; Start-Sleep 2 }; return $false }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$marker = 'C:\mc-test-phase1'
$pf = $env:ProgramFiles
$mcBase = try { $r = Invoke-WebRequest -UseBasicParsing -Headers @{ 'Metadata-Flavor' = 'Google' } 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/mc-base' -TimeoutSec 5; $c = $r.Content; if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }; $c.Trim() } catch { 'https://rabbitsoftware.io/downloads' }      # Windows PowerShell 5.1 can hand back bytes for this content type

if (-not (Test-Path $marker)) {
  P "PHASE 1 on $([Environment]::OSVersion.VersionString), PowerShell $($PSVersionTable.PSVersion), user $(whoami)"
  # Node.js 22 (official zip, checked against nodejs.org's checksum list) into Program Files
  $nodeBase = 'https://nodejs.org/dist/latest-v22.x'
  $sums = (Invoke-WebRequest "$nodeBase/SHASUMS256.txt" -UseBasicParsing).Content
  $nz = ([regex]::Match($sums, 'node-v[\d.]+-win-x64\.zip')).Value
  Invoke-WebRequest "$nodeBase/$nz" -OutFile "C:\$nz" -UseBasicParsing
  $want = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($nz) } | Select-Object -First 1).Split(' ')[0]
  Ok ((Get-FileHash "C:\$nz" -Algorithm SHA256).Hash.ToLower() -eq $want) "Node.js $nz matches nodejs.org checksum"
  Expand-Archive "C:\$nz" -DestinationPath C:\nodetmp -Force
  New-Item -ItemType Directory -Force "$pf\nodejs" | Out-Null
  Copy-Item "C:\nodetmp\$($nz -replace '\.zip$')\*" "$pf\nodejs" -Recurse -Force
  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'Machine') + ";$pf\nodejs", 'Machine'); $env:Path += ";$pf\nodejs"
  P "node $(& "$pf\nodejs\node.exe" -v)"
  # the release, as a user would get it
  $p = Invoke-RestMethod "$mcBase/maxwell-core-latest.json"
  Ok ($null -ne $p.signature) "release pointer is signed (version $($p.version))"
  Invoke-WebRequest "$mcBase/$($p.file)" -OutFile "C:\$($p.file)" -UseBasicParsing
  Ok ((Get-FileHash "C:\$($p.file)" -Algorithm SHA256).Hash.ToLower() -eq $p.sha256) "zip matches the signed checksum"
  Expand-Archive "C:\$($p.file)" -DestinationPath C:\mcx -Force
  $dir = "C:\mcx\maxwell-core-$($p.version)"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$dir\platforms\windows\install.ps1" -System 2>&1 | ForEach-Object { P "installer: $_" }
  Ok ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) "machine-wide installer finished"
  Ok (WaitVerified) "dashboard reports a verified chain"
  $mc = "$pf\MaxwellCore\maxwell-core.cmd"
  $v = & $mc verify 2>&1; $v | Select-Object -Last 2 | ForEach-Object { P "verify: $_" }
  Ok (($v -join "`n") -match 'All [0-9]+ blocks verify') "maxwell-core verify re-checks every block of the chain"
  Ok (($v -join "`n") -match 'same tip') "tip matches the Google Cloud gateway"
  & $mc watch --once 2>&1 | ForEach-Object { P "watch: $_" }
  & $mc update 2>&1 | ForEach-Object { P "update: $_" }
  Ok ((Get-ScheduledTask -TaskName MaxwellCore).Principal.UserId -eq 'SYSTEM') "task runs as SYSTEM"
  $acl = (Get-Acl "$env:ProgramData\MaxwellCore").Access | ForEach-Object { "$($_.IdentityReference)" }
  P "data folder access: $($acl -join ', ')"
  Ok (-not ($acl -match 'Users')) "data folder is closed to ordinary users"
  $mp = [Environment]::GetEnvironmentVariable('Path', 'Machine'); Ok ($mp -match 'MaxwellCore') "program folder is on the system PATH"
  if (-not $global:fail) { Set-Content $marker 'phase1'; P 'PHASE 1 done; rebooting to prove the SYSTEM task starts it'; Restart-Computer -Force } else { P 'MC-TEST-RESULT: FAIL (phase 1)' }
} else {
  P "PHASE 2 after reboot: uptime $((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime)"
  Ok (WaitVerified) "node started by itself at boot (before any sign-in) and verified the chain"
  $o = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*MaxwellCore*' } | Select-Object -First 1
  if ($o) { $own = Invoke-CimMethod -InputObject $o -MethodName GetOwner; P "node runs as $($own.Domain)\$($own.User)"; Ok ($own.User -eq 'SYSTEM') "node runs as SYSTEM" }
  & "$pf\MaxwellCore\maxwell-core.cmd" verify 2>&1 | Select-Object -Last 2 | ForEach-Object { P "verify: $_" }
  if (-not $global:fail) { P 'MC-TEST-RESULT: PASS' } else { P 'MC-TEST-RESULT: FAIL (phase 2)' }
}
