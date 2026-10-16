# RabbitOS on Google Cloud: what runs where

One page. Project `rabbitsoftware-io`, region `us-west2`. Production (the website and the app) stays on Cloudflare. Google Cloud holds the backups, a standby site, the visitor shell and the hub.

## The pieces

| Piece | What it is | Where | Setup / change |
|---|---|---|---|
| Backups | Private backups, versioned, Nearline after 30 days, deleted after 365 | `gs://rabbitsoftware-io-backups` | `scripts\powershell\Run-DailyBackups.ps1` (scheduled 3:00 AM) |
| Public ledger mirror | The public chain and Maxwell chain | `gs://rabbitsoftware-io-ledger-public` | same daily job |
| Standby website | Static copy of rabbitsoftware.io | Cloud Run `rabbit-site-standby` | `Setup-GcpStandby.ps1` (re-run after the site changes) |
| App mirror | Read mirror of the app | Cloud Run `rabbit-web`, `rabbit-web-workerd` (`run.rabbitsoftware.io`) | existing |
| **Visitor shell** | A throwaway terminal per guest, with claude, gemini, copilot, bash, PowerShell, Python, Node, gcc, sqlite | Cloud Run `rabbit-visitor-shell`, behind a private network and an allowlist proxy VM | `Setup-GcpShell.ps1` |
| **Hub MCP** | One tool server for AI assistants: links, status, public chain and data, website pages, the guest/owner command catalog, safe command drafting | Cloud Run `rabbitos-hub-mcp` | `Setup-GcpHub.ps1`; keys: `New-HubKey.ps1` |
| **Live status feed** | Every 5 minutes: which public services answer, whether the chain copies agree, the public data tree; plus a 24-hour history | Cloud Run job `rabbit-status` writes `gs://rabbitsoftware-io-status-public` (world-readable, CORS for rabbitsoftware.io only); the page is `rabbitsoftware.io/status.html` | `Setup-GcpStatusFeed.ps1` |
| **Weekly audit** | Crawls rabbitsoftware.io and the app, scores them, lists what to fix first, draws a platform map, a site map and the Supabase tree | Cloud Scheduler (Mondays 09:00 Los Angeles) starts Workflow `rabbit-qa`, which runs Cloud Run job `rabbit-qa`; reports in the private bucket `gs://rabbitsoftware-io-reports` (`latest.html`, `latest.json`, dated copies kept 180 days) | `Setup-GcpQaWorkflow.ps1` |
| Analytics | Every service event, every refused egress request and every status check, kept 90 days | BigQuery `rabbit_logs` through the log sink `rabbit-analytics` (no IP addresses) | `Setup-GcpObservability.ps1`, `Setup-GcpStatusFeed.ps1` |

### What is public and what is not
- **Public:** the status feed (service names, up or down, timings, chain lengths, public dataset names and column names) and the status page. The public map shows only public services.
- **Private:** the audit report and its findings, the Supabase tree, the backups, the proxy VM and everything about the owner's computer.
- To refresh the Supabase tree after a migration: `node scripts/export-supabase-tree.mjs --live` in rabbit-web, then rebuild the audit job (`Setup-GcpStatusFeed.ps1`). `--live` also re-checks what an anonymous reader can see, using only the project's public key.
| Watching | Uptime checks, alert emails, a $10 budget | Cloud Monitoring, Billing | `Setup-GcpMonitoring.ps1` |

## Visitor shell: how a guest gets a terminal

1. The page (`/cloudshell-public`) shows a human check and talks to the Cloudflare Worker `rabbitsoftware-public-shell`.
2. The Worker checks the human check and the quotas (one live sandbox per address, 15 idle minutes (typing or terminal output counts as activity), 60 minutes total, a daily limit), then opens a terminal.
3. The terminal is either the **Cloudflare sandbox** (default) or the **GCP service** (when `TERMINAL_BACKEND=gcp`). The GCP service runs one visitor per instance, as an unprivileged user, and exits when the session ends, so the next visitor gets a clean instance.
4. On GCP, the only way out to the internet is through a proxy VM that allows 13 named hosts (package registries, GitHub, the model APIs and the public RabbitOS app). Anything else, including raw IPs and attempts to go around the proxy, is blocked by the network.

Switching the live guest shell between the two: `scripts\powershell\Switch-GuestShellBackend.ps1 -To gcp` or `-To cloudflare` (revert). Test first with `Setup-GcpShellStaging.ps1`, which uses a separate Worker and does not touch the live one.

## Hub MCP: who can do what

- **No key:** the public read-only tools, 20 calls per minute per address. Tools: `hub_links`, `hub_status`, `hub_briefing`, `hub_selftest`, `chain_head`, `chain_events`, `data_datasets`, `data_rows`, `concept_lookup`, `research_feed`, `site_page`, `commands_*` and `command_draft` for the **guest** role, `agents_list`, `languages_list`, `shell_propose`.
- **With a hub key** (`New-HubKey.ps1`, copied to the clipboard, never printed): 120 calls per minute and the **owner** role (owner commands and drafting).
- **Nothing in the hub runs a command.** `command_draft` checks a command (one line, no secrets, nothing hidden or destructive), labels its risk and says where to run it. A person presses Enter. Deploys, migrations, secrets and anything destructive are owner-only and stay manual.
- Gemini CLI on the owner PC is already configured for it: `~/.gemini/settings.json`, server `rabbitos-hub`.
- The command catalog is exported from RabbitOS: `node scripts/export-command-catalog.mjs`, then redeploy the hub.

## Costs and credits

Cloud Run scales to zero. The always-on cost is the small proxy VM (an e2-micro). The visitor shell is billed per session-second at 1 vCPU / 1 GiB. Everything on Google Cloud draws on the project's credits and is covered by the $10 monthly budget alert. Cloudflare charges (Workers, the Cloudflare sandbox, Pages) are separate and are **not** covered by Google Cloud credits.

## If something looks wrong

0. Look at https://rabbitsoftware.io/status.html first. If it says the last report is old, the recorder stopped: check the Cloud Run job `rabbit-status` and the Scheduler job `rabbit-status-5min` (an alert emails you after 30 minutes).
1. Ask any assistant connected to the hub for `hub_selftest`, or run `hub_status`.
2. Guest shell broken on GCP: `Switch-GuestShellBackend.ps1 -To cloudflare`.
3. Hub key leaked: `New-HubKey.ps1 -Revoke <name>`.
4. Alert emails come from these policies: "a key URL is down", "a GCP service is down", "GCP errors and abuse signals", "weekly audit needs attention", "status recorder stopped".
5. To read the latest audit: Cloud Storage console, `rabbitsoftware-io-reports`, `latest.html`; or `gcloud storage cat gs://rabbitsoftware-io-reports/latest.json`.

## The research web: sources, agents, chain, data, shell

The map of every part and connection, with the research flow, is `workers/qa-audit/data/platform-graph.json` (in rabbitsoftware-cloudflare). The weekly audit report draws it; `node scripts/export-platform-graph-sql.mjs` turns it into Supabase tables (`supabase/migrations/20261015000000_platform_graph.sql`, then `supabase/seed/platform_graph.seed.sql`, both applied by hand).

1. **Public sources:** PubMed, Europe PMC, ClinicalTrials.gov, openFDA, NIH RePORTER, ClinVar, St. Jude. Documented APIs only.
2. **Research agents** on the owner's computer search them and keep records locally.
3. **Maxwell chain:** findings are anchored as hashes (proof of existence and time, not of truth).
4. **Signed ingest** sends public records, topics, runs and labelled AI summaries to the app (Supabase). Personal data never leaves the computer.
5. **Data hub** and pages serve them read-only.
6. **Hub MCP and the shell:** `research_sources` explains the flow; `research_search` (pubmed, europepmc, clinicaltrials, openfda) searches a source live through the hub, GET only, fixed hosts, nothing stored. The shell needs no new egress host because it only talks to the hub. To keep a finding, the owner's agents ingest it.

`research_search` is in the code and tested; it goes live when the hub is redeployed with `Setup-GcpHub.ps1`.

## Finding your way: commands, help and the catalog

- **One catalog** (`src/lib/command-catalog.ts`) records the commands for every service: Google Cloud setup (each script has a `-WhatIf` preview and a run entry), hub keys, tests, the status feed, the weekly audit, the platform map, and read-only calls to the hub. `node scripts/export-command-catalog.mjs` copies it to the hub; redeploy the hub to publish it. The same file feeds the app's /commands page.
- **`hub_help`** (hub tool, no key needed): topics overview, services, tools, commands, shells, agents, research, troubleshooting. `services` lists each service with its address, how to check it and, for the owner role, the command that fixes or changes it.
- **Roles:** guests see only commands that work in the throwaway sandbox (including read-only hub calls with `curl`); owner commands (all deploys and key handling) are drafted and checked by `command_draft`, never run by the hub.
- In the guest shell, an assistant starts with `hub_help`, then `hub_briefing` and `hub_status`.
