# The Maxwell chain: format, mining requirements and rules

Written 2026-10-17 from the code as it is (`maxwellblockchain.py`, `maxwell_research_anchor.py`, `rabbitweb_miner.py`, `maxwell_chain_sync.py`, `maxwell_adopt.py`) and checked against the live chain with `scripts/verify-maxwell.py`. It documents what exists. It does **not** add a `chain_id` or any new field: `site/chain-identifiers.md` says the Maxwell format has no global chain ID and that none should be minted. Identify a chain by its genesis hash and its verified linkage.

## 1. Files

| File | Where | Meaning |
|---|---|---|
| `maxwell_chain.json` | the owner's PC; public copy at `https://rabbitsoftware-io-ledger-public.storage.googleapis.com/maxwell/maxwell_chain.json`; the app keeps a mirror | `{"anchor_sha256", "anchor_verified", "anchor_message", "difficulty", "blocks": [...]}` |
| `anchor_snapshots/block-NNNN.ndjson.gz`, public at `.../maxwell/snapshots/` | PC and public bucket | the exact record set each research anchor covered |
| `rabbitweb_snapshots/` | the miner that made the block (PC; not yet published) | the platform snapshot each web block covered |

## 2. A block

Six fields, no others (the app refuses extras):

| Field | Type | Rule |
|---|---|---|
| `index` | whole number | 0 for genesis, then +1 |
| `timestamp` | number (Unix seconds, fractional) | should not be earlier than the block before (`verify-maxwell.py` reports it as a note) |
| `transactions` | list | at most 20 |
| `previous_hash` | 64 lowercase hex | hash of the block before (`"0"*64` for genesis) |
| `nonce` | whole number ≥ 0 | found by mining |
| `hash` | 64 lowercase hex | see below |

**Hash rule.** `hash = SHA-256( json.dumps({index, timestamp, transactions, previous_hash, nonce}, sort_keys=True) )` as UTF-8, lowercase hex, with Python's default JSON separators (`", "` and `": "`) and default `ensure_ascii=True`. Another language must reproduce that text exactly, including Python's shortest round-trip form for the float `timestamp` (for example `1792190554.8155015`). `scripts/verify-maxwell.py` is the reference implementation; check any other implementation against it.

**Genesis (block 0).** `previous_hash` all zeros, `nonce` 0, one transaction `MAXWELL_GENESIS` with `immutable_anchor_sha` = SHA-256 of the text `hello world` (`b94d27b9…cde9`).

**Proof of work.** The chain file carries `difficulty` (currently **2**). Every block after genesis must have a `hash` that starts with that many `0` hex digits. At difficulty 2 a miner needs about 256 tries, a fraction of a second. This is deliberately light: it makes rewriting history visible and a little costly, it is **not** a security claim. The outside witness is Bitcoin (see `docs/anchoring.md`). The research-anchor miner only accepts a chain whose difficulty is a whole number from 0 to 5.

## 3. Transactions (the kinds that exist)

A transaction is an object of at most 12 fields; field names are letters, digits or `_`, up to 40 characters; values are strings (up to 1,000 characters) or finite numbers. A whole block may not exceed 20,000 bytes. The anchor miners refuse any field name containing `token`, `secret`, `key`, `email` or `password`. No personal data, wallet secrets or private payloads belong in any block.

| `sender` | Meaning | Fields |
|---|---|---|
| `MAXWELL_GENESIS` | block 0 | `recipient`, `amount`, `note`, `immutable_anchor_sha`, `verification` |
| `RESEARCH_ANCHOR` | Merkle root of the public research records | `recipient` (NETWORK), `amount` (0), `note`, `root`, `count`, `source`, `leaf_rule` |
| `RABBITWEB_MINER` / `RABBITWEB_MINER_CLOUD` | Merkle root of the public platform snapshot, mined on the owner's PC / by the Google Cloud job | `recipient`, `amount`, `note`, `root`, `count`, `nodes_up`, `nodes_total`, `datasets`, `research_rows`, `chain_ok`, `leaf_rule` |

**Research leaf rule.** leaf = SHA-256 of the compact JSON (`separators=(",", ":")`, sorted keys, `ensure_ascii=False`) of the seven fields `id, source, title, url, topic_id, run_id, first_seen_at`; leaves sorted by `id`; parent = SHA-256(left + right); an odd last node is duplicated; one leaf is its own root.

**Web snapshot leaves** (unique key `k`): `node:<name>` (page or service answered), `dataset:<id>`, `chain:app`, `chain:mirror`, `chain:consistent` (the RabbitOS ledger head and its copies), `research:counts`, `code:<repo>` (git commit), `map:platform`, `catalog:commands`, `toolbox:manifest`, `dna:index`, `echo:daily`, `backup:cloud`, `research:recent`, `research:topics`. Only hashes, counts and fixed words; nothing time-dependent, so an unchanged platform gives an unchanged root and the chain does not grow.

**When a block is mined.** Only when something changed: a new research anchor if the root or count differs from the newest one, a new web snapshot if its root differs from the newest one of its kind. Nothing is mined on a timer.

## 4. Who may mine, and what it takes

Mining here is **not open and not rewarded**. Blocks carry `amount 0`; there is no coin. A block becomes part of the public chain only if the app's mirror accepts it, and pushing needs the owner's ingest secret (`RABBIT_INGEST_SECRET`). So the miners are the owner's:

| Miner | Where | What it mines |
|---|---|---|
| `maxwell_research_anchor.py --apply` | owner's PC (nightly job, step "Maxwell: research anchor") | research anchors, and now saves the exact record set (`anchor_snapshots/`) |
| `rabbitweb_miner.py --apply` | owner's PC (nightly job) | web snapshots (`RABBITWEB_MINER`) |
| `rabbit-miner` Cloud Run job | Google Cloud, 05:00 Los Angeles time | web snapshots (`RABBITWEB_MINER_CLOUD`) |

To run a miner: Python 3.12; the `research-agents` files (`maxwellblockchain.py`, `maxwell_research_anchor.py` or `rabbitweb_miner.py`, `maxwell_chain_sync.py`, `maxwell_links.py`, `http_util.py`); network access to the public data hub and chain heads; `RABBIT_URL` (default `https://app.rabbitsoftware.io`) and `RABBIT_INGEST_SECRET` to push (never printed, never stored in the repository). CPU and memory needs are negligible. Run dry first (the default) and add `--apply` to append.

## 5. Rules that keep one chain

The app's mirror is the referee: it records **one block per index** and answers HTTP 409 to a different hash for an index it already has. `maxwell_adopt.py` (run before each mining step) applies this on the PC:

1. Read the public copy and verify it fully (numbered 0..n, linked, hashes recomputed). An unverifiable public copy is never adopted.
2. Same as local, or a shorter prefix of it: nothing to do.
3. Local is a prefix of the public copy: adopt it (backup first, atomic write).
4. The two disagree at some index: local blocks from that index on are dropped **only if the mirror has not recorded them**; the public copy wins. If a dropped block was already mirrored, nothing changes and a person must look (exit 2).

This is tested in `test_maxwell_cloud.py` (adopts a longer public chain, an unmirrored fork loses, a mirrored one is refused, an unverifiable chain is never adopted).

## 6. Checking everything

| Tool | Checks |
|---|---|
| `scripts/verify-maxwell.py` | genesis, every hash, every link, the work target, and each research root (from its saved record set, or from today's records for older blocks) |
| `scripts/verify-anchor.py` | an anchor's OpenTimestamps proof against the real Bitcoin block, and its commitment to the saved record sets |
| rabbitsoftware.io/proof | the same Bitcoin re-check, run every five minutes by the status job |
| rabbitsoftware.io/network | the chain, its hash links, anchors and witnesses on one map |
| Hub tool `chain_consistency` | the app, bucket and (on the PC) local copies agree |

## 7. Known limits (said plainly)

- Blocks are **not signed**. `miner_id`-style labels are labels, not authenticated identity. Signing is on the roadmap (`docs/chain-roadmap.md`, step 5).
- There is **no peer-to-peer network**: the mirrors are the app, the Google Cloud bucket and the owner's PC. Anyone can download and verify, but only the owner's miners can add blocks.
- Difficulty is fixed at 2; there is no adjustment rule.
- Platform (web) snapshots exist only on the PC, so those blocks cannot yet be re-checked by others (roadmap step 17).
- A timestamp or a hash shows that data existed in that form at that time. It does not show the data is true.
