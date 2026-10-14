#Requires -Version 7.0
# RabbitNet: connection checks and a LOCAL copy of the public RabbitOS chain ledger, for your own PC.
#
#   Test-RabbitConnection   DNS, TCP 443, TLS, HTTP status and latency for app.rabbitsoftware.io and /api/chain/head (and RABBIT_CLOUDSHELL_URL if set).
#                           -NetworkTools adds extra diagnostics (all DNS record types, a traceroute, IP configuration and MTU) after a confirmation.
#   Get-RabbitChainHead     GET /api/chain/head (public).
#   Sync-RabbitChain        PULLS GET /api/chain/ledger?since=N into a local .jsonl file on this PC, verifies the hash chain (the algorithm of
#                           src/lib/chain-ledger.ts ported to PowerShell) and refuses a broken chain. It resumes from a local state file.
#   Test-RabbitChain        Verifies a local .jsonl file (or a JSON array file) without any network.
#
# Defaults: the normal connection. No proxy unless -Proxy <url> or the RABBIT_PROXY environment variable is given.
# This module only ever sends GET requests with no body and no credentials. It uploads nothing: no files, no notes, no tokens.
# It has no port-scan mode: the only port it ever contacts is 443, on hosts you name or the RabbitOS and Cloudflare hosts.

Set-StrictMode -Version 3.0

$script:DefaultOrigin = 'https://app.rabbitsoftware.io'
$script:LedgerTables = @('collections', 'chat_threads', 'chat_messages', 'collection_items', 'notes', 'agent_tasks', 'self_daily', 'kg_edges', 'eeg_band_samples', 'maxwell_chain')
$script:LedgerOps = @('insert', 'update', 'delete')
$script:GenesisHash = '0' * 64
$script:CloudflareHosts = @('www.cloudflare.com')
$script:UserAgent = 'RabbitNet/1.0 (local PowerShell module; read-only)'

# ---------------------------------------------------------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------------------------------------------------------

function Resolve-RabbitProxy {
    # Default is NO proxy (the normal connection). A proxy is used only when asked for, by -Proxy or RABBIT_PROXY.
    param([string]$Proxy)
    $p = if ($Proxy) { $Proxy } elseif ($env:RABBIT_PROXY) { $env:RABBIT_PROXY } else { $null }
    if (-not $p) { return $null }
    $u = $null
    if (-not [uri]::TryCreate($p, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -notin @('http', 'https', 'socks5')) {
        throw "The proxy must be an http, https or socks5 URL, for example http://127.0.0.1:8080."
    }
    return $p
}

function Hide-RabbitCredentials {
    # Never print user names or passwords that may be part of a proxy URL.
    param([string]$Text)
    if (-not $Text) { return $Text }
    return ($Text -replace '(?<=://)[^/@\s]+@', '***@')
}

function Resolve-RabbitOrigin {
    param([string]$Origin)
    $u = $null
    if (-not [uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -ne 'https' -or $u.UserInfo -or $u.Query -or $u.Fragment -or $u.AbsolutePath -ne '/') {
        throw "The origin must be a plain https URL such as $script:DefaultOrigin (no user name, path or query)."
    }
    return $u.GetLeftPart([UriPartial]::Authority)
}

function Test-RabbitHostName {
    # A single DNS name. No IP addresses, wildcards, ranges, CIDR blocks, ports or paths: this is what keeps -NetworkTools from being a scanner.
    param([string]$Name)
    return ($Name -cmatch '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')
}

function Invoke-RabbitGet {
    # The one place that touches the network for data. GET only, no body, no credentials, no redirects followed.
    param([Parameter(Mandatory)][string]$Url, [string]$Proxy, [int]$TimeoutSec = 20)
    $req = @{
        Uri = $Url; Method = 'Get'; UseBasicParsing = $true; TimeoutSec = $TimeoutSec
        MaximumRedirection = 0; SkipHttpErrorCheck = $true; UserAgent = $script:UserAgent; ErrorAction = 'Stop'
    }
    if ($Proxy) { $req['Proxy'] = $Proxy }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest @req
    $sw.Stop()
    [pscustomobject]@{ StatusCode = [int]$r.StatusCode; Content = [string]$r.Content; Ms = [math]::Round($sw.Elapsed.TotalMilliseconds) }
}

# ---------------------------------------------------------------------------------------------------------------------------------------------
# Hash chain: a port of src/lib/chain-ledger.ts (canonical JSON, Merkle leaf hash, verifyChain)
# ---------------------------------------------------------------------------------------------------------------------------------------------

function ConvertTo-RabbitJsNumber {
    # Formats a number the way JavaScript's JSON.stringify does (shortest round-trip digits; exponent form below 1e-6 and from 1e21).
    param([double]$Value)
    if ([double]::IsNaN($Value) -or [double]::IsInfinity($Value)) { return 'null' }
    if ($Value -eq 0) { return '0' }
    $r = $Value.ToString('R', [cultureinfo]::InvariantCulture)
    $m = [regex]::Match($r, '^(-?)(\d+)(?:\.(\d+))?(?:[Ee]([+-]?\d+))?$')
    if (-not $m.Success) { throw "Unexpected number format: $r" }
    $sign = $m.Groups[1].Value
    $int = $m.Groups[2].Value
    $frac = $m.Groups[3].Value
    $exp = if ($m.Groups[4].Success) { [int]$m.Groups[4].Value } else { 0 }
    $digits = $int + $frac
    $n = $int.Length + $exp                       # value = 0.<digits> x 10^n
    $lead = $digits.Length - $digits.TrimStart('0').Length
    $digits = $digits.TrimStart('0')
    $n -= $lead
    $digits = $digits.TrimEnd('0')
    $k = $digits.Length
    if ($k -le $n -and $n -le 21) { return $sign + $digits + ('0' * ($n - $k)) }
    if (0 -lt $n -and $n -le 21) { return $sign + $digits.Substring(0, $n) + '.' + $digits.Substring($n) }
    if (-6 -lt $n -and $n -le 0) { return $sign + '0.' + ('0' * (-$n)) + $digits }
    $e = $n - 1
    $es = if ($e -lt 0) { '-' } else { '+' }
    $mant = if ($k -eq 1) { $digits } else { $digits.Substring(0, 1) + '.' + $digits.Substring(1) }
    return $sign + $mant + 'e' + $es + [math]::Abs($e)
}

function ConvertTo-RabbitJsString {
    # JSON.stringify for a string: escapes the quote, the backslash, control characters and lone surrogates; everything else is literal.
    param([string]$Value)
    $sb = [System.Text.StringBuilder]::new($Value.Length + 2)
    [void]$sb.Append('"')
    for ($i = 0; $i -lt $Value.Length; $i++) {
        $c = $Value[$i]
        $code = [int]$c
        $esc = switch ($code) { 34 { '\"' } 92 { '\\' } 8 { '\b' } 12 { '\f' } 10 { '\n' } 13 { '\r' } 9 { '\t' } default { $null } }
        if ($null -ne $esc) { [void]$sb.Append($esc); continue }
        if ($code -lt 32) { [void]$sb.Append('\u' + $code.ToString('x4')); continue }
        if ($code -ge 0xD800 -and $code -le 0xDBFF) {
            if ($i + 1 -lt $Value.Length -and [int]$Value[$i + 1] -ge 0xDC00 -and [int]$Value[$i + 1] -le 0xDFFF) { [void]$sb.Append($c).Append($Value[$i + 1]); $i++ }
            else { [void]$sb.Append('\u' + $code.ToString('x4')) }
            continue
        }
        if ($code -ge 0xDC00 -and $code -le 0xDFFF) { [void]$sb.Append('\u' + $code.ToString('x4')); continue }
        [void]$sb.Append($c)
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Get-RabbitJsonString {
    # JsonElement.GetString() refuses a lone surrogate (half of an emoji on its own), which JavaScript allows and the ledger hash covers.
    # Fall back to decoding the raw JSON text ourselves so such an event still verifies.
    param([System.Text.Json.JsonElement]$Element)
    try { return $Element.GetString() } catch { $null = $_ }
    $raw = $Element.GetRawText()
    $raw = $raw.Substring(1, $raw.Length - 2)
    $sb = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $raw.Length; $i++) {
        $c = $raw[$i]
        if ($c -ne [char]92) { [void]$sb.Append($c); continue }
        $i++
        switch ($raw[$i]) {
            'b' { [void]$sb.Append([char]8) }
            'f' { [void]$sb.Append([char]12) }
            'n' { [void]$sb.Append([char]10) }
            'r' { [void]$sb.Append([char]13) }
            't' { [void]$sb.Append([char]9) }
            'u' { [void]$sb.Append([char][Convert]::ToInt32($raw.Substring($i + 1, 4), 16)); $i += 4 }
            default { [void]$sb.Append($raw[$i]) }
        }
    }
    return $sb.ToString()
}

function Write-RabbitCanonical {
    # canonical() of chain-ledger.ts: JSON with object keys sorted by UTF-16 code units, no spaces.
    param([System.Text.Json.JsonElement]$Element, [System.Text.StringBuilder]$Builder)
    switch ($Element.ValueKind.ToString()) {
        'Object' {
            $props = [System.Collections.Generic.Dictionary[string, System.Text.Json.JsonElement]]::new([System.StringComparer]::Ordinal)
            foreach ($p in $Element.EnumerateObject()) { $props[$p.Name] = $p.Value }
            $keys = [string[]]@($props.Keys)
            [array]::Sort($keys, [System.StringComparer]::Ordinal)
            [void]$Builder.Append('{')
            $first = $true
            foreach ($k in $keys) {
                if (-not $first) { [void]$Builder.Append(',') }
                $first = $false
                [void]$Builder.Append((ConvertTo-RabbitJsString $k)).Append(':')
                Write-RabbitCanonical -Element $props[$k] -Builder $Builder
            }
            [void]$Builder.Append('}')
        }
        'Array' {
            [void]$Builder.Append('[')
            $first = $true
            foreach ($item in $Element.EnumerateArray()) {
                if (-not $first) { [void]$Builder.Append(',') }
                $first = $false
                Write-RabbitCanonical -Element $item -Builder $Builder
            }
            [void]$Builder.Append(']')
        }
        'String' { [void]$Builder.Append((ConvertTo-RabbitJsString (Get-RabbitJsonString $Element))) }
        'Number' { [void]$Builder.Append((ConvertTo-RabbitJsNumber $Element.GetDouble())) }
        'True' { [void]$Builder.Append('true') }
        'False' { [void]$Builder.Append('false') }
        default { [void]$Builder.Append('null') }
    }
}

function Get-RabbitLeafHash {
    # leafHash() of src/lib/merkle.ts: SHA-256 over 0x00 followed by the UTF-8 bytes of the text, lower-case hex.
    param([string]$Text)
    $body = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $buf = [byte[]]::new($body.Length + 1)
    $buf[0] = 0
    [array]::Copy($body, 0, $buf, 1, $body.Length)
    return ([System.Security.Cryptography.SHA256]::HashData($buf) | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Get-RabbitEventFields {
    # Returns the fields of one ledger event, or $null when it is not shaped like one.
    param([System.Text.Json.JsonElement]$Event)
    if ($Event.ValueKind.ToString() -ne 'Object') { return $null }
    $f = [System.Collections.Generic.Dictionary[string, System.Text.Json.JsonElement]]::new([System.StringComparer]::Ordinal)
    foreach ($p in $Event.EnumerateObject()) { $f[$p.Name] = $p.Value }
    foreach ($name in 'seq', 'table', 'op', 'row_id', 'payload', 'prev_hash', 'hash') { if (-not $f.ContainsKey($name)) { return $null } }
    if ($f['seq'].ValueKind.ToString() -ne 'Number' -or $f['payload'].ValueKind.ToString() -ne 'Object') { return $null }
    foreach ($name in 'table', 'op', 'row_id', 'prev_hash', 'hash') { if ($f[$name].ValueKind.ToString() -ne 'String') { return $null } }
    $seq = [int64]0
    if (-not $f['seq'].TryGetInt64([ref]$seq)) { return $null }
    [pscustomobject]@{
        Seq = $seq; Table = (Get-RabbitJsonString $f['table']); Op = (Get-RabbitJsonString $f['op']); RowId = (Get-RabbitJsonString $f['row_id'])
        PrevHash = (Get-RabbitJsonString $f['prev_hash']); Hash = (Get-RabbitJsonString $f['hash']); Fields = $f
    }
}

function Get-RabbitEventHash {
    # eventHash() of chain-ledger.ts: the leaf hash of canonical({seq, table, op, row_id, payload, prev_hash}).
    param($Parsed)
    $sb = [System.Text.StringBuilder]::new()
    # Keys in sorted order: op, payload, prev_hash, row_id, seq, table.
    [void]$sb.Append('{"op":').Append((ConvertTo-RabbitJsString $Parsed.Op))
    [void]$sb.Append(',"payload":')
    Write-RabbitCanonical -Element $Parsed.Fields['payload'] -Builder $sb
    [void]$sb.Append(',"prev_hash":').Append((ConvertTo-RabbitJsString $Parsed.PrevHash))
    [void]$sb.Append(',"row_id":').Append((ConvertTo-RabbitJsString $Parsed.RowId))
    [void]$sb.Append(',"seq":').Append($Parsed.Seq.ToString([cultureinfo]::InvariantCulture))
    [void]$sb.Append(',"table":').Append((ConvertTo-RabbitJsString $Parsed.Table)).Append('}')
    return Get-RabbitLeafHash $sb.ToString()
}

function Step-RabbitChain {
    # verifyChain() for ONE event that must follow the head. Returns @{ Ok; Seq; Hash; Reason }.
    param([System.Text.Json.JsonElement]$Event, [int64]$HeadSeq, [string]$HeadHash)
    $e = Get-RabbitEventFields -Event $Event
    if ($null -eq $e) { return @{ Ok = $false; Seq = $HeadSeq + 1; Hash = $HeadHash; Reason = 'not shaped like a ledger event' } }
    if ($e.Seq -ne $HeadSeq + 1) { return @{ Ok = $false; Seq = $e.Seq; Hash = $HeadHash; Reason = "gap or duplicate: expected seq $($HeadSeq + 1)" } }
    if ($e.PrevHash -cne $HeadHash) { return @{ Ok = $false; Seq = $e.Seq; Hash = $HeadHash; Reason = 'prev_hash does not match the previous event' } }
    if ($e.Table -cnotin $script:LedgerTables -or $e.Op -cnotin $script:LedgerOps) { return @{ Ok = $false; Seq = $e.Seq; Hash = $HeadHash; Reason = 'unknown table or op' } }
    if ((Get-RabbitEventHash $e) -cne $e.Hash) { return @{ Ok = $false; Seq = $e.Seq; Hash = $HeadHash; Reason = 'hash does not match contents (tampered)' } }
    return @{ Ok = $true; Seq = $e.Seq; Hash = $e.Hash; Reason = '' }
}

function Test-RabbitEvents {
    # verifyChain() for a list of events (sorted by seq first). Returns an object with Ok, Count, HeadSeq, HeadHash, FailedSeq and Reason.
    param(
        [Parameter(Mandatory)][object[]]$Events,
        [int64]$FromSeq = 0,
        [string]$FromHash = ('0' * 64)
    )
    $withSeq = foreach ($ev in $Events) {
        $p = Get-RabbitEventFields -Event $ev
        [pscustomobject]@{ Seq = $(if ($p) { $p.Seq } else { [int64]::MaxValue }); Event = $ev }
    }
    $sorted = @($withSeq | Sort-Object -Property Seq)
    $seq = $FromSeq; $hash = $FromHash; $count = 0
    foreach ($item in $sorted) {
        $r = Step-RabbitChain -Event $item.Event -HeadSeq $seq -HeadHash $hash
        if (-not $r.Ok) { return [pscustomobject]@{ Ok = $false; Count = $count; HeadSeq = $seq; HeadHash = $hash; FailedSeq = $r.Seq; Reason = $r.Reason } }
        $seq = $r.Seq; $hash = $r.Hash; $count++
    }
    [pscustomobject]@{ Ok = $true; Count = $count; HeadSeq = $seq; HeadHash = $hash; FailedSeq = $null; Reason = '' }
}

function ConvertTo-RabbitCompactJson {
    # The event's own JSON text with the white space outside strings removed, so it fits on one line. Strings are copied untouched
    # (re-serialising could not represent a lone surrogate).
    param([System.Text.Json.JsonElement]$Element)
    $raw = $Element.GetRawText()
    $sb = [System.Text.StringBuilder]::new($raw.Length)
    $inString = $false; $escaped = $false
    foreach ($c in $raw.ToCharArray()) {
        if ($inString) {
            [void]$sb.Append($c)
            if ($escaped) { $escaped = $false } elseif ($c -eq [char]92) { $escaped = $true } elseif ($c -eq [char]34) { $inString = $false }
        } elseif ($c -eq [char]34) { $inString = $true; [void]$sb.Append($c) }
        elseif (-not [char]::IsWhiteSpace($c)) { [void]$sb.Append($c) }
    }
    return $sb.ToString()
}

function Read-RabbitJsonLines {
    param([string]$Path)
    foreach ($line in [System.IO.File]::ReadLines($Path)) {
        if ($line.Trim().Length -eq 0) { continue }
        [System.Text.Json.JsonDocument]::Parse($line).RootElement
    }
}

function Test-RabbitChain {
    <#
    .SYNOPSIS
        Verifies the hash chain of a local ledger file. No network.
    .DESCRIPTION
        -Path is a .jsonl file (one event per line, as Sync-RabbitChain writes it) or a .json file holding an array of events.
        Returns an object; Ok is $false when the chain is broken.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory, Position = 0)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "No such file: $Path" }
    $events = if ($Path -like '*.json') {
        $doc = [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($Path))
        @($doc.RootElement.EnumerateArray())
    } else {
        @(Read-RabbitJsonLines -Path $Path)
    }
    if ($events.Count -eq 0) { return [pscustomobject]@{ Ok = $true; Count = 0; HeadSeq = 0; HeadHash = ('0' * 64); FailedSeq = $null; Reason = '' } }
    Test-RabbitEvents -Events $events
}

# ---------------------------------------------------------------------------------------------------------------------------------------------
# Public cmdlets
# ---------------------------------------------------------------------------------------------------------------------------------------------

function Get-RabbitChainHead {
    <#
    .SYNOPSIS
        Reads the public chain head (GET /api/chain/head).
    .DESCRIPTION
        Default connection is your normal one. A proxy is used only with -Proxy or the RABBIT_PROXY environment variable.
    .EXAMPLE
        Get-RabbitChainHead
    #>
    [CmdletBinding()]
    param([string]$Origin = $script:DefaultOrigin, [string]$Proxy)
    $o = Resolve-RabbitOrigin $Origin
    $px = Resolve-RabbitProxy $Proxy
    $r = Invoke-RabbitGet -Url "$o/api/chain/head" -Proxy $px
    if ($r.StatusCode -ne 200) { throw "The head request failed with HTTP $($r.StatusCode)." }
    $root = [System.Text.Json.JsonDocument]::Parse($r.Content).RootElement
    $f = @{}
    foreach ($p in $root.EnumerateObject()) { $f[$p.Name] = $p.Value }
    if (-not $f.ContainsKey('length') -or -not $f.ContainsKey('headHash')) { throw 'The head answer is missing length or headHash.' }
    [pscustomobject]@{
        Length = $f['length'].GetInt64(); HeadHash = $f['headHash'].GetString()
        UpdatedAt = $(if ($f.ContainsKey('updatedAt') -and $f['updatedAt'].ValueKind.ToString() -eq 'String') { $f['updatedAt'].GetString() } else { $null })
        Origin = $o
    }
}

function Get-RabbitTarget {
    param([string]$Origin)
    $o = [uri]$Origin
    $t = @(
        [pscustomobject]@{ Name = $o.Host; Url = "$Origin/"; Host = $o.Host }
        [pscustomobject]@{ Name = "$($o.Host)/api/chain/head"; Url = "$Origin/api/chain/head"; Host = $o.Host }
    )
    if ($env:RABBIT_CLOUDSHELL_URL) {
        $cs = $null
        if ([uri]::TryCreate($env:RABBIT_CLOUDSHELL_URL, [UriKind]::Absolute, [ref]$cs) -and $cs.Scheme -eq 'https' -and -not $cs.UserInfo) {
            $t += [pscustomobject]@{ Name = "$($cs.Host) (CloudShell)"; Url = $cs.GetLeftPart([UriPartial]::Authority) + '/'; Host = $cs.Host }
        } else {
            Write-Warning 'RABBIT_CLOUDSHELL_URL is not a plain https URL; it was skipped.'
        }
    }
    $t
}

function Resolve-RabbitDnsQuick {
    param([string]$HostName)
    try {
        if (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue) {
            $a = @(Resolve-DnsName -Name $HostName -Type A_AAAA -DnsOnly -ErrorAction Stop | Where-Object { $_.PSObject.Properties['IPAddress'] } | ForEach-Object { $_.IPAddress })
        } else {
            $a = @([System.Net.Dns]::GetHostAddresses($HostName) | ForEach-Object { $_.IPAddressToString })
        }
        if ($a.Count -eq 0) { return 'no address' }
        return ($a | Select-Object -First 3) -join ','
    } catch { return "FAIL: $($_.Exception.Message)" }
}

function Test-RabbitTcp443 {
    # One TCP connection to port 443 of a named host. This is the only port the module ever contacts.
    param([string]$HostName)
    try {
        if ($IsWindows -and (Get-Command Test-NetConnection -ErrorAction SilentlyContinue)) {
            $ok = Test-NetConnection -ComputerName $HostName -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
            return $(if ($ok) { 'open' } else { 'FAIL' })
        }
        $c = [System.Net.Sockets.TcpClient]::new()
        try {
            $task = $c.ConnectAsync($HostName, 443)
            if ($task.Wait(5000) -and $c.Connected) { return 'open' } else { return 'FAIL' }
        } finally { $c.Dispose() }
    } catch { return 'FAIL' }
}

function Test-RabbitTls {
    # One normal TLS handshake with the default certificate checks.
    param([string]$HostName)
    $c = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $c.ConnectAsync($HostName, 443)
        if (-not $task.Wait(5000) -or -not $c.Connected) { return 'FAIL (no TCP)' }
        $ssl = [System.Net.Security.SslStream]::new($c.GetStream(), $false)
        try {
            $ssl.AuthenticateAsClient($HostName)
            $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate)
            return "$($ssl.SslProtocol) (cert until $($cert.NotAfter.ToString('yyyy-MM-dd')))"
        } finally { $ssl.Dispose() }
    } catch { return "FAIL: $($_.Exception.Message)" } finally { $c.Dispose() }
}

function Test-RabbitConnection {
    <#
    .SYNOPSIS
        Checks the connection to RabbitOS: DNS, TCP 443, TLS, HTTP status and latency.
    .DESCRIPTION
        Targets: app.rabbitsoftware.io, its /api/chain/head, and the host in RABBIT_CLOUDSHELL_URL if that variable is set.
        Default connection is your normal one. A proxy is used only with -Proxy or RABBIT_PROXY; then the direct TCP and TLS checks are skipped
        because your traffic does not go that way.
        -NetworkTools adds extra diagnostics (all DNS record types, a traceroute, IP configuration and MTU) and asks for confirmation first
        (use -Confirm:$false to skip the question, -WhatIf to see what it would do). They run only for hosts you name with -TargetHost, or,
        when you name none, for the RabbitOS and Cloudflare hosts. There is no port-scan mode: only port 443 is ever contacted.
    .EXAMPLE
        Test-RabbitConnection
    .EXAMPLE
        Test-RabbitConnection -NetworkTools -TargetHost example.org
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
    param(
        [string]$Origin = $script:DefaultOrigin,
        [string]$Proxy,
        [switch]$NetworkTools,
        [ValidateCount(1, 5)][string[]]$TargetHost
    )
    $o = Resolve-RabbitOrigin $Origin
    $px = Resolve-RabbitProxy $Proxy
    Write-Information ("Connection: " + $(if ($px) { "via proxy $(Hide-RabbitCredentials $px)" } else { 'normal (no proxy set by RabbitNet; PowerShell uses your system settings)' })) -InformationAction Continue

    $targets = @(Get-RabbitTarget -Origin $o)
    $cache = @{}
    foreach ($t in $targets) {
        if (-not $cache.ContainsKey($t.Host)) {
            $cache[$t.Host] = [pscustomobject]@{
                Dns = Resolve-RabbitDnsQuick $t.Host
                Tcp = $(if ($px) { 'skipped (proxy)' } else { Test-RabbitTcp443 $t.Host })
                Tls = $(if ($px) { 'skipped (proxy)' } else { Test-RabbitTls $t.Host })
            }
        }
        $c = $cache[$t.Host]
        $status = 'FAIL'; $ms = $null; $note = ''
        try {
            $r = Invoke-RabbitGet -Url $t.Url -Proxy $px -TimeoutSec 15
            $status = $r.StatusCode; $ms = $r.Ms
        } catch { $note = $_.Exception.Message }
        [pscustomobject]@{ Target = $t.Name; Dns = $c.Dns; Tcp443 = $c.Tcp; Tls = $c.Tls; Http = $status; LatencyMs = $ms; Note = $note }
    }

    if (-not $NetworkTools) { return }

    # --- extra diagnostics: opt-in, named hosts only ---
    $hosts = if ($TargetHost) { @($TargetHost | ForEach-Object { $_.Trim().ToLowerInvariant() }) }
             else { @((@($targets | ForEach-Object { $_.Host }) + $script:CloudflareHosts) | Select-Object -Unique) }
    foreach ($h in $hosts) { if (-not (Test-RabbitHostName $h)) { throw "'$h' is not a plain host name. IP addresses, wildcards, ranges and ports are not accepted." } }
    if ($PSCmdlet.ShouldProcess(($hosts -join ', '), 'Run extra network diagnostics (DNS record lookups, one traceroute, local IP configuration and MTU)')) {
        $hasDns = [bool](Get-Command Resolve-DnsName -ErrorAction SilentlyContinue)
        foreach ($h in $hosts) {
            if ($hasDns) {
                foreach ($type in 'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA') {
                    $summary = try {
                        $recs = @(Resolve-DnsName -Name $h -Type $type -DnsOnly -ErrorAction Stop | Where-Object { $_.Type -eq $type })
                        if ($recs.Count) { ($recs | ForEach-Object { if ($_.PSObject.Properties['IPAddress']) { $_.IPAddress } elseif ($_.PSObject.Properties['NameHost']) { $_.NameHost } elseif ($_.PSObject.Properties['NameExchange']) { $_.NameExchange } elseif ($_.PSObject.Properties['Strings']) { $_.Strings -join ' ' } else { $_.Name } } | Select-Object -First 4) -join '; ' } else { '-' }
                    } catch { '-' }
                    [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = $h; Check = "DNS $type"; Result = $summary }
                }
            } else {
                [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = $h; Check = 'DNS records'; Result = 'Resolve-DnsName is not available on this system' }
            }
            if ($IsWindows -and (Get-Command Test-NetConnection -ErrorAction SilentlyContinue)) {
                $tr = try { Test-NetConnection -ComputerName $h -TraceRoute -Hops 15 -WarningAction SilentlyContinue } catch { $null }
                $hops = if ($tr -and $tr.PSObject.Properties['TraceRoute'] -and $tr.TraceRoute) { ($tr.TraceRoute | ForEach-Object { if ($_ -eq '0.0.0.0') { '*' } else { $_ } }) -join ' > ' } else { 'no answer' }
                [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = $h; Check = 'Traceroute (15 hops max)'; Result = $hops }
            } else {
                [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = $h; Check = 'Traceroute'; Result = 'only available on Windows' }
            }
        }
        if ($IsWindows -and (Get-Command Get-NetIPInterface -ErrorAction SilentlyContinue)) {
            foreach ($i in Get-NetIPInterface -ConnectionState Connected -ErrorAction SilentlyContinue) {
                [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = 'this PC'; Check = "IP interface $($i.InterfaceAlias) ($($i.AddressFamily))"; Result = "MTU $($i.NlMtu)" }
            }
            foreach ($cfg in Get-NetIPConfiguration -ErrorAction SilentlyContinue) {
                $addr = @($cfg.IPv4Address | ForEach-Object { $_.IPAddress }) -join ','
                $gw = @($cfg.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ','
                $dns = @($cfg.DnsServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) -join ','
                [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = 'this PC'; Check = "IP config $($cfg.InterfaceAlias)"; Result = "address $addr gateway $gw dns $dns" }
            }
        } else {
            [pscustomobject]@{ PSTypeName = 'RabbitNet.Diagnostic'; Host = 'this PC'; Check = 'IP config and MTU'; Result = 'only available on Windows' }
        }
    }
}

function Sync-RabbitChain {
    <#
    .SYNOPSIS
        Pulls the PUBLIC chain ledger into a local file on this PC and verifies the hash chain. Uploads nothing.
    .DESCRIPTION
        Reads GET /api/chain/ledger?since=N page by page, verifies each page against the previous head (the algorithm of src/lib/chain-ledger.ts),
        and only then appends it to the local .jsonl file. A broken chain is refused: nothing from the bad page is written.
        Progress is kept in <Path>.state.json, so the next run continues where this one stopped.
        Nothing leaves this PC: no files, no notes, no tokens. This command sends only GET requests with no body.
        To get the ledger "to" the CloudShell, the CloudShell reads the same PUBLIC URL itself (the command is printed at the end);
        it does not read the file on your PC.
    .EXAMPLE
        Sync-RabbitChain
    .EXAMPLE
        Sync-RabbitChain -Path D:\rabbit\ledger.jsonl -WhatIf
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Low')]
    param(
        [string]$Origin = $script:DefaultOrigin,
        [string]$Path = (Join-Path $HOME 'RabbitOS/chain_ledger_local.jsonl'),
        [string]$Proxy,
        [ValidateRange(1, 100000)][int]$MaxPages = 10000
    )
    $o = Resolve-RabbitOrigin $Origin
    $px = Resolve-RabbitProxy $Proxy
    $statePath = "$Path.state.json"

    # 1. Where does the local copy stand? Trust the state file only if it matches the last line of the file; otherwise verify the whole file.
    $headSeq = [int64]0; $headHash = $script:GenesisHash
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $lastLine = Get-Content -LiteralPath $Path -Tail 1 -ErrorAction Stop
        if ($lastLine -and $lastLine.Trim()) {
            $lastParsed = Get-RabbitEventFields -Event ([System.Text.Json.JsonDocument]::Parse($lastLine).RootElement)
            $stateOk = $false
            if ($lastParsed -and (Test-Path -LiteralPath $statePath -PathType Leaf)) {
                try {
                    $st = [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($statePath)).RootElement
                    $stateOk = ($st.GetProperty('seq').GetInt64() -eq $lastParsed.Seq) -and ($st.GetProperty('hash').GetString() -ceq $lastParsed.Hash)
                } catch { $stateOk = $false }
            }
            if ($stateOk) {
                $headSeq = $lastParsed.Seq; $headHash = $lastParsed.Hash
            } else {
                Write-Information 'Checking the whole local file (no matching state file)...' -InformationAction Continue
                foreach ($ev in Read-RabbitJsonLines -Path $Path) {
                    $r = Step-RabbitChain -Event $ev -HeadSeq $headSeq -HeadHash $headHash
                    if (-not $r.Ok) { throw "Refusing: the local file $Path is broken at seq $($r.Seq): $($r.Reason). Move it away and run again." }
                    $headSeq = $r.Seq; $headHash = $r.Hash
                }
            }
        }
    }

    # 2. Pull, verify, append.
    $added = 0
    for ($page = 0; $page -lt $MaxPages; $page++) {
        $resp = Invoke-RabbitGet -Url "$o/api/chain/ledger?since=$headSeq" -Proxy $px
        if ($resp.StatusCode -ne 200) { throw "The ledger request failed with HTTP $($resp.StatusCode)." }
        $root = [System.Text.Json.JsonDocument]::Parse($resp.Content).RootElement
        $evs = $null
        foreach ($p in $root.EnumerateObject()) { if ($p.Name -ceq 'events') { $evs = $p.Value } }
        if ($null -eq $evs -or $evs.ValueKind.ToString() -ne 'Array') { throw 'The ledger answer has no events list.' }
        $batch = @($evs.EnumerateArray())
        if ($batch.Count -eq 0) { break }
        $v = Test-RabbitEvents -Events $batch -FromSeq $headSeq -FromHash $headHash
        if (-not $v.Ok) { throw "Refusing a broken chain at seq $($v.FailedSeq): $($v.Reason). Nothing from this page was written." }
        $written = $false
        if ($PSCmdlet.ShouldProcess($Path, "Append $($v.Count) verified events (seq $($headSeq + 1) to $($v.HeadSeq))")) {
            $dir = Split-Path -Parent $Path
            if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $sortedLines = @($batch | ForEach-Object { [pscustomobject]@{ Seq = (Get-RabbitEventFields -Event $_).Seq; Json = (ConvertTo-RabbitCompactJson $_) } } | Sort-Object Seq | ForEach-Object { $_.Json })
            $utf8 = [System.Text.UTF8Encoding]::new($false)
            [System.IO.File]::AppendAllText($Path, (($sortedLines -join "`n") + "`n"), $utf8)
            $state = '{"seq":' + $v.HeadSeq + ',"hash":"' + $v.HeadHash + '","updated":"' + [datetime]::UtcNow.ToString('o') + '"}'
            [System.IO.File]::WriteAllText($statePath, $state, $utf8)
            $written = $true
        }
        $headSeq = $v.HeadSeq; $headHash = $v.HeadHash; $added += $v.Count
        # With -WhatIf nothing was written, so stop after showing what the first page would do.
        if (-not $written -or $batch.Count -lt 1000) { break }
    }

    # 3. Compare with the public head: the same length must mean the same hash.
    $remote = Get-RabbitChainHead -Origin $o -Proxy $px
    if ($remote.Length -eq $headSeq -and $remote.HeadHash -cne $headHash) { throw "The public head at length $headSeq has a different hash than the verified local chain. Do not trust either copy until this is explained." }
    $behind = [int64]($remote.Length - $headSeq)

    [pscustomobject]@{
        Added = $added; HeadSeq = $headSeq; HeadHash = $headHash; Path = $Path; PublicLength = $remote.Length
        Status = $(if ($behind -le 0) { 'up to date' } else { "$behind newer events on the site; run again" })
    }
    Write-Host ''
    Write-Host 'Nothing was uploaded: this only read the public ledger.'
    Write-Host 'The CloudShell does not read the file on this PC. If you need the ledger there, run this in the CloudShell; it reads the same public URL itself:'
    Write-Host ('  curl -fsS "' + $o + '/api/chain/ledger?since=0" | head -c 60000')
}

Export-ModuleMember -Function Test-RabbitConnection, Get-RabbitChainHead, Sync-RabbitChain, Test-RabbitChain
