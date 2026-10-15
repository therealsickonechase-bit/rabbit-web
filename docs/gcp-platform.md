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
| Watching | Uptime checks, alert emails, a $10 budget | Cloud Monitoring, Billing | `Setup-GcpMonitoring.ps1` |

## Visitor shell: how a guest gets a terminal

1. The page (`/cloudshell-public`) shows a human check and talks to the Cloudflare Worker `rabbitsoftware-public-shell`.
2. The Worker checks the human check and the quotas (one live sandbox per address, 10 idle minutes, 30 minutes total, a daily limit), then opens a terminal.
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

1. Ask any assistant connected to the hub for `hub_selftest`, or run `hub_status`.
2. Guest shell broken on GCP: `Switch-GuestShellBackend.ps1 -To cloudflare`.
3. Hub key leaked: `New-HubKey.ps1 -Revoke <name>`.
4. Alert emails come from the policies "a key URL is down" and "a GCP service is down".
