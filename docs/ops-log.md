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

### 2026-10-16 09:41 UTC - Donations reopened on the front page, site and app
- **Did:** Reopened public donations at the owner's request: workers/wallet/donations.json open=true; rabbitsoftware.io front page shows both addresses with copy buttons and 'Open in wallet' links (bitcoin: and ethereum: links open the visitor's own wallet app), /donate and wallet.json are back, the Donate link and invitations are restored (blockchain page keeps Layer 4 as planned); the app shows the Donate card, link and /donate again (DONATIONS_OPEN=true). Updated docs, catalog, hub help and platform map; redeployed site, app, hub, status and audit jobs; re-applied the map to Supabase. Not promoted yet
- **Checked:** site 18 tests (1 skipped), wallet 57, app 369, catalog 13, hub 47, audit 48; live headless Edge: front page, /donate, app dashboard and app /donate all show bc1qxudt9x4hcftvwkfryln2qhn4e5g2qvt09mlp56 with Open in wallet links for bitcoin and ethereum, 0 CSP violations, 0 console errors
- **Undo:** Set open to false in workers/wallet/donations.json, run node workers/wallet/build-donate.mjs, restore the pause page text from git commit 5d29393, deploy site and app
- **Ref:** workers/wallet/donations.json

### 2026-10-16 09:50 UTC - Browser-wallet payment button (non-custodial) for Ethereum
- **Did:** Added 'Send from my wallet' to the front page, /donate and the app card: the visitor's own browser wallet (MetaMask, Coinbase Wallet, Rabby etc., any EIP-1193 provider) is asked to switch to Ethereum mainnet and send the typed ETH amount straight to the donation address (no contract data, amount 0 to 100 ETH, 18 decimals). Bitcoin keeps the bitcoin: 'Open in wallet' link. No payment processor is linked, so every payment lands directly in the Cloud KMS wallet and the watcher records it. Fixed a bug the new test caught: the generated script lost its regex backslashes (copyScript is now String.raw), and the generator now replaces stale scripts and styles on the front page. Deployed site and app
- **Checked:** wallet 59 tests, site 18, app 369 (4 new in eth-pay.test.mjs); live headless Edge with a stubbed wallet on rabbitsoftware.io and app dashboard: wallet asked for accounts, mainnet switch, then eth_sendTransaction to 0x724D...9372 value 0x2386f26fc10000 (0.01 ETH), 0 CSP violations, 0 console errors; no real transaction made
- **Undo:** Revert the commit; redeploy site and app
- **Ref:** workers/wallet/build-donate.mjs, src/lib/eth-pay.ts

### 2026-10-16 09:55 UTC - Wallet and explorer links on the donation block
- **Did:** Added to the front page, /donate and the app card: 'Check the balances yourself' links (mempool.space for the Bitcoin address, Etherscan for the Ethereum address) and a 'Do not have a wallet yet?' list of plain links to MetaMask, Exodus, Trust Wallet, Ledger, Trezor and the bitcoin.org and ethereum.org wallet guides. Links open in a new tab with rel noopener noreferrer, https only, no referral parameters, labelled as not endorsements. List lives in workers/wallet/wallet-links.json and is generated into the pages and the app. Deployed site and app
- **Checked:** wallet 60, site 18, app 369 tests; live headless Edge on rabbitsoftware.io, /donate and the app dashboard: all 9 outside links present, 0 CSP violations, 0 console errors
- **Undo:** Revert the commit and redeploy; or empty the lists in wallet-links.json and rebuild
- **Ref:** workers/wallet/wallet-links.json

### 2026-10-16 09:59 UTC - Community links on the website
- **Did:** Added links to the Reddit community (r/Rabbtisoftware, spelled exactly as supplied) and the GitHub profile (therealsickonechase-bit) to the front page resources list and a Community row in the press kit; both open in a new tab with rel noopener noreferrer; deployed Pages production
- **Checked:** site tests 19 pass (new test covers the links); both links present on / and /press on the live site; GitHub profile answers 200; reddit.com blocks automated checks (HTTP 403), so the subreddit's existence was not verified
- **Undo:** Remove the two anchors from site/index.html and site/press.html and redeploy
- **Ref:** site/index.html, site/press.html
- **Note:** The subreddit name is spelled Rabbtisoftware (no second i); confirm it is the intended spelling

### 2026-10-16 10:05 UTC - Repositories made public; website links fixed
- **Did:** At the owner's request made rabbit-web and rabbitsoftware-cloudflare public on github.com/therealsickonechase-bit after scanning the full history of all branches (no real secrets: only fake test values and the owner's email in docs; no values from the local env files appear anywhere in history). The vault repos (rabbitos-vault, RABBIT-SOFTWARE, RABBITSOFTWARE) stay private (anonymous 404). Added a UPL-1.0 LICENSE to both. Repointed the website links (front page, local, development) to the public repos; the About page now links the GitHub profile and the two public repos; removed the links to repositories that cannot be opened (setup.html component links, MaxwellDNA and two others) because those live under the separate GitHub account ringquistchase-collab that this session cannot access. Added a site test that checks every GitHub link
- **Checked:** site tests 20 pass; anonymous requests to both repos return 200 and to the vault repos 404
- **Undo:** Make a repository private again with gh repo edit --visibility private (copies, forks and caches that already exist cannot be recalled); revert the site commit
- **Ref:** gh repo edit, site/*.html

### 2026-10-16 10:12 UTC - GitHub migration to the main account
- **Did:** Moved every local repository whose origin was ringquistchase-collab to a PRIVATE repository of the same name under therealsickonechase-bit, with all branches, tags and history: research-agents (62 commits incl. the 6 that were unpushed, 11 branches), cancer-mutation-blockchain, chat-scripts, dna-chain, dna-mirroring-workspace, email-app, github-vault-sync. The old remote is kept in each repo as legacy-collab and origin now points to the main account; updated the clone URL in cancer-mutation-blockchain. rabbit-web, rabbitsoftware-cloudflare and rabbitos-vault were already on the main account
- **Checked:** for each repo: main on the new remote equals local main, branch counts listed, all private; gh repo list shows the 7 new repos
- **Undo:** git remote set-url origin the legacy-collab URL in a repo; delete a migrated repo with gh repo delete
- **Ref:** migrate-repos.sh
- **Note:** Not migrated: the Obsidian vault repo (obsidian-rabbitos-vault, 3 GB of history, holds secrets) and repos that exist only under ringquistchase-collab with no local copy (MaxwellDNA, ISLES_2022_FT, Free-AI-Powered-Recording-Transcription, RABBIT-SOFTWARE)

### 2026-10-16 10:20 UTC - Vault moved to the main GitHub account; cloud mirror prepared
- **Did:** Migrated the Obsidian vault repository to a PRIVATE repo therealsickonechase-bit/obsidian-rabbitos-vault: 197 commits pushed in 5 stages (about 1.3 GB, no file over 52 MB), local origin now points there (old remote kept as legacy-collab), so the PC task RabbitOS GitHub Vault Sync (every 5 minutes) pushes to the main account without any change. The Obsidian Git Sync plugin is NOT changed: it talks to github.com with its own account name and token, and its autoSync is off. Built the cloud mirror: Cloud Run job rabbit-vault-mirror (hourly :40) that clones the vault repo with a read-only GitHub token from Secret Manager and copies it to gs://rabbitsoftware-io-vault-private/github-mirror/ (never .git, Local/EEG, Local/RabbitOS folder; refuses an almost empty clone), with a failure alert; two scripts (Setup-GcpVaultMirrorSecrets.ps1 for the token, Setup-GcpVaultMirror.ps1). Updated catalog (245 commands), hub help, platform map (applied to Supabase), redeployed the hub. The mirror is NOT deployed yet: it waits for the read-only token that only the owner can create
- **Checked:** remote main equals local main (3e00793c), repo private (anonymous 404); mirror tests 4 pass (excluded folders, empty-clone refusal, failed clone, token never printed); both scripts pass -WhatIf; catalog 13, hub 47, audit 48 tests
- **Undo:** Vault: git remote set-url origin the legacy-collab URL and delete the new repo with gh repo delete; mirror: not deployed, nothing to undo
- **Ref:** workers/vault-mirror-job, Setup-GcpVaultMirror*.ps1

### 2026-10-16 10:29 UTC - Obsidian to Google Cloud communication verified; vault GitHub sync repaired
- **Did:** Verified the whole path end to end: wrote a marker note (Ops/GC link check.md) in the Obsidian vault, ran the vault upload task, re-indexed, and found the note through Vertex AI Search. Found and fixed a break: the PC task 'RabbitOS Vault sync' (every 30 minutes) had been aborting since at least 2026-10-15 23:32 (65 aborts, last vault commit 2026-10-14) because its privacy guard asked GitHub about the hard-coded repository rabbitsoftware-io/obsidian-rabbitos-vault, which the signed-in account cannot see (404). The guard now reads the repository from the vault's own origin (therealsickonechase-bit/obsidian-rabbitos-vault, confirmed private) and still aborts if it cannot confirm private. After the fix the task committed and pushed to the main account (remote main equals local main)
- **Checked:** marker note in gs://rabbitsoftware-io-vault-private/vault/Ops within 100 s of the upload task (result 0); search for the marker returned the note; vault sync task result 0, local HEAD 99caf8bf equals origin/main; upload bucket holds 2409 objects
- **Undo:** Restore the old guard line in Tools/sync-vault.ps1 (it would abort again); delete Ops/GC link check.md if unwanted
- **Ref:** Tools/sync-vault.ps1 in the vault

### 2026-10-16 10:35 UTC - Vault pathways mapped into the platform map
- **Did:** Read the vault's own pathway notes (Pathways/, Platform/) and wrote docs/vault-pathways.md joining them with the Google Cloud side: 6 pathways that exist (vault to private GitHub repo, to the private bucket, to Vertex AI Search, the undeployed GitHub-to-bucket mirror, the vault-agent job queue, the public architecture map) and the options for a cloud-to-local path. Added the vault repository and the vault search app to the platform map with their connections (59 nodes, 97 connections, 55 roadmap items), applied it to Supabase, redeployed the status and audit jobs, linked the doc from the README. Read-only on the vault; nothing built for the inbound path yet
- **Checked:** audit 48 tests pass; map applied (committed); pathways 1 to 3 were verified end to end earlier today
- **Undo:** Revert the commit and re-apply the previous map seed
- **Ref:** docs/vault-pathways.md

### 2026-10-16 10:48 UTC - End-to-end pathway check (VS Code, local, GitHub, Google Cloud, network, research, blockchain)
- **Did:** Added scripts/pathways-check.mjs: about 30 read-only checks across VS Code and the four local projects, GitHub, Google Cloud, the network, research and the chains, with --report (saves to ~/RabbitOS/logs and gs://rabbitsoftware-io-reports/pathways/latest.json) and --roundtrip (follows one marker note, Ops/Pathway check.md, from the vault to the Google Cloud bucket and through search). Added VS Code tasks (.vscode/tasks.json and the shared RabbitOS.code-workspace): pathway checks, the three test suites, and an ops-log prompt. Updated docs/vault-pathways.md and the catalog (246 commands); redeployed the hub. Found while running it: the PC task RabbitOS Daily Backups was killed by its one-hour limit on 2026-10-15 (the local platform backup step did not finish; the cloud backup job covers Supabase, D1, KV and R2), and the library publisher task RabbitOS GitHub Vault Sync has reported 'repository errors' since 2026-10-14. The vault-agent task, which had failed against the old remote, now succeeds
- **Checked:** pathway tests 5 pass; full run with round trip: 27 passed, 2 to look at, 0 failed of 29; the marker note reached the bucket and search found it; catalog 13, hub 47 tests
- **Undo:** Delete scripts/pathways-check.mjs, .vscode/tasks.json and the tasks block in RabbitOS.code-workspace; delete Ops/Pathway check.md from the vault
- **Ref:** scripts/pathways-check.mjs

### 2026-10-16 11:07 UTC - Local-to-Google-Cloud coverage audited; EEG backup exception recorded
- **Did:** Checked what the PC sends to Google Cloud: vault notes hourly (only what the Git sync takes, without Local/EEG and the PC folder view), nightly backup of the public ledger, datasets, Maxwell and research files, Supabase and Cloudflare, and git bundles of the repositories; Downloads, Desktop, OneDrive, AppData and most of Documents are not backed up. Found that the nightly Maxwell step also uploads raw EEG (eeg_data 265 MB, eeg_runs 14 MB) and selfdata to the private backups bucket, which conflicts with the project rule that personal data stays on the PC. The owner chose to keep backing them up, so it is recorded as a deliberate exception in docs/vault-pathways.md. Nothing was changed
- **Checked:** read of Sync-RabbitGcs.ps1, Sync-VaultToGcs.ps1, the bucket listing and local folder sizes
- **Undo:** Remove eeg_data, eeg_runs and selfdata from MaxwellDirs in Sync-RabbitGcs.ps1 and delete maxwell/current/eeg_data, eeg_runs and selfdata from the bucket (all versions)
- **Ref:** docs/vault-pathways.md

### 2026-10-16 12:21 UTC - Hugging Face connected to the platform and backed up to Google Cloud
- **Did:** Installed the hf CLI on the PC (huggingface_hub 2.2.0) and signed in again at the owner's request with the device code flow (account Therealsickonechase-bit; the token stays in the PC's Hugging Face cache and is never sent anywhere). Inventory: 5 models (incl. Llama-3.2-3B-RabbitSoftware-GGUF), Space rabbitos-eeg-qwen-image (running on ZeroGPU), 3 datasets (2 private), 4 buckets (RabbitAI 1.7 GB). Built scripts/powershell/Backup-HuggingFace.ps1 and the task 'RabbitOS Hugging Face to Google Cloud' (nightly 02:30, 6 h): downloads every bucket and dataset with the hf CLI and copies them to gs://rabbitsoftware-io-backups/huggingface/ (adds and updates only). First full copy: 1.82 GB of buckets and the datasets, 0 failed items; a rerun through Task Scheduler also finished with result 0. Fixed two task-only failures found on the way: hf prints its sign-in status in a different format when the process has a console, and the PATH may be shorter. Added the hub tool huggingface_status (public metadata and whether the Space runs; private datasets are never read), a Hugging Face group in the pathway check, docs/huggingface.md, platform map nodes and edges (62 nodes, 102 connections, applied to Supabase), the catalog entry (248 commands), redeployed the hub, status and audit jobs and the app
- **Checked:** hub tests 49 pass (2 new), catalog 13, audit 48, pathway tests 5; live hub call returns spaceRunning true with the model, Space and the public dataset; private datasets reported as private; scheduled task result 0 with failed items 0
- **Undo:** Backup-HuggingFace.ps1 -Remove deletes the task; delete huggingface/ in the backups bucket (all versions); revert the commit
- **Ref:** scripts/powershell/Backup-HuggingFace.ps1, docs/huggingface.md
- **Note:** The Space still lists rabbitsoftware.io as a custom domain with an expired challenge; remove it in the Space settings if unused

### 2026-10-16 12:27 UTC - Google Cloud records the PC jobs and their cache sizes
- **Did:** Added scripts/powershell/Write-CloudLog.ps1 and wired it into the daily backups, the personal folders backup, the Hugging Face backup and the hourly vault upload: each run now writes one structured entry (job, result, duration, counts and the size of its local cache/staging folders) to Cloud Logging, log rabbit-pc-jobs. Set up with Setup-GcpPcJobLogging.ps1: log bucket pc-jobs (365 days instead of the default 30), a sink, the metric pc_job_failed and an email alert 'a backup or sync on the PC failed'. Never throws: if Google Cloud is unreachable the job carries on. Only names, counts and sizes are logged
- **Checked:** wrote a test entry and read it back from Cloud Logging (cache sizes included, hf-stage 1735.9 MB in 158 files); all six scripts parse; catalog 13 and hub 49 tests pass
- **Undo:** Remove the Write-CloudLog lines from the four scripts; delete the sink rabbit-pc-jobs, the bucket pc-jobs, the metric pc_job_failed and the alert policy
- **Ref:** scripts/powershell/Write-CloudLog.ps1

### 2026-10-16 12:30 UTC - Source control cleaned: 21,574 pending changes explained and resolved
- **Did:** VS Code showed over 10,000 changes: 21,574 untracked files in research-agents (21,355+ from the .venv-eeg Python virtual environment, 136 from eeg_data/MNE-eegbci-data, 35 in eeg_runs, 8 in data/slc6a4_pkg) and 2 in rabbit-web (.claude/worktrees, a stray Hello-World clone). None of that is source code, so none was committed: added ignore rules (research-agents: .venv*/, eeg_data/, eeg_runs/, selfdata/, twinnet/, data/; rabbit-web: .claude/worktrees/, /Hello-World/). The EEG, self data and datasets are already copied to the private Google Cloud backups bucket by the nightly backup; the virtual environment is reproducible and is not backed up. Committed and pushed the real changes: .gitignore, the Maxwell chain (blocks 4 to 6 mined by the daily backup) and the newest web snapshot. rabbit-web is public, research-agents private
- **Checked:** git status shows 0 changes and 0 unpushed in rabbit-web, research-agents and rabbitsoftware-cloudflare
- **Undo:** Remove the added lines from the two .gitignore files (the files become untracked again)
- **Ref:** .gitignore

### 2026-10-16 12:57 UTC - Agents in Google Cloud and listed in the Agent Registry
- **Did:** Found that the Google Cloud Agent Registry API (agentregistry.googleapis.com, v1alpha) is already enabled on the project; it lists agents, MCP servers and skills and accepts user registrations as 'services' (A2A agent card, MCP tool spec). Built an A2A (Agent2Agent) server, workers/agent-a2a, that wraps the hub's read-only live search of PubMed, Europe PMC, ClinicalTrials.gov and openFDA (stores nothing, no secrets), and deployed it as Cloud Run service rabbit-research-agent (service account with no roles, public, max 2 instances) with Setup-GcpResearchAgent.ps1. Wrote Register-AgentRegistry.ps1 and scripts/agent-registry.json and registered the Research Agent (from its live agent card) and the Hub MCP (from its live 25-tool list) in the registry (location global); a second run updates them. Documented every agent and how to reach and deploy it in docs/agents.md (Google Cloud, the owner's PC, Cloudflare, Hugging Face). Added catalog entries (254 commands), a hub help topic, map nodes and edges (64 nodes, 109 connections, applied to Supabase), an Agents group in the pathway check; redeployed hub, status, audit and the app. The PC agents are intentionally not registered: they have no public URL and sit next to personal data
- **Checked:** A2A server tests 5 pass; live: agent card valid, message/send returned 5 PubMed results for SLC6A4; registry lists 'RabbitOS Research Agent' under agents and 'RabbitOS Hub (MCP)' under mcpServers; hub 49, catalog 13, audit 48, pathway 5 tests pass
- **Undo:** Register-AgentRegistry.ps1 -Remove (registry entries only); gcloud run services delete rabbit-research-agent; delete service account rabbit-research-agent
- **Ref:** docs/agents.md, workers/agent-a2a

### 2026-10-16 13:12 UTC - Task worker moved into Google Cloud; personal folders backup complete
- **Did:** Moved one PC agent into Google Cloud: the task worker now also runs as Cloud Run job rabbit-task-worker every 5 minutes (Setup-GcpTaskWorker.ps1, image of nine research-agents files plus biopython). It claims one approved task from the RabbitOS queue, runs it against PUBLIC sources only (PubMed, Europe PMC, ClinicalTrials.gov, NCBI RefSeq), and sends back a proposal the owner approves on the website; its service account has no project roles and reads only the ingest secret. The PC task can keep running as a second worker (the queue gives each task to one worker) or be disabled. The other PC agents stay local on purpose: anything reading EEG, wearables, labs or self data, and the local-file syncs; the research explorers can move next but need their topic queue and corpus state moved off local files first. Updated docs/agents.md, catalog (256 commands), hub help, platform map (65 nodes, 112 connections, applied), pathway check (task worker group) and redeployed hub, status, audit and app. The personal folders backup also finished: Downloads 1.19 GB, Desktop 0.39 GB, Documents 0.33 GB, Pictures 2.46 GB, AppSettings, 0 failed folders; the old C:/Users/odaat/Documents folder uploads nothing (the vault is excluded)
- **Checked:** job executed twice from the scheduler with exit 0 and 'no tasks' (the signed claim reached the app); pathway check shows the task worker's last run 2 minutes old and succeeded; catalog 13, hub 49, audit 48, pathway 5 tests pass
- **Undo:** gcloud scheduler jobs delete rabbit-task-worker-5min; gcloud run jobs delete rabbit-task-worker; delete service account rabbit-task-worker
- **Ref:** scripts/powershell/Setup-GcpTaskWorker.ps1, workers/task-worker-job

### 2026-10-16 13:40 UTC - Research explorer and private EEG analysis moved into Google Cloud
- **Did:** Built cloud_explorer.py (research-agents repo, 10 tests): a stateless explorer that reads the queued topics from the RabbitOS app (public data hub table research_topics), explores up to two on public sources (PubMed, Europe PMC, ClinicalTrials.gov) and ingests topic-explored, run and records through the signed ingest. This is the answer to the state problem: it keeps no files, the app is the shared state, and the ingest upserts by id, so PC and cloud explorers cannot overwrite each other. Deployed as Cloud Run job rabbit-research-explorer (hourly at :20; service account with no roles, reads only the ingest secret) with Setup-GcpResearchExplorer.ps1. First run explored breast cancer ATM and FOXA2 (30 and 20 records); the app now shows both as explored by the cloud-explorer node and research_records rose from 597 to 646. Built the private EEG sample analysis (workers/eeg-analysis-job, 8 tests, numpy-only EDF reader checked on real PhysioNet files): Cloud Run job rabbit-eeg-analysis (weekly, no URL, not in the registry) whose account can read only maxwell/current/eeg_data and eeg_runs and write only analysis/eeg/ in the private backups bucket; first run: 135 recordings from 27 volunteers, alpha eyes-closed/eyes-open ratio 2.8, classifier held-out accuracy 53%. Finding: eeg_data is the public PhysioNet sample dataset, eeg_runs a classifier trained on it, selfdata only importer code; the owner personal EEG notes are in the vault and are not uploaded, so the earlier EEG backup exception is far smaller than described (docs and notes corrected). The BrainFlow bridge (physical headset) and the vault agents stay on the PC; the file-based syncs stay on the PC because they are about the PC files. Updated docs/agents.md, catalog (260 commands), hub help, platform map (67 nodes, 116 connections) and redeployed hub, status, audit and app
- **Checked:** explorer unit tests 10 pass and a live dry run chose two real topics; live run exited 0, the app lists ATM and FOXA2 as explored at 13:24 by cloud-explorer; EEG tests 8 pass; EDF reader on real files gave 64 channels, 160 Hz, alpha ratio 2.8; cloud run wrote analysis/eeg/summary.json; catalog 13, hub 49, audit 48 tests pass
- **Undo:** gcloud scheduler jobs delete rabbit-research-explorer-hourly and rabbit-eeg-analysis-weekly; gcloud run jobs delete rabbit-research-explorer and rabbit-eeg-analysis; delete the two service accounts; delete analysis/eeg/ in the backups bucket
- **Ref:** scripts/powershell/Setup-GcpResearchExplorer.ps1, Setup-GcpEegAnalysis.ps1, research-agents/cloud_explorer.py

### 2026-10-16 13:44 UTC - PC task worker disabled
- **Did:** Disabled the Windows scheduled task 'RabbitOS Task Worker' at the owner's request; the cloud task worker (rabbit-task-worker, every 5 minutes) now handles the task queue alone. There is no scheduled explorer task on the PC (the explorers were run by hand), so nothing else to disable; 'RabbitOS Research Sync' stays because it sends the PC's own files to the app
- **Checked:** cloud task worker ran 3 times in the last 10 minutes, all succeeded; the PC task shows Disabled
- **Undo:** Enable-ScheduledTask -TaskName 'RabbitOS Task Worker'
- **Ref:** Windows Task Scheduler

### 2026-10-16 13:54 UTC - Google Cloud + PC
- **Did:** Added a PC-to-cloud echo: Cloud Run job rabbit-echo (Scheduler every 5 min, account rabbit-echo with only the ingest secret and the echo/ prefix of the reports bucket) and scheduled task RabbitOS Echo (every 5 min) exchange HMAC-signed counters and nonces through gs://rabbitsoftware-io-reports/echo/. No network path between the two.
- **Checked:** Ran both sides: cloud heard PC (seq 1), PC heard cloud, cloud confirmed its message was acknowledged in 70 s; status files echo/pc|cloud/status.json
- **Undo:** Run-Echo.ps1 -Remove; gcloud scheduler jobs delete rabbit-echo-5min; gcloud run jobs delete rabbit-echo; delete service account rabbit-echo
- **Ref:** Setup-GcpEcho.ps1, Run-Echo.ps1, research-agents/echo_link.py

### 2026-10-16 14:10 UTC - RabbitOS + Google Cloud
- **Did:** Finished the echo rollout: pathway-check probe, docs/agents.md row, 3 catalog entries (264 commands), hub help entry, platform map nodes/edges (69 nodes, 120 edges, applied to Supabase), redeployed hub, status feed, audit workflow and the app.
- **Checked:** pathways-check echo probe PASS (both sides heard and acknowledged, fresh); catalog, hub (49) and qa-audit (48) tests pass; hub health ok
- **Undo:** Revert the commits and redeploy; Supabase graph rows can be re-seeded from the previous seed
- **Ref:** rabbit-web and rabbitsoftware-cloudflare commits

### 2026-10-16 14:20 UTC - Research agents + Google Cloud
- **Did:** Added staging to the echo (stage_box.py): tasks and notes for an agent wait, signed, in gs://rabbitsoftware-io-reports/echo/stage/<agent>/; the PC echo step (every 5 min) copies new items into ~/RabbitOS/staged/<agent>/ and writes a receipt, so stopped agents or a PC that was off still receive them. Text only, never executed; expired and old items swept. Catalog 267 commands, docs, hub help and map updated; hub and app redeployed.
- **Checked:** 9 unit tests; live test: staged an item, Run-Echo delivered it to the local inbox and wrote the receipt, then test data removed
- **Undo:** Remove the staging lines from Run-Echo.ps1; delete echo/stage/ in the reports bucket; revert commits and redeploy
- **Ref:** research-agents/stage_box.py, Run-Echo.ps1
