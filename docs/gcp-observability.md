# Monitoring, logging and analytics on Google Cloud

Project `rabbitsoftware-io`. Set up by `scripts\powershell\Setup-GcpObservability.ps1` (idempotent; `-WhatIf` previews). Uptime checks and the budget come from `Setup-GcpMonitoring.ps1`.

## What watches what

| Signal | Where it comes from | Where you see it |
|---|---|---|
| Pages and services answering | 6 uptime checks (app, ledger head, website, Cloud Run mirror, hub, visitor shell) | Dashboard "RabbitOS platform"; alert policies "a key URL is down" and "a GCP service is down" |
| Visitor terminals started | the shell's own `started` events, counted by the log-based metric `shell_sessions_started` | Dashboard |
| Errors in the shell or the hub | metrics `shell_errors`, `hub_errors` | Dashboard; alert |
| Requests the egress proxy refused | the Squid log on the proxy VM (`TCP_DENIED`), shipped by the Ops Agent, counted as `egress_denied` | Dashboard; alert on a spike (more than 200 in 10 minutes) |
| Cloud Run 5xx | built-in Cloud Run metrics | alert |
| Proxy VM stopped | built-in VM uptime metric (absent for 5 minutes) | alert |
| Spend | a $10 monthly budget with alerts at 50, 90 and 100 percent | email |

All alerts go to the same email channel. One policy, **"RabbitOS: GCP errors and abuse signals"**, holds the five conditions above.

## Analytics (BigQuery `rabbit_logs`)

A log sink, `rabbit-analytics`, copies two things into BigQuery (tables are partitioned by day, kept 90 days):
- the visitor shell's and the hub's own structured events (start, end, reason, short session id), and
- the Squid log of what visitors asked the proxy for.

**No request logs go in, so no visitor IP address is stored.** The proxy log shows the shell's internal address and the host asked for, not the visitor.

Tables appear after the first matching log arrives (a few minutes). Example queries (BigQuery console, dataset `rabbit_logs`; tables `run_googleapis_com_stdout` and `squid_access`, partitioned by day):

```sql
-- Terminals started per day
SELECT DATE(timestamp) AS day, COUNT(*) AS sessions
FROM `rabbitsoftware-io.rabbit_logs.run_googleapis_com_stdout`
WHERE resource.labels.service_name = 'rabbit-visitor-shell' AND JSON_VALUE(json_payload, '$.event') = 'started'
GROUP BY day ORDER BY day DESC;

-- Why sessions ended
SELECT JSON_VALUE(json_payload, '$.reason') AS reason, COUNT(*) AS n
FROM `rabbitsoftware-io.rabbit_logs.run_googleapis_com_stdout`
WHERE resource.labels.service_name = 'rabbit-visitor-shell' AND JSON_VALUE(json_payload, '$.event') = 'end'
GROUP BY reason ORDER BY n DESC;

-- Which blocked hosts do visitors ask for most? (a data-driven view of what the allowlist might need)
SELECT REGEXP_EXTRACT(JSON_VALUE(json_payload, '$.message'), r'TCP_DENIED/\d+ \d+ CONNECT ([^: ]+)') AS host, COUNT(*) AS tries
FROM `rabbitsoftware-io.rabbit_logs.squid_access`
WHERE JSON_VALUE(json_payload, '$.message') LIKE '%TCP_DENIED%'
GROUP BY host ORDER BY tries DESC LIMIT 20;
```

If a table is missing, it appears after the first matching log arrives (a few minutes).

## Reading logs directly

- Logs Explorer, filter `resource.labels.service_name="rabbit-visitor-shell"` (or `rabbitos-hub-mcp`).
- Blocked egress: `logName="projects/rabbitsoftware-io/logs/squid_access" AND jsonPayload.message:"TCP_DENIED"`.

## The proxy VM's account

The egress proxy runs as `rabbit-proxy-runner`, which can only write logs and metrics. It used to run as the default compute account, which normally has the Editor role on the whole project; Squid should never be able to hand that out.

## Cost

Logging: 50 GiB per project per month is free and these services log very little. BigQuery: storage and queries on this volume are well inside the free tier. The Ops Agent runs on a VM that already exists. All of it draws on the project's credits.
