# Vault pathways: Obsidian, GitHub, Google Cloud and rabbitsoftware.io

How the Obsidian vault (`C:\Users\odaat\Documents\RabbitOS Vault`) is connected to GitHub, Google Cloud and the websites, as verified on 2026-10-16. The vault's own pathway notes (`Pathways/`, `Platform/`) describe the Cloudflare side in detail; this page adds the Google Cloud side and joins the two. The machine-readable version is the platform map (`workers/qa-audit/data/platform-graph.json` in rabbitsoftware-cloudflare, shown on the status page).

## Pathways that exist and were tested

| # | Path | What moves | How often | Status |
|---|---|---|---|---|
| 1 | Vault -> private GitHub repo `therealsickonechase-bit/obsidian-rabbitos-vault` | every note, minus linked folders and files that look like they hold secrets (`Tools/sync-vault.ps1`, task "RabbitOS Vault sync") | every 30 minutes | working; repaired 2026-10-16 (the privacy guard was hard-coded to the old org repo and had been aborting) |
| 2 | Vault -> private Google Cloud bucket `rabbitsoftware-io-vault-private/vault/` | the same notes, minus `Local/EEG` and the PC folder view (`Sync-VaultToGcs.ps1`, task "RabbitOS Vault to Google Cloud") | hourly | working; a marker note arrived in about 100 seconds |
| 3 | Bucket -> Vertex AI Search app `rabbit-vault-search` | text of the notes, for search (`Search-Vault.ps1`, task "RabbitOS Vault Search Reindex") | daily at 04:30 | working; the marker note was found by search |
| 4 | GitHub repo -> bucket `github-mirror/` (cloud mirror job `rabbit-vault-mirror`) | a clone of the repo, same exclusions | hourly | built and tested, not deployed: waits for a read-only GitHub token that only the owner can create |
| 5 | Vault agents (local) <-> Cloudflare R2 job queue <-> RabbitOS console / owner cloud shell | approved note snapshots (`Cloud Agents/Knowledge/`, `Agents/`, `Workers/`) as one-hour scoped jobs and their results | on request | deployed pilot (see the vault note `Pathways/Owner Cloud Shell and Vault Bridge`) |
| 6 | Hub MCP and status page -> public map | architecture only (the platform map), never note contents | every 5 minutes (status) | working |

Nothing from the vault is public. The website and the app never read note contents; they show architecture and status only.

## One command checks all of it

`node scripts/pathways-check.mjs` (VS Code: Terminal > Run Task > "Pathways: check everything") runs about 30 read-only checks across VS Code and the four local projects, GitHub (owner, visibility, in sync), Google Cloud (services, jobs, schedules, hub self-test, vault copy freshness), the network (sites, status feed), research (records reaching RabbitOS, the local store) and the chains (ledger, Maxwell, Bitcoin anchors, wallet watcher, project lien). `--roundtrip` also follows a marker note from the vault to the Google Cloud bucket and through search; `--report` saves the result to `gs://rabbitsoftware-io-reports/pathways/latest.json`. The same tasks, plus the test suites and an ops-log prompt, are in `.vscode/tasks.json` and in `RabbitOS.code-workspace`.

## Where objects can flow back to the local vault (events to local)

Today every path above is one-way, from the vault outwards. The one inward path is path 5 (approved job results), and the vault's own repair queue lists the gap: "Cloud-to-local result retention: browser views and machine CLI receipts do not automatically write proposals to source notes." Options for an event path to local, none built yet:

1. **Pull, no new infrastructure:** a small PC task that lists `gs://rabbitsoftware-io-vault-private/inbox/` with the owner's own sign-in and copies new files into `Inbox/` in the vault. The PC always initiates; nothing can write into the vault from outside.
2. **Event-driven:** a Cloud Storage notification to Pub/Sub when an object appears under `inbox/`, and the same PC task pulling from a subscription (near real time). Needs the Pub/Sub API enabled.
3. **Through the existing job queue (path 5):** approved results written to R2 are fetched by the local vault agent, which already applies approved output.

## What is not connected, on purpose

- `Local/EEG`, wearables and labs never leave the PC (not uploaded, not mirrored).
- The Obsidian Git Sync plugin still points at its old GitHub account and token (its auto-sync is off); the scheduled PC task does the GitHub sync instead.
- The websites have no owner-only vault page; the vault is read from Google Cloud with the owner's own sign-in (`Search-Vault.ps1`).
