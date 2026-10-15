<#
.SYNOPSIS
    Logging, analytics, monitoring and a dashboard for the RabbitOS services on Google Cloud (project rabbitsoftware-io, us-west2). Idempotent. -WhatIf prints the plan.
.DESCRIPTION
    1. Log-based metrics (counters):
         shell_sessions_started   a visitor opened a terminal on the Cloud Run shell
         shell_errors / hub_errors   errors in the visitor shell or the hub MCP
         egress_denied            a visitor's request the allowlist proxy refused (TCP_DENIED in the Squid log)
    2. Analytics: BigQuery dataset rabbit_logs (90-day expiry) fed by the log sink rabbit-analytics. Only the services' own structured events and the Squid log go in,
       never request logs, so no visitor IP address is stored. See docs\gcp-observability.md for ready-made queries.
    3. Alerts (email, same channel as the uptime checks), one policy with five conditions: shell errors, hub errors, a spike of refused egress, Cloud Run 5xx,
       and the proxy VM stopping.
    4. Dashboard "RabbitOS platform": uptime, requests, latency, running instances, sessions, refused egress, errors and proxy CPU.
    Nothing here changes a running service.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Region = 'us-west2',
    [string]$Zone = 'us-west2-a',
    [string]$Dataset = 'rabbit_logs'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }
$tok = (gcloud auth print-access-token).Trim()
$h = @{ Authorization = "Bearer $tok"; 'x-goog-user-project' = $Project }
function Api($method, $url, $body) {
    $a = @{ Method = $method; Uri = $url; Headers = $h; ContentType = 'application/json' }
    if ($body) { $a.Body = ($body | ConvertTo-Json -Depth 30) }
    try { Invoke-RestMethod @a } catch { throw ("{0} {1}: {2}" -f $method, ($url -replace '\?.*', ''), (($_.ErrorDetails.Message -replace '\s+', ' ')).Substring(0, [Math]::Min(300, $_.ErrorDetails.Message.Length))) }
}
$mon = "https://monitoring.googleapis.com/v3/projects/$Project"
$services = 'rabbitos-hub-mcp', 'rabbit-visitor-shell', 'rabbit-site-standby'

# ---------------------------------------------------------------- 1. log-based metrics
Step 'Log-based metrics'
$run = 'resource.type="cloud_run_revision"'
$metrics = [ordered]@{
    shell_sessions_started = @{ d = 'Visitor terminals started on the Cloud Run shell'; f = "$run AND resource.labels.service_name=`"rabbit-visitor-shell`" AND jsonPayload.event=`"started`"" }
    shell_errors           = @{ d = 'Errors in the Cloud Run visitor shell'; f = "$run AND resource.labels.service_name=`"rabbit-visitor-shell`" AND (severity>=ERROR OR jsonPayload.event=(`"spawn_error`" OR `"fatal`"))" }
    hub_errors             = @{ d = 'Errors in the hub MCP'; f = "$run AND resource.labels.service_name=`"rabbitos-hub-mcp`" AND (severity>=ERROR OR jsonPayload.event=`"error`")" }
    egress_denied          = @{ d = 'Requests the egress allowlist proxy refused'; f = "resource.type=`"gce_instance`" AND logName=`"projects/$Project/logs/squid_access`" AND textPayload:`"TCP_DENIED`"" }
}
foreach ($name in $metrics.Keys) {
    Invoke-IfLive "create log-based metric $name" {
        if (Exists logging metrics describe $name --project $Project) { Write-Host "metric exists: $name" }
        else { Invoke-Gcloud logging metrics create $name --project $Project --description $metrics[$name].d --log-filter $metrics[$name].f; Write-Host "created metric: $name" }
    }
}

# ---------------------------------------------------------------- 2. analytics in BigQuery
Step "Analytics: BigQuery dataset $Dataset and the log sink"
$sinkFilter = "(resource.type=`"cloud_run_revision`" AND resource.labels.service_name=(`"rabbit-visitor-shell`" OR `"rabbitos-hub-mcp`") AND jsonPayload.event:*) OR (resource.type=`"gce_instance`" AND logName=`"projects/$Project/logs/squid_access`")"
Invoke-IfLive "create dataset $Dataset ($Region, 90-day expiry) and sink rabbit-analytics" {
    $null = & bq --project_id=$Project show --format=none "${Project}:$Dataset" 2>&1
    if ($LASTEXITCODE -ne 0) {
        & bq --project_id=$Project --location=$Region mk --dataset --description 'RabbitOS service events and refused-egress log (no IP addresses)' --default_table_expiration 7776000 --default_partition_expiration 7776000 "${Project}:$Dataset"
        if ($LASTEXITCODE -ne 0) { throw 'could not create the BigQuery dataset' }
        Write-Host "created dataset: $Dataset"
    } else { Write-Host "dataset exists: $Dataset" }
    if (-not (Exists logging sinks describe rabbit-analytics --project $Project)) {
        Invoke-Gcloud logging sinks create rabbit-analytics "bigquery.googleapis.com/projects/$Project/datasets/$Dataset" --project $Project --log-filter $sinkFilter --use-partitioned-tables
        Write-Host 'created sink: rabbit-analytics'
    } else { Write-Host 'sink exists: rabbit-analytics' }
    # The sink writes with its own identity: give it write access to this one dataset only.
    $writer = (& gcloud logging sinks describe rabbit-analytics --project $Project --format 'value(writerIdentity)').Trim() -replace '^serviceAccount:', ''
    $ds = & bq --project_id=$Project show --format=prettyjson "${Project}:$Dataset" | ConvertFrom-Json
    if (-not ($ds.access | Where-Object { $_.userByEmail -eq $writer })) {
        $ds.access += [pscustomobject]@{ role = 'WRITER'; userByEmail = $writer }
        $file = Join-Path ([IO.Path]::GetTempPath()) ('ds-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
        try { $ds | ConvertTo-Json -Depth 10 | Set-Content $file -Encoding ascii; & bq --project_id=$Project update --source $file "${Project}:$Dataset" | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'could not grant the sink write access' } } finally { Remove-Item $file -Force -ErrorAction SilentlyContinue }
        Write-Host 'granted the sink write access to the dataset'
    } else { Write-Host 'sink already has write access' }
}

# ---------------------------------------------------------------- 3. alerts
Step 'Alert policy'
$channels = (Api GET "$mon/notificationChannels").notificationChannels
$channel = $channels | Where-Object { $_.type -eq 'email' } | Select-Object -First 1
if (-not $channel) { throw 'No email notification channel found. Run Setup-GcpMonitoring.ps1 first.' }
$proxyId = if ($preview) { '0' } else { (& gcloud compute instances describe rabbit-egress-proxy --project $Project --zone $Zone --format 'value(id)').Trim() }
function Threshold($name, $filter, $aligner, $period, $reducer, $threshold) {
    $agg = @{ alignmentPeriod = $period; perSeriesAligner = $aligner }
    if ($reducer) { $agg.crossSeriesReducer = $reducer }
    @{ displayName = $name; conditionThreshold = @{ filter = $filter; aggregations = @($agg); comparison = 'COMPARISON_GT'; thresholdValue = $threshold; duration = '0s'; trigger = @{ count = 1 } } }
}
$policyName = 'RabbitOS: GCP errors and abuse signals'
$conds = @(
    (Threshold 'Visitor shell errors' 'metric.type="logging.googleapis.com/user/shell_errors" AND resource.type="cloud_run_revision"' 'ALIGN_SUM' '300s' $null 0),
    (Threshold 'Hub errors' 'metric.type="logging.googleapis.com/user/hub_errors" AND resource.type="cloud_run_revision"' 'ALIGN_SUM' '300s' $null 0),
    (Threshold 'Spike of refused egress (more than 200 in 10 minutes)' 'metric.type="logging.googleapis.com/user/egress_denied" AND resource.type="gce_instance"' 'ALIGN_SUM' '600s' $null 200),
    (Threshold 'Cloud Run 5xx responses' ('metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND metric.label.response_code_class="5xx" AND resource.label.service_name=one_of(' + (($services | ForEach-Object { '"' + $_ + '"' }) -join ',') + ')') 'ALIGN_SUM' '300s' 'REDUCE_SUM' 5),
    @{ displayName = 'Egress proxy VM stopped reporting'; conditionAbsent = @{ filter = "metric.type=`"compute.googleapis.com/instance/uptime`" AND resource.type=`"gce_instance`" AND resource.label.instance_id=`"$proxyId`""; aggregations = @(@{ alignmentPeriod = '60s'; perSeriesAligner = 'ALIGN_MEAN' }); duration = '300s'; trigger = @{ count = 1 } } }
)
Invoke-IfLive "create alert policy '$policyName' with $($conds.Count) conditions" {
    $policies = (Api GET "$mon/alertPolicies").alertPolicies
    if ($policies | Where-Object { $_.displayName -eq $policyName }) { Write-Host "alert policy exists: $policyName" }
    else {
        [void](Api POST "$mon/alertPolicies" @{ displayName = $policyName; combiner = 'OR'; enabled = $true; conditions = $conds; notificationChannels = @($channel.name)
            documentation = @{ mimeType = 'text/markdown'; content = 'A RabbitOS service on Google Cloud reported errors, the egress proxy refused an unusual number of requests (possible abuse), Cloud Run returned 5xx, or the proxy VM stopped. Open the RabbitOS platform dashboard, then Logs Explorer. Guest shell: Switch-GuestShellBackend.ps1 -To cloudflare puts visitors back on the Cloudflare sandbox.' } })
        Write-Host "created alert policy: $policyName"
    }
}

# ---------------------------------------------------------------- 4. dashboard
Step 'Dashboard'
function Chart($title, $filter, $aligner, $period, $reducer, $group) {
    $agg = @{ alignmentPeriod = $period; perSeriesAligner = $aligner }
    if ($reducer) { $agg.crossSeriesReducer = $reducer }
    if ($group) { $agg.groupByFields = @($group) }
    @{ title = $title; xyChart = @{ dataSets = @(@{ plotType = 'LINE'; timeSeriesQuery = @{ timeSeriesFilter = @{ filter = $filter; aggregation = $agg } } }); yAxis = @{ scale = 'LINEAR' } } }
}
$cr = 'resource.type="cloud_run_revision"'
$widgets = @(
    (Chart 'Uptime checks passing (1 = all locations pass)' 'metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url"' 'ALIGN_FRACTION_TRUE' '300s' 'REDUCE_MEAN' 'resource.label.host'),
    (Chart 'Cloud Run requests per second' "metric.type=`"run.googleapis.com/request_count`" AND $cr" 'ALIGN_RATE' '300s' 'REDUCE_SUM' 'resource.label.service_name'),
    (Chart 'Cloud Run latency, 95th percentile (ms)' "metric.type=`"run.googleapis.com/request_latencies`" AND $cr" 'ALIGN_PERCENTILE_95' '300s' 'REDUCE_MAX' 'resource.label.service_name'),
    (Chart 'Running container instances' "metric.type=`"run.googleapis.com/container/instance_count`" AND $cr" 'ALIGN_MEAN' '300s' 'REDUCE_SUM' 'resource.label.service_name'),
    (Chart 'Visitor terminals started' 'metric.type="logging.googleapis.com/user/shell_sessions_started" AND resource.type="cloud_run_revision"' 'ALIGN_SUM' '3600s' 'REDUCE_SUM' $null),
    (Chart 'Requests the egress proxy refused' 'metric.type="logging.googleapis.com/user/egress_denied" AND resource.type="gce_instance"' 'ALIGN_SUM' '600s' 'REDUCE_SUM' $null),
    (Chart 'Errors (shell and hub)' 'metric.type=one_of("logging.googleapis.com/user/shell_errors","logging.googleapis.com/user/hub_errors") AND resource.type="cloud_run_revision"' 'ALIGN_SUM' '300s' 'REDUCE_SUM' 'metric.type'),
    (Chart 'Egress proxy VM CPU' 'metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.type="gce_instance"' 'ALIGN_MEAN' '300s' 'REDUCE_MEAN' $null)
)
Invoke-IfLive "create dashboard 'RabbitOS platform' with $($widgets.Count) charts" {
    $existing = (Api GET "https://monitoring.googleapis.com/v1/projects/$Project/dashboards").dashboards | Where-Object { $_.displayName -eq 'RabbitOS platform' }
    if ($existing) { Write-Host 'dashboard exists: RabbitOS platform' }
    else {
        $d = Api POST "https://monitoring.googleapis.com/v1/projects/$Project/dashboards" @{ displayName = 'RabbitOS platform'; gridLayout = @{ columns = 2; widgets = $widgets } }
        Write-Host "created dashboard: https://console.cloud.google.com/monitoring/dashboards/builder/$(($d.name -split '/')[-1])?project=$Project"
    }
}
Write-Host "`nDone. No running service was changed." -ForegroundColor Green
