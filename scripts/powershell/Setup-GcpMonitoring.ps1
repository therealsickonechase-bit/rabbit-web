# Creates (idempotently) in project rabbitsoftware-io: an email notification channel, uptime checks, a failure alert policy and a monthly budget. Prints no tokens.
$ErrorActionPreference = 'Stop'
$project = 'rabbitsoftware-io'; $projectNumber = '1087712653995'; $billing = '011093-A2ECF8-7E080E'
$email = (gcloud config list --format="value(core.account)").Trim()
$tok = (gcloud auth print-access-token).Trim()
$h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $project }
function Api($method, $url, $body) {
    $a = @{ Method = $method; Uri = $url; Headers = $h; ContentType = 'application/json' }
    if ($body) { $a.Body = ($body | ConvertTo-Json -Depth 20) }
    try { Invoke-RestMethod @a } catch { throw ("{0} {1}: {2}" -f $method, ($url -replace '\?.*', ''), (($_.ErrorDetails.Message -replace '\s+', ' ')).Substring(0, [Math]::Min(300, $_.ErrorDetails.Message.Length))) }
}
$mon = "https://monitoring.googleapis.com/v3/projects/$project"

# 1. Email channel
$channels = (Api GET "$mon/notificationChannels").notificationChannels
$ch = $channels | Where-Object { $_.type -eq 'email' -and $_.labels.email_address -eq $email } | Select-Object -First 1
if (-not $ch) { $ch = Api POST "$mon/notificationChannels" @{ type = 'email'; displayName = 'RabbitOS alerts (email)'; labels = @{ email_address = $email } } ; Write-Host 'created email channel' } else { Write-Host 'email channel exists' }

# 2. Uptime checks
$targets = @(
    @{ Name = 'RabbitOS app health';     Host = 'app.rabbitsoftware.io'; Path = '/api/health';     Match = '"status":"ok"' },
    @{ Name = 'RabbitOS ledger head';    Host = 'app.rabbitsoftware.io'; Path = '/api/chain/head'; Match = 'headHash' },
    @{ Name = 'rabbitsoftware.io site';  Host = 'rabbitsoftware.io';     Path = '/';               Match = 'RabbitSoftware' },
    @{ Name = 'Cloud Run mirror health'; Host = 'run.rabbitsoftware.io'; Path = '/api/health';     Match = '"status":"ok"' }
)
$existing = (Api GET "$mon/uptimeCheckConfigs").uptimeCheckConfigs
$ids = @{}
foreach ($t in $targets) {
    $found = $existing | Where-Object { $_.displayName -eq $t.Name } | Select-Object -First 1
    if (-not $found) {
        $found = Api POST "$mon/uptimeCheckConfigs" @{
            displayName = $t.Name; period = '300s'; timeout = '10s'
            monitoredResource = @{ type = 'uptime_url'; labels = @{ project_id = $project; host = $t.Host } }
            httpCheck = @{ path = $t.Path; port = 443; useSsl = $true; validateSsl = $true; requestMethod = 'GET' }
            contentMatchers = @(@{ content = $t.Match; matcher = 'CONTAINS_STRING' })
        }
        Write-Host "created uptime check: $($t.Name)"
    } else { Write-Host "uptime check exists: $($t.Name)" }
    $ids[$t.Name] = ($found.name -split '/')[-1]
}

# 3. One alert policy, one condition per check (fires when more than one location sees a failure)
$policyName = 'RabbitOS: a key URL is down'
$policies = (Api GET "$mon/alertPolicies").alertPolicies
if (-not ($policies | Where-Object { $_.displayName -eq $policyName })) {
    $conds = foreach ($t in $targets) {
        @{ displayName = "$($t.Name) failing"; conditionThreshold = @{
            filter = "metric.type=`"monitoring.googleapis.com/uptime_check/check_passed`" AND metric.label.check_id=`"$($ids[$t.Name])`" AND resource.type=`"uptime_url`""
            aggregations = @(@{ alignmentPeriod = '1200s'; perSeriesAligner = 'ALIGN_NEXT_OLDER'; crossSeriesReducer = 'REDUCE_COUNT_FALSE'; groupByFields = @('resource.label.*') })
            comparison = 'COMPARISON_GT'; thresholdValue = 1; duration = '60s'; trigger = @{ count = 1 } } }
    }
    [void](Api POST "$mon/alertPolicies" @{ displayName = $policyName; combiner = 'OR'; enabled = $true; conditions = @($conds); notificationChannels = @($ch.name)
        documentation = @{ content = 'One of the RabbitOS / rabbitsoftware.io uptime checks is failing. Check the Cloudflare and Cloud Run status, then the daily backup log in C:\Users\odaat\RabbitOS\logs.'; mimeType = 'text/markdown' } })
    Write-Host 'created alert policy'
} else { Write-Host 'alert policy exists' }

# 4. Monthly budget with email warnings (the billing admins and this account are notified by default)
$bud = (Api GET "https://billingbudgets.googleapis.com/v1/billingAccounts/$billing/budgets").budgets
if (-not ($bud | Where-Object { $_.displayName -eq 'RabbitOS monthly budget' })) {
    [void](Api POST "https://billingbudgets.googleapis.com/v1/billingAccounts/$billing/budgets" @{
        displayName = 'RabbitOS monthly budget'
        budgetFilter = @{ projects = @("projects/$projectNumber") }
        amount = @{ specifiedAmount = @{ currencyCode = 'USD'; units = '10' } }
        thresholdRules = @(@{ thresholdPercent = 0.5 }, @{ thresholdPercent = 0.9 }, @{ thresholdPercent = 1.0 })
    })
    Write-Host 'created budget ($10/month, alerts at 50/90/100 percent)'
} else { Write-Host 'budget exists' }
Write-Host 'done'
