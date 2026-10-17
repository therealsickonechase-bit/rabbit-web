# The RabbitSoftware chain: the full tree, what is done, what is missing

Reviewed 2026-10-17. Every state below is one of: **VERIFIED** (a command or test was run and its output seen on that date), **BUILT** (code and tests exist, not re-run today) or **MISSING** (not built, or built but switched off). Where something depends on money it says so. Nothing here needs funds except the two items marked $.

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
| Rule for two miners at once (PC and cloud) | **PARTIAL** | `maxwell_adopt.py` takes over the public chain and the app accepts only a block that extends the head, so there are no forks in practice. There is no written fork-choice rule (what happens if both mine at the same height). Write it down and test it. |
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
