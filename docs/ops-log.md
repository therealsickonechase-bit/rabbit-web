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

### 2026-10-15 23:24 UTC - App preflight
- **Did:** Ran type check, lint of src/tests/scripts and all 369 unit tests before any app deploy; updated the open_access migration test to allow the new read-only platform_graph migration
- **Checked:** tests 369 of 369 pass; eslint of src, tests, scripts reports no errors; tsc errors are only in stale generated .next types
- **Undo:** git revert the test change
- **Note:** Nothing deployed; app deploy still waits for the owner's go-ahead

### 2026-10-15 23:33 UTC - RF Nexus preview moved to Google Cloud
- **Did:** Hosted the RF Nexus static preview on Cloud Run service rf-nexus-preview (public, scale to zero, max 2, runs as rabbit-rfnexus-runner with no roles, no secrets); deleted the Cloudflare Worker rabbitsoftware-rf-nexus-preview
- **Checked:** 4 server tests pass; live: page 200 with warning banner and editor script removed, /api answers 503, /report.md 404, POST 405; browser CSP only blocks the page's own backend calls as designed; old Worker URL now 404
- **Undo:** Cloud Run: gcloud run services delete rf-nexus-preview --region us-west2, then delete service account rabbit-rfnexus-runner. Worker: redeploy from tools/rf-nexus-preview (commit b045b8f) with wrangler deploy
- **Ref:** scripts/powershell/Setup-GcpRfNexus.ps1, workers/rf-nexus-gcp
- **Note:** URL https://rf-nexus-preview-vxx5lz7c5a-wl.a.run.app

### 2026-10-15 23:59 UTC - Ethereum and XRPL anchoring
- **Did:** Built and deployed Cloud Run job rabbit-anchor-chains (every 6 h at :30). New HSM key rabbit-wallet/anchor-signer (separate from the donation key); account rabbit-anchor-chains may sign with that key only and write only anchors/. Posts the anchor digest to Ethereum (self-send with data) and an XRPL AccountSet memo once funded. Bitcoin: re-ran rabbit-anchor; proof still pending (calendars confirm in hours)
- **Checked:** 50 wallet tests pass; XRPL blob, hash and signature identical to the official xrpl library; job ran live and reported funded:false for both addresses and sent nothing; job account confirmed to have no access to the donation key
- **Undo:** gcloud run jobs delete rabbit-anchor-chains; gcloud scheduler jobs delete rabbit-anchor-chains-6h; remove the account rabbit-anchor-chains; schedule destruction of key version anchor-signer/1 (recoverable 30 days)
- **Ref:** scripts/powershell/Setup-GcpAnchorChains.ps1, workers/wallet/anchor-chains.mjs
- **Note:** Anchoring addresses: ETH 0x32bA3432Caff0dac6C88D58Fb2875dc721986b3d, XRPL rN8pnpYCaZEQAXE5kL1GC9ThpJYZ8Rd1nX. Waiting for the owner to fund them

### 2026-10-16 00:04 UTC - Site: anchoring status on /blockchain
- **Did:** Added Layer 4 (Ethereum and XRP Ledger notes) to the blockchain page with the two public anchoring addresses (marked not for gifts) and live Bitcoin/Ethereum/XRPL anchor state read from the public ledger bucket; set CORS (GET from rabbitsoftware.io) on rabbitsoftware-io-ledger-public; added that bucket to the site CSP connect-src; deployed to Cloudflare Pages production
- **Checked:** 17 site tests pass; on the live domain headless Edge shows eth/xrpl 'waiting for funds', bitcoin 'submitted, waiting for a Bitcoin block', 0 CSP violations, 0 console errors
- **Undo:** Pages: roll back the deployment; bucket: gcloud storage buckets update gs://rabbitsoftware-io-ledger-public --clear-cors
- **Ref:** site/blockchain.html, site/live-facts.js, site/_headers

### 2026-10-16 00:07 UTC - Hub MCP: anchor_status
- **Did:** Added the read-only hub tool anchor_status (Bitcoin proofs, Ethereum and XRPL anchoring accounts, funded or not, latest transactions), catalog entries for Setup-GcpAnchorChains and its test (232 commands), help entry updated; redeployed rabbitos-hub-mcp on Cloud Run
- **Checked:** 47 hub tests and 13 catalog tests pass; live call to anchor_status returns the real state; hub self-test 15 of 15
- **Undo:** Redeploy the previous hub revision: gcloud run services update-traffic rabbitos-hub-mcp --to-revisions <previous>=100
- **Ref:** workers/hub-mcp, scripts/powershell/Setup-GcpHub.ps1

### 2026-10-16 00:10 UTC - Site: single donation address set
- **Did:** Removed the two anchoring fee-account addresses from the blockchain page text so the only addresses shown on rabbitsoftware.io are the donation wallet's (Cloud KMS key maxwell-donations); they stay in the public status file anchors/chains.json, marked as fee accounts. Confirmed index, donate, wallet.json and the app's wallet.ts all carry the same donation addresses. Redeployed Pages production
- **Checked:** 17 site tests pass; build-donate --check up to date; live blockchain page shows no addresses, live donate page shows only bc1qxudt9x4hcftvwkfryln2qhn4e5g2qvt09mlp56 and 0x724Dfe717565742b066465813773586df98d9372
- **Undo:** Roll back the Pages deployment
- **Ref:** site/blockchain.html

### 2026-10-16 00:19 UTC - Donations paused; Bitcoin anchoring only
- **Did:** Paused public donations: removed the donate page, wallet.json, the front-page block, nav and text invitations from rabbitsoftware.io (switch: workers/wallet/donations.json open=false, honoured by build-donate.mjs); app hides the Donate link, card and /donate page (DONATIONS_OPEN=false in the generated wallet module; app NOT deployed). Parked Ethereum and XRPL anchoring: paused Scheduler job rabbit-anchor-chains-6h and reworded the blockchain page layer 4 as planned. Bitcoin anchoring continues unchanged. The wallet key and addresses are untouched
- **Checked:** wallet tests 48 pass (3 skipped while paused), site tests 18 pass, app tests 369 pass; live: donate.html, donate and wallet.json return 404; no donation address or link on index, story, blockchain or press; blockchain page still shows the live Bitcoin anchor state with 0 CSP violations and 0 errors
- **Undo:** Set open true in donations.json, run build-donate.mjs, restore page text from git history (commit before 'Pause donations'), deploy; resume the scheduler job with gcloud scheduler jobs resume rabbit-anchor-chains-6h --location us-west2
- **Ref:** workers/wallet/donations.json

### 2026-10-16 00:31 UTC - Features, descriptions and commands synced; report to Google Cloud
- **Did:** Synced the platform map (backup and miner jobs now live; new nodes for the anchoring key, the Ethereum/XRPL job (parked) and RF Nexus; donation edges removed; roadmap brought up to date with new done, paused and waiting items), regenerated the Supabase seed SQL (not applied), updated command descriptions (donation rebuild, anchoring parked, RF Nexus setup; 234 commands), hub help (wallet paused, RF Nexus), messaging guide and developer notes (RF Nexus now on Cloud Run). Redeployed hub (revision 00013), status feed and weekly audit jobs; deployed the site to Pages production; ran the weekly audit once and copied this log to the private reports bucket
- **Checked:** catalog 13, hub 47, audit 48, site 18 tests pass; hub redeploy health ok; weekly audit run SUCCEEDED: 58 pages, 0 high, 5 medium, 4 low, score 67, 11 of 11 services up, chains agree
- **Undo:** Redeploy earlier revisions (hub: gcloud run services update-traffic rabbitos-hub-mcp --to-revisions <previous>=100); git revert the doc commits; Pages: roll back the deployment
- **Ref:** workers/qa-audit/data/platform-graph.json, src/lib/command-catalog.ts
- **Note:** Not deployed: the RabbitOS app (waits for go-ahead) and the Supabase platform_graph migration and seed

### 2026-10-16 00:46 UTC - RabbitOS app deployed; development guide republished
- **Did:** Ran npm run deploy:vinext (Worker rabbit-web, version 0b8ebda6): ships the guest shell prompt box and key toggle, command catalog page, content-security-policy enforcement on 17 more pages, and hides the paused Donate link, card and page. Republished site/development.md from DEVELOPMENT.md with the publish script (credential check, usernames replaced) and deployed Pages production
- **Checked:** tsc clean in src; 369 app tests and 18 site tests pass before deploy; live: api/health, dashboard, commands, guide, cloudshell-public, chain return 200, /donate returns 404; headless Edge: 0 CSP violations on all 19 pages (cloudshell-public checked separately because the scanner never reaches network idle there); development.md has no personal username and shows RF Nexus on Cloud Run
- **Undo:** Cloudflare dashboard, Workers, rabbit-web, Deployments: roll back to the previous version; Pages: roll back the deployment
- **Ref:** npm run deploy:vinext

### 2026-10-16 01:11 UTC - Supabase platform-graph applied; Bitcoin proof confirmed
- **Did:** Applied the platform_graph migration and seed to the live Supabase database from the PC (read SUPABASE_DB_URL from .env.local in a one-off script; the value was never printed): 3 tables, the platform_tree view, row-level security, 55 nodes, 89 connections, 49 roadmap items; re-applied the seed after the roadmap update. Fixed the migration first: its provider check rejected 'research' (dry run in a rolled-back transaction caught it). Reloaded the API schema cache. Confirmed the Bitcoin anchor: the scheduled rabbit-anchor job upgraded proof 2026-10-15T214050Z by itself at 01:00 UTC to Bitcoin block 971631. Redeployed the status feed and weekly audit jobs so they carry the new map
- **Checked:** dry run rolled back clean, then applied; anonymous read of platform_roadmap and platform_tree works, anonymous insert refused (HTTP 401); independent verification: document sha256 equals the proof digest and the proof ends at the merkle roots of blocks 971631 and 971634 (matched to mempool.space block headers)
- **Undo:** Supabase: drop view public.platform_tree and tables platform_edges, platform_roadmap, platform_nodes (nothing else depends on them). Bitcoin: nothing to undo; a timestamp cannot be removed
- **Ref:** supabase/migrations/20261015000000_platform_graph.sql

### 2026-10-16 01:25 UTC - Wallet recovery protections and Google Cloud receiving record
- **Did:** Project lien on rabbitsoftware-io (blocks deleting the project that holds the wallet key); email alert on any destroy/restore/update/create/permission change on key ring rabbit-wallet (log-match policy, log metric wallet_key_change); Cloud Run job rabbit-wallet-watch every 30 min (account with no roles, no key access, wallet/ prefix of the private reports bucket only) that records balances and receipts of the two donation addresses and the two anchoring fee accounts in gs://rabbitsoftware-io-reports/wallet/state.json and logs wallet_received, with a log metric and email alert 'money arrived at a wallet address'. Wrote the recovery plan in docs/wallet.md. Updated catalog (240 commands), hub help, platform map (56 nodes, 91 connections, 50 roadmap items, re-applied to Supabase) and redeployed hub, status and audit jobs. Fixed Setup-GcpQaWorkflow.ps1 to bind its bucket role with --condition=None now that the reports bucket has a conditional binding
- **Checked:** wallet tests 54 pass (6 new), catalog 13, hub 47, audit 48; watcher ran live and wrote the baseline (all four addresses at zero); scheduler job enabled; alert policies listed; recovery script status shows both keys ENABLED with 30-day destroy delay; hub self-test allOk true
- **Undo:** Lien: delete it with the Resource Manager liens API (name printed by the script); alerts and metrics: delete in Cloud Monitoring and gcloud logging metrics delete wallet_received wallet_watch_failed wallet_key_change; job: gcloud run jobs delete rabbit-wallet-watch and gcloud scheduler jobs delete rabbit-wallet-watch-30min, then delete service account rabbit-wallet-watch
- **Ref:** scripts/powershell/Setup-GcpWalletWatch.ps1, Setup-GcpWalletRecovery.ps1, workers/wallet/wallet-watch.mjs
- **Note:** Only one project Owner exists; adding a second is the owner's decision (docs/wallet.md)

### 2026-10-16 01:27 UTC - Wallet decisions recorded
- **Did:** Recorded the owner's decisions: the wallet is a receiving account only (sweep out what arrives), and no second project Owner yet. Updated docs/wallet.md and the platform map (paused item p-second-owner) and re-applied the map to Supabase
- **Checked:** qa-audit 48 tests pass; map applied (committed)
- **Undo:** Edit docs/wallet.md; set p-second-owner back to waiting
- **Ref:** docs/wallet.md

### 2026-10-16 01:30 UTC - App redeployed with the 240-command catalog; README docs map
- **Did:** Redeployed the RabbitOS app (it serves the command catalog, now 240 commands) and added a documentation map to README.md. Checked all three repos before pushing: no secret-like content in the unpushed commits (only fake test values and public key files), repos private
- **Checked:** 369 app tests pass, tsc clean in src; live api/health, dashboard, commands, guide 200, /donate 404, /commands shows 240
- **Undo:** Cloudflare dashboard: roll back the Worker rabbit-web to the previous version
- **Ref:** npm run deploy:vinext

### 2026-10-16 01:31 UTC - Pushed to GitHub
- **Did:** Pushed rabbit-web (50 commits) and rabbitsoftware-cloudflare (46 commits) to their private GitHub repositories after a secret scan of the unpushed changes. research-agents (6 local commits) was NOT pushed: GitHub answered 'repository not found' for ringquistchase-collab/research-agents with the signed-in account therealsickonechase-bit
- **Checked:** git push output shows main updated on both pushed repos; scan found only fake test values and public key files
- **Undo:** Pushed commits cannot be unpushed cleanly; revert with new commits if needed
- **Ref:** git push origin main
- **Note:** research-agents needs either sign-in to the account that owns that repo or its remote corrected

### 2026-10-16 09:01 UTC - Research agents one-hour run; wallet and Google Cloud check
- **Did:** Ran the research agents (run_all.py through a wrapper: 127.0.0.1 only, one queued topic every 5 minutes) from 20:34 to 21:34 local on 2026-10-15; they stopped cleanly on their own and saved state. Next morning checked the wallet and Google Cloud, read only
- **Checked:** public status feed: research records 395 to 574, topics explored 9 to 20, 11 of 11 services up, chains agree; wallet watcher state (08:30 UTC): all four addresses 0, no receipts; Bitcoin anchor confirmed (block 971631); Ethereum/XRPL job paused as intended; project lien present; KMS audit log shows only the owner's own signing tests and my IAM grants; the error log holds only already-fixed setup attempts and the known rabbit-web-workerd database fault
- **Undo:** Nothing to undo; the agents only read public sources and wrote their normal state files
- **Ref:** ~/RabbitOS/logs/research-agents-hour-2026-10-16.log
