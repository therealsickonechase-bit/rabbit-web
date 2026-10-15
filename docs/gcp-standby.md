# GCP: backup, mirror and standby for rabbitsoftware.io

Project `rabbitsoftware-io`, region `us-west2`. Production stays on Cloudflare; GCP holds copies and can take over by hand.

| Role | What | Where |
|---|---|---|
| Backup | Private backups: Supabase dump, Cloudflare config, repos, Maxwell files, data-hub exports | `gs://rabbitsoftware-io-backups` (versioned, Nearline after 30 days, deleted after 365) |
| Mirror | Public chain ledger and Maxwell chain | `gs://rabbitsoftware-io-ledger-public`; app mirror on Cloud Run `rabbit-web` / `rabbit-web-workerd` (`run.rabbitsoftware.io`) |
| Standby site | Static copy of rabbitsoftware.io (nginx) | Cloud Run `rabbit-site-standby`, scale to zero, max 1 instance |
| Images | Container images for the above | Artifact Registry `rabbit-software` (cleanup policy, dry run first) |
| Watching | Four uptime checks, one alert policy, a $10 monthly budget | Cloud Monitoring and Billing |

## Set up or refresh
`scripts\powershell\Setup-GcpStandby.ps1` (add `-WhatIf` to preview). It is idempotent and changes no DNS. Re-run it after the site changes to refresh the standby copy.
Daily: `Run-DailyBackups.ps1` already syncs backups and the ledger.

## Turning on Artifact Registry deletion
The script installs the cleanup policy as a dry run. Review what it would delete in Cloud Logging (filter on `cleanup`), then:
`gcloud artifacts repositories set-cleanup-policies rabbit-software --project rabbitsoftware-io --location us-west2 --policy <file> --no-dry-run`

## Failover (manual, only if Cloudflare Pages is down)
1. Check the standby: open the `Standby URL` the script printed; pages and `/chain.html` should load.
2. A custom domain on Cloud Run needs a verified domain mapping or a load balancer; Cloudflare is the DNS, so the quickest cut-over is a proxied CNAME for `rabbitsoftware.io` to the `*.run.app` host plus a Host-header rewrite rule. Decide this before you need it; it is not set up.
3. Revert the DNS record when Pages is back.

## Not done on purpose
- No DNS or Cloudflare change, so nothing live depends on GCP yet.
- The app (`app.rabbitsoftware.io`) is not served from GCP: it needs Supabase and the Worker bindings. The Cloud Run mirror exists for reads and checks.
- An automatic failover (load balancer plus health checks) costs roughly $18 per month; add it only if you want hands-off cut-over.
