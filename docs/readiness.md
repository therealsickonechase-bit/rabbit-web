# Readiness: what is set, what is not, and what needs registering

Checked 2026-10-17. "Verified" means a command or test was run; "not checked" means I could not check it from here.

## Do the verifiers and "other platforms" need any setup? No.

Nothing below needs an account, API key, registration or payment.

| Verifier / platform | Setup needed | Notes |
|---|---|---|
| OpenTimestamps (Bitcoin) | none | Free public calendars; the anchor job already uses three. Proofs verify with `scripts/verify-anchor.py` or the standard `ots` tool. |
| FreeTSA (RFC 3161) | none | Free authority, fair use. Verify with `openssl ts -verify` and the certificates at freetsa.org. |
| Bitcoin block data | none | Read-only public APIs (mempool.space, blockstream.info) used by the verifiers. |
| Block explorers (Etherscan, XRPL) | none, and not used yet | Only relevant once Ethereum or XRP anchoring is funded; they are read-only websites. |
| Search engines | optional | Google Search Console / Bing Webmaster are optional and only affect how the site is found. |

## The chains, one by one

| Chain / witness | State | Evidence |
|---|---|---|
| RabbitOS ledger (hash chain, mirrored to Google Cloud) | **Live** | Copies agree; status page checks every 5 minutes. |
| Maxwell chain (light proof of work, difficulty 2) | **Live, verified** | `verify-maxwell.py`: 14 blocks, every hash, link and work target OK. Light by design: it makes tampering visible, it is not Bitcoin-grade security. |
| Bitcoin via OpenTimestamps | **Live, verified** | 6 anchors confirmed; our status job re-checks them against real Bitcoin blocks (see rabbitsoftware.io/proof). |
| FreeTSA timestamp | **Deployed, first file pending** | Added to the anchor job; appears on the next anchor (when a chain head changes). |
| Ethereum | **Not on** | Needs a little ETH at `0x32bA3432Caff0dac6C88D58Fb2875dc721986b3d`. Mainnet only, by design. |
| XRP Ledger | **Not on** | Needs about 1 to 2 XRP (base reserve is 1 XRP) at `rN8pnpYCaZEQAXE5kL1GC9ThpJYZ8Rd1nX`. Job `rabbit-anchor-chains` is paused. |
| Donation wallet | **Built, empty** | Cloud KMS key, watcher, alerts, lien; no funds have ever moved. |

## Open integrity finding (2026-10-17)

`verify-maxwell.py` rebuilds each research anchor's Merkle root from the public records that existed at the block's time. Blocks 9, 11 and 12 reproduce exactly. Blocks 1, 4 and 7 have the right record count but a different root: some record was edited in place after it was anchored. Block 1 was traced to a single Europe PMC title whose capitalisation was refreshed ("Clinical Implications..." became "Clinical implications..."); with the 14 October backup, block 1 reproduces exactly. Blocks 4 and 7 were not fully traced (the backups do not hold the state from that day). This is not evidence of tampering, but it means an anchor can only be re-checked while the records it covered are unchanged.

**Recommended fix (not built yet):** publish the exact record set used (a snapshot of the seven fields) next to each research anchor in the public ledger bucket, so every future block can be re-checked forever even if the source later edits a record.

## Fixed today

- **Exports corruption.** Every `exports/<date>/*.ndjson` object in the backups bucket was stored as decimal byte values ("123 34 105 ...") because PowerShell 7 returns byte arrays for the ndjson content type. `Sync-RabbitGcs.ps1` now decodes the bytes; 29 existing objects were repaired (the bucket is versioned, so the originals are kept).
- **Nightly backup killed by a wake-up stampede.** Heavy jobs now run one at a time (`Wait-HeavyJobSlot.ps1`).
- **Platform backup D1 listing** retries once and fails with a clear message.

## Google Cloud checklist

| Item | State |
|---|---|
| Cloud Run jobs (11) and services (7) | All latest runs succeeded (verified 2026-10-17). |
| Scheduled jobs | Enabled; `rabbit-anchor-chains-6h` paused on purpose. |
| Backups (platform, Maxwell, toolbox, chats, GitHub bundles, anchors) | Running; the nightly job's first full run since the lock is still to be watched. |
| Audit logs, project lien, key-change alerts, destroy delay | In place (ops log, 2026-10-15/16). |
| Uptime checks | 5 exist (site, app, ledger head, hub, mirror). |
| **Project owners** | **One** (the owner account). Add a second owner or a break-glass plan; the wallet key and every backup live in this project. |
| **Budget alert** | **Not checked** (the Billing API is not enabled for gcloud here). Create one in the console: Billing > Budgets & alerts. |
| Org policy / VPC | Not changed. |

## Other platforms

| Platform | State |
|---|---|
| Cloudflare (Workers, Pages, R2, KV, D1) | Deployed; backed up nightly (D1, KV, R2). Read-only R2 token set. |
| GitHub | Main repos public; 21 mirror repos restored as private under `therealsickonechase-bit`. The `rabbitsoftware-io` org is administered by a suspended account (appeal at support.github.com). |
| Supabase | Nightly dump (about 32 MB) to Google Cloud. |
| Hugging Face | Backup job exists; not re-checked today. |
| Gemini / Antigravity | `agy` signed in; Hub registered. Gemini key for the cloud shell is optional. |

## Next, in order

1. Watch tomorrow's nightly backup (it should show every step in `~\RabbitOS\logs\backup-<date>.log`).
2. Build the per-anchor record snapshot.
3. Add a second Google Cloud owner and a budget alert.
4. Fund the anchor accounts only if and when you want Ethereum and XRP witnesses.
