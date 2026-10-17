# The RabbitSoftware chain: the full tree, what is done, what is missing

Reviewed 2026-10-17. Every state below is one of: **VERIFIED** (a command or test was run and its output seen on that date), **BUILT** (code and tests exist, not re-run today) or **MISSING** (not built, or built but switched off). Where something depends on money it says so. Nothing here needs funds except the two items marked $.

## Progress tracker (updated as work finishes)

State key: **DONE** (finished and checked), **DOING**, **NEXT**, **WAITING** (needs something from the owner), **LATER $** (needs a little money).

| # | Step | State | Last update |
|---|---|---|---|
| 1 | Prove the nightly backup completes end to end | **DONE** | 2026-10-17: full run 09:54 to 10:08 (14.5 min), all 14 steps OK, "failed steps: 0". The first attempt that morning failed because of a bug in my lock helper (caller variable overwritten); fixed and regression-tested. Still worth a glance at tomorrow's scheduled 03:00 run, which is the first one started by Task Scheduler itself. |
| 2 | Put the snapshot manifest hash into the anchors | **DONE** | 2026-10-17: anchor 2026-10-17T151045Z is the first to carry it: 7 saved record sets (blocks 1, 4, 7, 9, 11, 12, 14), manifest `03f29bb2…`. `verify-anchor.py` re-downloaded all 7 and the commitment checks out; the FreeTSA timestamp on the same anchor verifies with `openssl ts -verify` (15:10:49 GMT). Its Bitcoin proof is still pending, as every new anchor is for a few hours; the anchor job upgrades it and the Proof page re-checks it. |
| 3 | `verify-ledger.py` for the RabbitOS ledger | NEXT | |
| 4 | Run the Maxwell verifier as a cloud job; show the result on the Proof page | NEXT | |
| 5 | Sign blocks with a dedicated key | NEXT | |
| 6 | Write down the fork-choice rule (PC and cloud miners) | **DONE** | 2026-10-17: I had listed this as missing; it already exists in `maxwell_adopt.py` (the app mirror is the referee: one block per index, HTTP 409 for a different hash; public copy wins; a mirrored fork needs a person) and is tested in `test_maxwell_cloud.py`. Now written in `docs/maxwell-protocol.md` section 5. |
| 7 | Free second mirror outside Google (daily commit to a public GitHub repo) | NEXT | |
| 8 | Block explorer page on the site | NEXT | |
| 9 | Restore drill from backups alone | NEXT | |
| 10 | Second Google Cloud owner and a budget alert | WAITING | needs the owner in the console |
| 11 | Append-only record versions in Supabase | NEXT | |
| 12 | Fund the Ethereum and XRP accounts; unpause `rabbit-anchor-chains-6h` | LATER $ | |
| 13 | First small wallet test and withdrawal | LATER $ | |
| 14 | Appeal the GitHub suspension (or retire the org) | WAITING | owner |
| 15 | Decide on the cloud-shell Gemini key | WAITING | optional |
| 16 | Network map page (rabbitsoftware.io/network): blocks, hash links, anchors, Bitcoin witnesses, sources | **DONE** | 2026-10-17: live; built only from files already published; 6 new tests (86 total); page script executed against real data in a simulated browser (16 blocks, 6 anchors, 6 Bitcoin witnesses, click/filter/keyboard work). Not seen in a real browser by me: please open it. |
| 17 | Publish the web-snapshot files (`maxwell/web-snapshots/`) and add them to the anchor manifest, so web blocks are re-checkable | NEXT | today those files exist only on the PC |
| 18 | `status/chain-graph.json` from the status job (blocks, anchors, miners, stores, edges) and a time slider | NEXT | |
| 19 | RabbitOS ledger as its own lane, linked through the head hash each web snapshot commits; Ethereum and XRP lanes greyed until funded | NEXT | |
| 20 | Protocol and mining requirements document | **DONE** | 2026-10-17: `docs/maxwell-protocol.md` (block format, hash rule, work target, transaction kinds, who may mine, what a miner needs, fork rule, known limits). Documents what exists; adds no `chain_id` or field, per `site/chain-identifiers.md`. |
| 21 | Share tags and canonical links on the chain pages | **DONE** | 2026-10-17: Open Graph, Twitter card and canonical link on blockchain, proof, network, status and research (only the home page had them); a test keeps them in step with each page's title and description. |
| 22 | Git version tags / releases and GitHub topics for the public repos | WAITING | none exist today; public-facing change, needs your go-ahead |
| 23 | Peer-review model: the witness circle (`docs/peer-review.md`, `scripts/witness.mjs`) | **DONE** | 2026-10-17: independent witnesses re-check the public chain and sign the head (Ed25519); a reader trusts a head when k different witnesses agree and none conflicts. Live: `pc-witness` (PC, runs the Python verifier too) and `cloud-witness` (Cloud Run, own key in Secret Manager) both signed the 16-block head; rule k=2 met; stranger's check exits 0; shown on Proof and Network. 110 status-job tests (22 new), real-chain hash reproduction in JavaScript, conflict/rollback/forgery cases. |
| 24 | Outside witnesses join the circle | WAITING | the model only means something with parties the project does not control; the 5-minute guide is in `docs/peer-review.md` section 6 and on the Proof page |
| 25 | Alert on `witness_conflict` / `witness_refused` / lost quorum | NEXT | |
| 26 | Two independent Bitcoin sources must agree (verifier and status job, optional own Bitcoin Core); PC witness every 6 hours | **DONE** | 2026-10-17: live check passes with mempool.space and Blockstream agreeing on all three blocks; one source is shown as "not counted", disagreement as a red flag; scheduled task `RabbitOS Witness` (00:20, 06:20, 12:20, 18:20). Status job 112 tests. |
| 27 | Maxwell Core phase 0: a read-only node (sync, verify, Bitcoin-Core-style JSON-RPC on loopback with cookie auth, CLI, witness) | **DONE** | 2026-10-17: `maxwell-core/` in rabbitsoftware-cloudflare, zero dependencies; synced the real 16-block chain on this PC; 7 tests (RPC errors, refusal of invalid/shorter/conflicting chains, auth, DNS-rebinding and browser-origin refusal, CLI end to end). Plan: `docs/maxwell-core.md`. |
| 28 | Maxwell Core phase 1: node heartbeats, `status/nodes.json`, a `core:nodes` leaf in the rabbit web snapshot, a Core lane on the Network map, RabbitOS cloud-shell view | **PARTLY DONE** | 2026-10-17: heartbeats, registry, aggregator, Nodes panel and the `core:nodes` leaf are built and tested (items 35, 36, 38); Network-map lane and a RabbitOS app view are NEXT (item 39) |
| 29 | Maxwell Core phase 2: mining and signed blocks inside the Core | LATER | |
| 30 | Always-on node hardware (Raspberry Pi 5 or mini PC with Linux) and packaging (Docker, systemd) | WAITING | owner decision; no custom kernel needed |
| 31 | Maxwell Core for Linux and Raspberry Pi: Dockerfile (amd64, arm64), compose, hardened systemd units, `install.sh`, README guide | **DONE** | 2026-10-17: run in Linux containers: unprivileged, read-only root, no capabilities, 26 MB; ARM64 under emulation gives the same tip hash; installer on a clean Debian (dry run changes nothing, user and permissions, cookie mode 600, `systemd-analyze verify` passes, uninstall keeps data). Not yet on a physical Pi. |
| 32 | Maxwell Core on Google Cloud: public read-only gateway (Cloud Run `maxwell-core`) | **DONE** | 2026-10-17: live at the Cloud Run address; REST and JSON-RPC answer from the real chain; owner methods are refused; CORS open; rate-limited. |
| 33 | rabbitsoftware.io/core: research, networks, data and agents in one page, from the Core gateway and the public files | **DONE** | 2026-10-17: six panels that load and fail independently; 132 status-job tests (8 new); page script run against real data in a simulated browser. |
| 34 | Cloud shell access to the Core | **DONE** | catalog entries (curl against the gateway) in the Maxwell Core group; the cloud shell can also run the CLI with `--url`. |
| 35 | Maxwell Core 0.3.0: signed node heartbeats (`makeHeartbeat`/`verifyHeartbeat`/`evaluateNodes` in `witness.mjs`), `getnodes`, `getheartbeat`, `/rest/nodes.json`, and the commands `status`, `open`, `heartbeat` | **DONE** | 2026-10-17: 16 new tests (4 heartbeat, 6 comms); full status-job suite 157 pass |
| 36 | Node registry `site/nodes/registry.json` and `nodes-live.mjs` in the status job writing `status/nodes.json`; Nodes panel on rabbitsoftware.io/core | **BUILT, NOT DEPLOYED** | 2026-10-17: tests pass and the page renders from fixtures in jsdom; goes live with the next status-job redeploy and site deploy |
| 37 | One ZIP of Maxwell Core with a section per platform (Raspberry Pi `setup-pi.sh`, Linux, Windows, macOS, Docker, Google Cloud) and `COMMS.md`; download page rabbitsoftware.io/maxwell-core | **BUILT, NOT DEPLOYED** | 2026-10-17: `scripts/build-maxwell-core-zip.mjs` (reproducible, self-checking, 12 tests); Pi script tested on arm64 Debian (emulated), Windows installer tested on Windows 11 (no scheduled task registered), Linux installer re-run after the move; macOS written but NOT tested; no physical Pi yet |
| 38 | rabbitweb `core:nodes` leaf (`research-agents/maxwell_links.py`) | **DONE** | 2026-10-17: counts and head hash only; the clock alone never grows the chain |
| 39 | Core lane on the Network map, RabbitOS app view of the nodes, `Run-CoreHeartbeat.ps1` + scheduled task so the PC is a node | NEXT | the PC needs its own node key first (owner step) |
| 40 | Deploy items 36-37: status job (`Setup-GcpStatusFeed.ps1 -RunNow`), Core gateway (`Setup-GcpCore.ps1`), site (Pages deploy) | WAITING | needs your go-ahead |

## 1. The tree

```
L0  SOURCES            public literature and data: PubMed, Europe PMC, ClinicalTrials.gov, openFDA, OpenAlex, INSPIRE-HEP, ClinVar, NIH ...
 └─ L1  COLLECTION     research agents (PC + Google Cloud) -> research_records in Supabase (the shared store)
     ├─ L2a  LEDGER    RabbitOS hash-chained ledger of events (app + public bucket copy)
     └─ L2b  MAXWELL   proof-of-work chain: research anchors (Merkle root + count), platform snapshot blocks, link blocks
         └─ L3  WITNESSES   something outside the project vouches for the chain heads
             ├─ Bitcoin via OpenTimestamps        (free)
             ├─ FreeTSA RFC 3161 timestamp        (free)
             ├─ Ethereum transaction              ($ little ETH)
             └─ XRP Ledger transaction            ($ little XRP)
     └─ L4  VERIFICATION    anyone can re-check without trusting us
         ├─ verify-anchor.py (Bitcoin)   verify-maxwell.py (chain + research roots)   the Proof page (live re-check)
 L5  DURABILITY         Google Cloud (versioned buckets) + GitHub + Cloudflare + Supabase dumps + PC
 L6  OPERATIONS         schedulers, status feed, alerts, locks, logs
 L7  MONEY AND KEYS     Cloud KMS keys, donation wallet, anchor fee accounts
 L8  PEOPLE AND RECOVERY owners, accounts, break-glass
```

## 2. Branch by branch

### L0 and L1: sources and collection

| Step | State | Evidence |
|---|---|---|
| Public sources wired (PubMed, Europe PMC, trials, openFDA, ClinVar, NIH, OpenAlex, INSPIRE-HEP) | VERIFIED | Hub `research_link` returns live results from the new physics sources. |
| Research agents on the PC (sync, task worker, echo) | VERIFIED | Research Sync passed after the lock fix; Task Worker runs every 5 minutes. |
| Research agents in Google Cloud (explorer hourly, task worker every 5 min) | VERIFIED | Latest executions succeeded; memory use 3-6%. |
| Shared store: 1,565 public records, 55 topics explored | VERIFIED | Status feed `research-live.json`. |
| Antigravity physics topic | VERIFIED | 49 records stored (37 papers, 12 preprints). Nightly job now fetches them. |
| Medical-package modules (VCF parser, ClinVar SPDI, trial matcher) | VERIFIED | 9 tests; PC-only by design (personal data). |
| Records can be edited at the source | **MISSING (mitigated)** | Two titles changed after anchoring. Fixed for the future by per-anchor snapshots (section L2b). A fuller fix is append-only record versions. |

### L2a: the RabbitOS ledger

| Step | State | Evidence |
|---|---|---|
| Hash-chained event ledger, app copy + public bucket copy | VERIFIED | `chain_consistency`: length 18 in both, same head hash. |
| Status page compares the copies every 5 minutes | VERIFIED | Status feed `chain.agree`. |
| A ledger verifier anyone can run | **MISSING** | `verify-anchor.py` and `verify-maxwell.py` exist; there is no matching `verify-ledger.py` for the RabbitOS ledger itself (it is checked inside RabbitNet / the app). Small job: a stdlib script that downloads `ledger/chain_ledger.jsonl` and recomputes every hash. |

### L2b: the Maxwell chain

| Step | State | Evidence |
|---|---|---|
| Chain: 14 blocks, every hash, link and work target correct | VERIFIED | `verify-maxwell.py`. |
| Genesis anchor sha256("hello world") | VERIFIED | Same script. |
| Research anchors: root + count of the public records | VERIFIED | Blocks 1, 4, 7, 9, 11, 12 all rebuild exactly. |
| Per-anchor record snapshots so an anchor can be re-checked forever | VERIFIED today | Written at mining time from now on; backfilled and proven for all six existing research anchors; published to `maxwell/snapshots/`. |
| Same chain in the app, the bucket and the PC | VERIFIED | App 14 = bucket 14 (identical hashes); PC has the same 14 blocks. |
| Platform snapshot blocks (the web miner) and link blocks | BUILT | Nightly cloud miner (`rabbit-miner`, 05:00) and PC steps; blocks 2, 3, 5, 6, 8, 10, 13 are of this kind. |
| Difficulty 2 (light work) | BUILT, by design | Makes tampering visible, not expensive. Said plainly on the site. Not a security claim. |
| Blocks are signed by their author | **MISSING** | Blocks carry a hash and a nonce, not a signature, so anyone with write access to the chain file could append a block. A signature by a dedicated key (Cloud KMS or a local ed25519 key) would say "this block came from the project". Verifier gets one more check. |
| Rule for two miners at once (PC and cloud) | BUILT, now documented | `maxwell_adopt.py`: the app mirror is the referee (one block per index, 409 on a different hash), public copy wins, a mirrored fork needs a person; tested in `test_maxwell_cloud.py`; written in `docs/maxwell-protocol.md` section 5. |
| Independent mirror outside Google | **MISSING** | The chain lives in Google Cloud, the app, the PC and (via backups) Cloudflare. Add a free public mirror that is not Google: a public GitHub repo that gets `maxwell_chain.json` + `chain_head.json` committed daily (git history becomes another witness). |

### L3: witnesses

| Step | State | Evidence |
|---|---|---|
| Anchor job (`rabbit-anchor`, every 6 h) builds `anchor.json` from both heads | VERIFIED | 6 anchors. |
| Bitcoin via OpenTimestamps, three free calendars | VERIFIED | All 6 anchors confirmed; our job re-checked 3+ against real Bitcoin blocks; I re-checked one independently. |
| FreeTSA timestamp per anchor | BUILT and deployed | Verified against a real reply with `openssl ts -verify`; the first `.tsr` file will appear on the next new anchor. |
| Anchors cover the **Maxwell** head, not only the ledger | VERIFIED | Anchor of 2026-10-17 07:00 holds Maxwell block 12. |
| Ethereum anchoring | **MISSING $** | Job built, deployed, paused. Needs a little ETH at `0x32bA…b3d`. Mainnet only on purpose. |
| XRP Ledger anchoring | **MISSING $** | Same job. Needs about 1 to 2 XRP (base reserve 1 XRP) at `rN8pn…Rd1nX`. |
| Anchors for the Maxwell **snapshots** | **MISSING** | The snapshot files themselves are not hashed into an anchor. Add the snapshot manifest hash to `anchor.json` so the record sets are covered by Bitcoin too. Small change in the anchor job. |

### L4: verification

| Step | State | Evidence |
|---|---|---|
| `verify-anchor.py` (Bitcoin proof replay) | VERIFIED | 3 tests, live runs on two anchors. |
| `verify-maxwell.py` (chain + research roots from snapshots) | VERIFIED | 5 tests, live run all OK. |
| Proof page with live re-check of anchors | VERIFIED | rabbitsoftware.io/proof, 80 status-job tests. |
| Live re-check of the **Maxwell chain** on the Proof page | **MISSING** | The page re-checks Bitcoin anchors only. The Maxwell check runs in Python; porting it to the status job needs care (Python's JSON text and float formatting must be reproduced exactly), so the safer path is to run `verify-maxwell.py` inside a small Cloud Run job and publish its result as `status/maxwell-verify.json`. |
| A block explorer page (read blocks in a browser) | **MISSING** | The chain files are public, but there is no friendly page listing blocks with their anchors and Bitcoin witnesses. |
| Docs for visitors | VERIFIED | `docs/start-here.md`, `docs/anchoring.md`, `docs/readiness.md`. |

### L5: durability

| Step | State | Evidence |
|---|---|---|
| Google Cloud backups: platform, Maxwell, toolbox, chats, anchors, GitHub bundles | VERIFIED today | Platform backup all parts OK; exports repaired. |
| Nightly job completes end to end | **UNPROVEN** | It was killed by the wake-up stampede on 2026-10-17; the one-at-a-time lock is in. Tomorrow's log is the proof. |
| GitHub: main repos public; 21 mirrors restored as private repos | VERIFIED | Heads match. |
| GitHub organisation `rabbitsoftware-io` | **MISSING** | Administered by a suspended account; appeal pending on your side. |
| Restore drill (rebuild from backups alone) | **MISSING** | Restores were tested for single repos (Maxwell-blockchain) but never end to end. Do one drill: new empty project folder -> restore repos from bundles, load the latest Supabase dump, check the chain verifier passes. |

### L6: operations

| Step | State | Evidence |
|---|---|---|
| 11 Cloud Run jobs, 7 services, 11 schedulers | VERIFIED | All latest runs succeeded; `rabbit-anchor-chains-6h` paused on purpose. |
| Status feed every 5 minutes, uptime checks (5), alert policies | VERIFIED / BUILT | Feed live; uptime checks listed; alert policies per ops log. |
| Heavy PC jobs run one at a time | BUILT | Lock tested (second process waited 18 s). |
| Echo logging on the PC | **UNPROVEN** | No log file for today. |
| Budget alert | **UNCHECKED** | Needs the Billing API; set in the console. |

### L7: money and keys

| Step | State | Evidence |
|---|---|---|
| Donation key in Cloud KMS (HSM), watcher, alerts, lien | VERIFIED | Watcher job succeeding; all four addresses at 0. |
| Anchor signing key (separate, fee money only) | BUILT | Used only by the paused job. |
| Withdrawal tool, allowlist, first small withdrawal | **MISSING $** | Tested with published test vectors; never used. Needs funds. |
| Recovery plan | PARTIAL | Written in `docs/wallet.md`; one project owner only. |

### L8: people and recovery

| Step | State |
|---|---|
| Second Google Cloud owner or break-glass plan | **MISSING** |
| GitHub org admin recovered or org retired | **MISSING (yours)** |
| Gemini key for the cloud shell | optional |

## 3. Everything missing, in the order I would do it

No funds needed:

1. **Watch tomorrow's nightly backup** (log shows every step; confirms the lock fixed it). *Proof it works.*
2. **Hash the snapshot manifest into the next anchors** so Bitcoin covers the saved record sets (anchor-job change, tests, redeploy). *Closes the last hole in the research-root proof.*
3. **Add `verify-ledger.py`** for the RabbitOS ledger (stdlib, tests, link it from the Proof page and docs).
4. **Run `verify-maxwell.py` as a Cloud Run job** and publish `status/maxwell-verify.json`; show "chain re-checked N minutes ago: OK" on the Proof page.
5. **Sign blocks** with a dedicated key; extend both verifiers; publish the public key on the site and in the repo.
6. **Write and test the fork-choice rule** for two miners (PC and cloud).
7. **Free second mirror**: daily commit of the public chain files to a public GitHub repo.
8. **Block explorer page** on the site (blocks, anchors, witnesses).
9. **Restore drill** from backups alone.
10. **Second Google owner** and a **budget alert**.
11. **Append-only record versions** in Supabase (stops in-place edits changing history).

Needs a little money, whenever you choose:

12. Fund the Ethereum and XRP accounts, then unpause `rabbit-anchor-chains-6h` and watch the first run.
13. First small wallet test and withdrawal.

Yours to do:

14. Appeal the GitHub suspension (or decide to retire the org).
15. Decide whether the cloud shell needs a Gemini key.

## 4. What changed today

Verified the Bitcoin anchoring is live and correct; added FreeTSA; built the Proof page, auto-verify and a plain-language digest; wrote `verify-anchor.py` and `verify-maxwell.py`; fixed the corrupted Google Cloud exports; found that two record titles were edited after being anchored and added per-anchor snapshots so it cannot recur; proved all six existing research anchors again from recovered data; fixed the nightly stampede; restored 21 repos as private on GitHub.
