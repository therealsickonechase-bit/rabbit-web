# Self-test for RabbitNet. Run:  pwsh -File scripts/powershell/test-rabbitnet.ps1   (add -Live to also try the real network, read-only GETs)
# Offline by default: the network function is replaced inside the module by a fake that serves test-vector.json, which was produced by the
# TypeScript code (scripts/powershell/make-test-vector.mjs, src/lib/chain-ledger.ts). Nothing is written outside a temporary folder.
param([switch]$Live)

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "SKIP: RabbitNet needs PowerShell 7 (pwsh); this is $($PSVersionTable.PSVersion). Install it from https://aka.ms/powershell and run: pwsh -File scripts/powershell/test-rabbitnet.ps1"
    exit 0
}

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:failed = 0
$script:passed = 0
function Check([string]$Name, [scriptblock]$Body) {
    try { & $Body; $script:passed++; Write-Host "ok   $Name" }
    catch { $script:failed++; Write-Host "FAIL $Name :: $($_.Exception.Message)" }
}
function Assert([bool]$Condition, [string]$Message = 'assertion failed') { if (-not $Condition) { throw $Message } }

# ---- manifest and parse ----
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $here 'RabbitNet.psm1'), [ref]$tokens, [ref]$errors) | Out-Null
Check 'RabbitNet.psm1 parses without errors' { Assert ($errors.Count -eq 0) (($errors | ForEach-Object { $_.Message }) -join '; ') }
Check 'manifest is valid' { $m = Test-ModuleManifest -Path (Join-Path $here 'RabbitNet.psd1'); Assert ($m.ExportedFunctions.Count -eq 4) }

Remove-Module RabbitNet -ErrorAction SilentlyContinue
Import-Module (Join-Path $here 'RabbitNet.psd1') -Force
$mod = Get-Module RabbitNet
Check 'exports the four cmdlets' {
    foreach ($n in 'Test-RabbitConnection', 'Get-RabbitChainHead', 'Sync-RabbitChain', 'Test-RabbitChain') { Assert ($null -ne (Get-Command $n -Module RabbitNet)) $n }
}
Check 'no port, upload or token parameters' {
    foreach ($c in Get-Command -Module RabbitNet) {
        foreach ($bad in 'Port', 'Ports', 'Range', 'Body', 'InFile', 'Token', 'ToCloudShell', 'Upload', 'Credential') { Assert (-not $c.Parameters.ContainsKey($bad)) "$($c.Name) has -$bad" }
    }
}
Check 'Test-RabbitConnection and Sync-RabbitChain support -WhatIf and -Confirm' {
    foreach ($n in 'Test-RabbitConnection', 'Sync-RabbitChain') {
        $p = (Get-Command $n).Parameters
        Assert ($p.ContainsKey('WhatIf') -and $p.ContainsKey('Confirm')) $n
    }
    Assert ((Get-Command Test-RabbitConnection).Parameters.ContainsKey('NetworkTools'))
}

# ---- hashing against the TypeScript test vector ----
$vectorPath = Join-Path $here 'test-vector.json'
$vector = [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($vectorPath)).RootElement
$events = @($vector.EnumerateArray())
Check 'every event hash equals the one the TypeScript code produced' {
    foreach ($ev in $events) {
        $hash = & $mod { param($e) Get-RabbitEventHash (Get-RabbitEventFields -Event $e) } $ev
        $want = $ev.GetProperty('hash').GetString()
        Assert ($hash -ceq $want) "seq $($ev.GetProperty('seq').GetInt64()): got $hash want $want"
    }
}
Check 'Test-RabbitChain accepts the vector file' {
    $r = Test-RabbitChain -Path $vectorPath
    Assert ($r.Ok -and $r.Count -eq 4 -and $r.HeadSeq -eq 4) ($r | Out-String)
    Assert ($r.HeadHash -ceq $events[3].GetProperty('hash').GetString())
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("rabbitnet-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $text = [System.IO.File]::ReadAllText($vectorPath)
    Check 'a changed payload is refused (tampered)' {
        $f = Join-Path $tmp 'tampered.json'
        [System.IO.File]::WriteAllText($f, $text.Replace('"name": "Plain"', '"name": "Changed"'))
        $r = Test-RabbitChain -Path $f
        Assert (-not $r.Ok -and $r.FailedSeq -eq 1 -and $r.Reason -like '*tampered*') ($r | Out-String)
    }
    $rawEvents = @($events | ForEach-Object { $_.GetRawText() })
    Check 'a dropped event is refused (gap)' {
        $f = Join-Path $tmp 'gap.json'
        [System.IO.File]::WriteAllText($f, '[' + (($rawEvents[0], $rawEvents[2], $rawEvents[3]) -join ',') + ']')
        $r = Test-RabbitChain -Path $f
        Assert (-not $r.Ok -and $r.Reason -like 'gap*') ($r | Out-String)
    }
    Check 'a wrong prev_hash is refused' {
        $prev = $events[0].GetProperty('hash').GetString()
        $f = Join-Path $tmp 'prev.json'
        [System.IO.File]::WriteAllText($f, $text.Replace('"prev_hash": "' + $prev + '"', '"prev_hash": "' + ('f' * 64) + '"'))
        $r = Test-RabbitChain -Path $f
        Assert (-not $r.Ok -and $r.Reason -like 'prev_hash*') ($r | Out-String)
    }

    # ---- JavaScript number formatting ----
    Check 'numbers format like JSON.stringify' {
        $cases = [ordered]@{ '0.1' = 0.1; '1e-7' = 1e-7; '0.000001' = 0.000001; '1e+21' = 1e21; '1.5e+25' = 1.5e25; '123456789012345680000' = 123456789012345680000.0; '-3' = -3.0; '100' = 100.0; '12345.678' = 12345.678; '1.2345e-9' = 1.2345e-9 }
        foreach ($k in $cases.Keys) {
            $got = & $mod { param($v) ConvertTo-RabbitJsNumber $v } $cases[$k]
            Assert ($got -ceq $k) "expected $k got $got"
        }
    }

    # ---- Sync-RabbitChain against a fake network (no real requests) ----
    & $mod {
        param($vectorText)
        $script:VectorText = $vectorText
        $script:Calls = [System.Collections.Generic.List[string]]::new()
        $script:Mode = 'good'
        Set-Item -Path Function:\Invoke-RabbitGet -Value {
            param([string]$Url, [string]$Proxy, [int]$TimeoutSec = 20)
            $script:Calls.Add($Url)
            if ($Proxy) { $script:Calls.Add("PROXY=$Proxy") }
            $text = $script:VectorText
            if ($script:Mode -eq 'bad') { $text = $text.Replace('"synthetic": true', '"synthetic": false') }
            $all = @([System.Text.Json.JsonDocument]::Parse($text).RootElement.EnumerateArray())
            if ($Url -like '*/api/chain/head') {
                $last = $all[$all.Count - 1]
                return [pscustomobject]@{ StatusCode = 200; Ms = 1; Content = ('{"length":' + $last.GetProperty('seq').GetInt64() + ',"headHash":"' + $last.GetProperty('hash').GetString() + '","updatedAt":null}') }
            }
            $since = [int64]([regex]::Match($Url, 'since=(\d+)').Groups[1].Value)
            $page = @($all | Where-Object { $_.GetProperty('seq').GetInt64() -gt $since } | ForEach-Object { $_.GetRawText() })
            [pscustomobject]@{ StatusCode = 200; Ms = 1; Content = ('{"since":' + $since + ',"count":' + $page.Count + ',"events":[' + ($page -join ',') + ']}') }
        }
    } $text

    $ledger = Join-Path $tmp 'sub/ledger.jsonl'
    Check 'Sync-RabbitChain -WhatIf writes nothing' {
        Sync-RabbitChain -Path $ledger -WhatIf | Out-Null
        Assert (-not (Test-Path $ledger)) 'file was written'
    }
    Check 'Sync-RabbitChain pulls, verifies and writes the local file' {
        $r = Sync-RabbitChain -Path $ledger -Confirm:$false 6>$null
        Assert ($r.Added -eq 4 -and $r.HeadSeq -eq 4 -and $r.Status -eq 'up to date') ($r | Out-String)
        Assert ((Get-Content $ledger).Count -eq 4)
        Assert ((Test-RabbitChain -Path $ledger).Ok)
        Assert (Test-Path "$ledger.state.json")
    }
    Check 'the default is the normal connection: no proxy used' {
        $calls = & $mod { $script:Calls -join "`n" }
        Assert ($calls -notmatch 'PROXY=') $calls
    }
    Check 'a second run resumes and adds nothing' {
        $r = Sync-RabbitChain -Path $ledger -Confirm:$false 6>$null
        Assert ($r.Added -eq 0 -and $r.HeadSeq -eq 4) ($r | Out-String)
        $calls = & $mod { $script:Calls[$script:Calls.Count - 2] }
        Assert ($calls -like '*since=4*') $calls
    }
    Check 'a proxy is used only when asked for (-Proxy or RABBIT_PROXY)' {
        Sync-RabbitChain -Path $ledger -Proxy 'http://127.0.0.1:9' -Confirm:$false 6>$null | Out-Null
        Assert ((& $mod { $script:Calls -join "`n" }) -match 'PROXY=http://127\.0\.0\.1:9')
        $env:RABBIT_PROXY = 'http://user:pw@127.0.0.1:8'
        try { Assert ((& $mod { Resolve-RabbitProxy }) -like 'http://user:pw@127.0.0.1:8*'); Assert ((& $mod { Hide-RabbitCredentials 'http://user:pw@h:1/' }) -eq 'http://***@h:1/') }
        finally { Remove-Item Env:\RABBIT_PROXY }
        Assert ($null -eq (& $mod { Resolve-RabbitProxy }))
    }
    Check 'a broken chain from the server is refused and nothing is written' {
        & $mod { $script:Mode = 'bad' }
        $fresh = Join-Path $tmp 'fresh.jsonl'
        $threw = $false
        try { Sync-RabbitChain -Path $fresh -Confirm:$false 6>$null | Out-Null } catch { $threw = $_.Exception.Message -like 'Refusing a broken chain*' }
        & $mod { $script:Mode = 'good' }
        Assert $threw 'did not refuse'
        Assert (-not (Test-Path $fresh)) 'file written from a broken page'
    }
    Check 'a broken local file is refused' {
        $bad = Join-Path $tmp 'bad-local.jsonl'
        $lines = Get-Content $ledger
        $lines[1] = $lines[1].Replace('"id":"n-1"', '"id":"n-2"')
        Set-Content -Path $bad -Value $lines
        $threw = $false
        try { Sync-RabbitChain -Path $bad -Confirm:$false 6>$null | Out-Null } catch { $threw = $_.Exception.Message -like 'Refusing: the local file*' }
        Assert $threw 'did not refuse'
    }
    Check 'the CloudShell hint is printed and it is a public-URL read' {
        $out = (Sync-RabbitChain -Path $ledger -Confirm:$false 6>&1 | Out-String)
        Assert ($out -match 'curl -fsS "https://app\.rabbitsoftware\.io/api/chain/ledger\?since=0" \| head -c 60000')
        Assert ($out -match 'does not read the file on this PC')
        Assert ($out -match 'Nothing was uploaded')
    }
    Check 'every request was a read of /api/chain/ (GET only, https, rabbitsoftware.io)' {
        $calls = & $mod { $script:Calls | Where-Object { $_ -notlike 'PROXY=*' } }
        foreach ($c in $calls) { Assert ($c -match '^https://app\.rabbitsoftware\.io/api/chain/(head|ledger\?since=\d+)$') $c }
    }
    Check 'host names for -NetworkTools: names only, no IPs, ranges or ports' {
        foreach ($ok in 'example.org', 'app.rabbitsoftware.io') { Assert (& $mod { param($n) Test-RabbitHostName $n } $ok) $ok }
        foreach ($no in '10.0.0.0/24', '192.168.1.5', '*.example.org', 'example.org:22', 'localhost', '1.1.1.1-5', 'a b.org', '') { Assert (-not (& $mod { param($n) Test-RabbitHostName $n } $no)) "'$no'" }
    }
    Check 'Test-RabbitConnection -NetworkTools -WhatIf runs no diagnostics' {
        & $mod { Set-Item -Path Function:\Invoke-RabbitGet -Value { param($Url, $Proxy, $TimeoutSec) [pscustomobject]@{ StatusCode = 200; Ms = 1; Content = '{}' } } }
        $r = @(Test-RabbitConnection -NetworkTools -TargetHost 'example.org' -WhatIf)
        Assert (@($r | Where-Object { $_.PSObject.TypeNames -contains 'RabbitNet.Diagnostic' }).Count -eq 0) 'diagnostics ran under -WhatIf'
        $threw = $false
        try { Test-RabbitConnection -NetworkTools -TargetHost '10.0.0.0/24' -Confirm:$false | Out-Null } catch { $threw = $true }
        Assert $threw 'an address range was accepted'
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Live) {
    Remove-Module RabbitNet -ErrorAction SilentlyContinue
    Import-Module (Join-Path $here 'RabbitNet.psd1') -Force
    Check 'LIVE: Get-RabbitChainHead' { $h = Get-RabbitChainHead; Assert ($h.HeadHash -match '^[0-9a-f]{64}$') }
    Check 'LIVE: Test-RabbitConnection' { $r = @(Test-RabbitConnection 6>$null); Assert ($r.Count -ge 2) }
}

Write-Host ''
Write-Host "$script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
