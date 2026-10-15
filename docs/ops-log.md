# Operations log

A running record of changes made to the live RabbitSoftware / RabbitOS platform: what changed, how it was checked, and how to undo it. Entries are only added at the end, newest last.
Add one with `node scripts/ops-log.mjs --area "..." --did "..." --check "..." --undo "..."`. Never put secrets, keys, tokens or private data in an entry.

Other logs that already exist (not duplicated here):
- Google Cloud **Admin Activity** audit logs (every change to cloud settings) and **Data Access** logs for the wallet key and Secret Manager (every signing request and secret read, switched on 2026-10-15).
- `~\RabbitOS\logs\` on the owner's PC: daily backup, research sync, task worker, vault upload, and `wallet-withdrawals.log` (every signing and sending of the wallet, ids and amounts only).
- Cloud Run job logs for `rabbit-status`, `rabbit-qa`, `rabbit-backup`, `rabbit-miner` and `rabbit-anchor`; the status page and its 24-hour history.
- `docs/security-hardening.md`: the ordered security checklist and its results.

## 2026-10-15 (entries below were written afterwards from the day's work; times are approximate)

### 2026-10-15 - Google Cloud: visitor shell, hub and observability
- **Did:** the guest shell now runs on Cloud Run behind an allowlist proxy VM (13 named hosts); hub MCP `rabbitos-hub-mcp` with read-only tools, command catalog and help; log metrics, BigQuery analytics sink, 5 alert policies, 6 uptime checks, $10 monthly budget alert.
- **Checked:** hub self-test 15 of 15; status feed 11 of 11; proxy allowlist tested from the VM (allowed hosts connect, others refused).
- **Undo:** `Switch-GuestShellBackend.ps1 -To cloudflare` returns guests to the Cloudflare sandbox; individual services can be deleted with `gcloud run services delete`.
- **Ref:** Setup-GcpShell.ps1, Setup-GcpHub.ps1, Setup-GcpObservability.ps1, Setup-GcpMonitoring.ps1

### 2026-10-15 - Status feed and weekly audit
- **Did:** Cloud Run job `rabbit-status` every 5 minutes writing a public feed to `rabbitsoftware-io-status-public`; weekly audit workflow `rabbit-qa` (Mondays 09:00 Los Angeles) with reports in the private `rabbitsoftware-io-reports` bucket; status page on rabbitsoftware.io with a research line.
- **Checked:** feed shows 11 of 11 services; status page loads the feed from rabbitsoftware.io; watchdog alert "status recorder stopped" exists.
- **Undo:** delete the Scheduler jobs `rabbit-status-5min` and the Workflow trigger; remove status.html from the site.
- **Ref:** Setup-GcpStatusFeed.ps1, Setup-GcpQaWorkflow.ps1

### 2026-10-15 - Backups: cloud job
- **Did:** Cloud Run job `rabbit-backup` nightly 03:30 Los Angeles: Supabase dump plus Cloudflare D1, KV and R2 into `rabbitsoftware-io-backups/platform-cloud/<date>/<run>/`. Secrets `rabbit-supabase-db-url` and `rabbit-cf-backup-token` stored by the owner. D1 falls back to SELECT-only dumps with a read-only token.
- **Checked:** `Test-CloudBackup.ps1` compares with the local backup: dump size equal (30.8 MB), D1 2 of 2, KV keys match. Local backup unchanged.
- **Undo:** delete the job and the Scheduler job `rabbit-backup-nightly`; the local 3:00 AM backup still runs.
- **Ref:** Setup-GcpBackupSecrets.ps1, Setup-GcpBackupJob.ps1, Setup-CfBackupToken.ps1

### 2026-10-15 - Maxwell chain: cloud miner, adopt, research loop
- **Did:** Cloud Run job `rabbit-miner` nightly 05:00 (signs as RABBITWEB_MINER_CLOUD; mirrors to the app first, then publishes to the public bucket); the PC adopts cloud blocks before mining; Windows tasks "RabbitOS Research Sync" (30 min) and "RabbitOS Task Worker" (5 min). Extra Maxwell leaves (code heads, platform map, command catalog, cloud backup, research, Bitcoin anchor).
- **Checked:** first cloud run mined block 3; app, bucket and PC all hold the same 4 blocks; hub chain_consistency passes.
- **Undo:** `Register-ResearchTasks.ps1 -Remove`; delete job `rabbit-miner` and Scheduler job `rabbit-miner-nightly`; `python maxwell_adopt.py` is read-only unless `--apply`.
- **Ref:** Setup-GcpMinerSecrets.ps1, Setup-GcpMinerJob.ps1, Register-ResearchTasks.ps1

### 2026-10-15 - Obsidian vault copy and search
- **Did:** private bucket `rabbitsoftware-io-vault-private` (versioned, public access blocked); hourly one-way upload of the vault files the GitHub sync takes, minus `Local/EEG/` and the `~\RabbitOS` view; Vertex AI Search app `rabbit-vault-search` (owner-only) with a daily re-index task.
- **Checked:** 2,383 files uploaded; EEG note and self-copying folder removed including old versions; search returns vault notes.
- **Undo:** `Register-VaultTask.ps1 -Remove`; delete the bucket and the search app.
- **Ref:** Setup-GcpVaultBucket.ps1, Sync-VaultToGcs.ps1, Setup-GcpVaultSearch.ps1

### 2026-10-15 - Bitcoin anchoring
- **Did:** Cloud Run job `rabbit-anchor` every 6 hours: OpenTimestamps proofs of the public ledger and Maxwell heads under `anchors/` in the public ledger bucket (the job account may write only that prefix).
- **Checked:** first anchor stored; the proof's digest equals the SHA-256 of `anchor.json`; three calendars accepted it (pending until Bitcoin confirms).
- **Undo:** delete the job and Scheduler job `rabbit-anchor-daily`; remove the `anchors/` objects.
- **Ref:** Setup-GcpAnchor.ps1

### 2026-10-15 - Wallet key and donation addresses
- **Did:** Cloud KMS HSM key `rabbit-wallet/maxwell-donations` (secp256k1, no signers granted); Bitcoin `bc1qxudt9x4hcftvwkfryln2qhn4e5g2qvt09mlp56` and Ethereum `0x724Dfe717565742b066465813773586df98d9372` derived from its public key; donate block on the rabbitsoftware.io front page, `/donate` and `/wallet.json` published.
- **Checked:** address code against published vectors; a message signed by the real key recovers to the Ethereum address and verifies for Bitcoin; live pages show only these two addresses.
- **Undo:** remove the donate block and `donate.html` from the site and redeploy. The key itself persists (destroying a key version is recoverable for 30 days); there is no seed phrase.
- **Ref:** Setup-GcpWallet.ps1, workers/wallet

### 2026-10-15 - Security hardening (see docs/security-hardening.md for the full list)
- **Did:** public Cloud Run services moved off the default compute account (Editor removed; it keeps only image push and log write); `hello-world` deleted; Data Access audit logs on for Cloud KMS and Secret Manager; Cloudflare SSL mode strict, minimum TLS 1.2; DMARC `p=none` record; SSH/RDP-from-anywhere firewall rules deleted; `rabbitos-agent-worker` roles removed and `github-deploy` shrunk; `rabbit-web-workerd` made private; proxy VM OS Login on and Secure Boot on.
- **Checked:** each step verified live (health, builds, audit log entry for a real signing, 7 sites over valid TLS, proxy allowlist test after the restart).
- **Undo:** each script and the checklist list their own undo commands (for example `gcloud projects add-iam-policy-binding ... --role roles/editor`).
- **Ref:** Fix-GcpDefaultAccount.ps1, Enable-GcpAuditLogs.ps1, Enable-ProxySecureBoot.ps1

### 2026-10-15 - Wallet withdrawal tool
- **Did:** `workers/wallet/withdraw.mjs`: dry run, sign, broadcast, with allowlist, per-withdrawal and fee limits, retyped confirmation. Nothing has been sent from the wallet.
- **Checked:** 42 wallet tests; EIP-155 and BIP143 published vectors; real-key signing recovers to the wallet address; read-only live run (balances 0).
- **Undo:** it only acts when run by hand; delete the files to remove it.
- **Ref:** docs/wallet.md

### 2026-10-15 23:11 UTC - Operations log
- **Did:** Started this log and backfilled the day's changes
- **Checked:** tests/ops-log.test.mjs passes
- **Undo:** Delete docs/ops-log.md
- **Ref:** scripts/ops-log.mjs


### 2026-10-15 23:17 UTC - Cloudflare Pages: marketing pages
- **Did:** Published story, blockchain and press pages with donate links and sitemap to rabbitsoftware.io (project rabbitsoftware-site, branch master)
- **Checked:** 17 site tests and donate --check pass; story, blockchain, press, donate return 200 on the live domain (blockchain was briefly a cached 404); headless Edge shows 0 CSP violations on all 5 pages; live numbers fill (ledger events 8, services 11 of 11, research records 395)
- **Undo:** Redeploy the previous Pages deployment from the Cloudflare dashboard (Deployments, Rollback)
- **Ref:** wrangler pages deploy site
