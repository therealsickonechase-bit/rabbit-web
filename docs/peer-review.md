# Peer review of the Maxwell chain: the witness circle

Built 2026-10-17. This is how independent parties check the chain and say so in a way anyone can verify, without trusting the project.

## 1. The idea

The project mines the blocks and publishes the chain. Nothing stops a publisher from quietly rewriting history, or showing one version to you and another to me. Public transparency logs (Certificate Transparency, the Go checksum database, Sigsum) solve this with **witnesses**: independent parties that each remember the last head they checked, confirm that every new head *extends* it, and sign it. A reader then trusts a head only when enough different witnesses signed the same one. This model follows the C2SP `tlog-witness` protocol ([spec](https://c2sp.org/tlog-witness@v1.1.0)), simplified for a hash chain. The problem it guards against is called a **split view**: a log serving different histories to different people ([overview of the Certificate Transparency gossip work](https://arxiv.org/pdf/1806.08817)).

What is simpler here: Maxwell is a hash chain, not a Merkle tree, so "this head extends the last one I saw" is just "the block at that position still has the same hash, and every link and work target still verifies". What is *not* copied: the C2SP wire format and signed-note encoding. The cosignature format below is the project's own and is not interchangeable with C2SP witnesses.

## 2. Roles

| Role | Does | Today |
|---|---|---|
| **Author** | mines blocks, publishes the chain (`maxwell_chain.json` in the public ledger bucket) | the project |
| **Witness** | downloads the public chain, re-checks it itself, signs the head it verified | `pc-witness`, `cloud-witness`; anyone can add one |
| **Registry** | the list of witnesses a reader counts (name, public key, where their signature is published) | `https://rabbitsoftware.io/witness/registry.json`, edited through the public repository |
| **Reader** | fetches the chain and the signatures, verifies them itself, applies the rule | the status job (`status/witness.json`), the Proof page, the Network page, `witness.mjs check`, or you |

## 3. What a witness does (and what its signature means)

1. Download the public chain (`maxwell/maxwell_chain.json`, with a cache-buster, because the file is cacheable for an hour).
2. Recompute every block hash exactly as Python does (the format is documented in `docs/maxwell-protocol.md`), check every link, the genesis anchor and the work target.
3. Compare with the last head this witness signed (its *state*): the chain must still contain that same hash at that position. A shorter chain is refused (rollback). A different hash at that position is a **conflict**: two histories exist. It refuses and says so.
4. Sign the head: `Ed25519(message)` where the message is the lines `rabbitos-cosignature/v1`, `witness <name>`, `signed <UTC time>`, the origin `rabbitsoftware.io/maxwell`, the size, and the head hash.
5. Publish the signature file at an https address of its own choosing.

The signature means: *"on this date I downloaded the chain myself, every hash, link and work target is correct, its head at this size is this hash, and it extends what I saw before."* It does **not** mean the research in the chain is true, that the signer is an authority, or that the chain cannot be rewritten (it can be; the witnesses are what make that visible).

A cosignature (`cosignature.json`):

```json
{ "v": 1, "witness": "pc-witness", "keyId": "0c8d2ae65323c735", "origin": "rabbitsoftware.io/maxwell",
  "size": 16, "hash": "0084af86...", "signedAt": "2026-10-17T15:38:20Z", "signature": "<base64 Ed25519>" }
```

`keyId` = the first 16 hex characters of the SHA-256 of the public key (SubjectPublicKeyInfo, DER, base64 in the registry).

## 4. The reader's rule

For each registered witness the reader fetches the signature, verifies it against the registered key, and sets a status:

| Status | Meaning | Counts toward the rule? |
|---|---|---|
| `agrees` | signed the current head, within the last 48 hours | **yes** |
| `behind` | signed an earlier head that is still part of this chain | no (but fine) |
| `ahead` | signed a *longer* chain than the copy the reader holds; the reader's copy may be old (for example a cached file) | no, and **not** an alarm |
| `stale` | signature older than 48 hours | no |
| `conflict` | signed a hash that is **not** in this chain at a position the chain has: a split view or a rewrite | no, and it **withholds trust** from the head however many others agree |
| `invalid` | the signature does not verify under the registered key, or the chain itself does not verify | no |
| `missing` | the file could not be read | no |

A head is **trusted** when at least **k** different registered witnesses (different *keys*; one key under two names counts once) are `agrees` and none is in `conflict`. The registry sets **k** (currently **2**). Any reader can use its own registry and its own k: `node witness.mjs check --registry my-registry.json`.

## 5. Who the witnesses are today, honestly

| Witness | Where it runs | Key | Extra |
|---|---|---|---|
| `pc-witness` | the owner's PC, every 6 hours (scheduled task `RabbitOS Witness`) and in the nightly job | `~\RabbitOS\witness\pc-witness.key` (never leaves the PC) | signs only if **both** the Python reference verifier and the JavaScript witness pass |
| `cloud-witness` | a Google Cloud Run job, every 6 hours at :45 | Secret Manager `cloud-witness-key` (generated in memory and piped in; never on disk) | its service account can write only `witness/cloud-witness/` |

Both are run by the project. They show the mechanism working, they catch accidents and bugs (for example a corrupted copy, a rollback, a mining mistake), and they use different machines, keys, languages (the PC adds Python) and schedules. **They are not independent third parties**, and the project can sign anything it likes. The model gets its real strength only when **outside witnesses** are added to the registry. That is the point of section 6.

## 6. Becoming a witness (about five minutes, no account, no payment)

```
node witness.mjs keygen --name yourname                 # makes yourname.key (keep private) and yourname.pub (public)
node witness.mjs run --name yourname --key yourname.key # checks the public chain, writes yourname.cosignature.json
```

Needs Node 22 or newer and nothing else. Get the single script from `scripts/witness.mjs` in the public repository (it has no dependencies). Run it on a schedule you control (a daily job is plenty). Publish `yourname.cosignature.json` at any https address that always serves the latest version (a GitHub raw file in a repo you own, a gist, your own site). Then open a pull request that adds an entry to `site/witness/registry.json` in `rabbitsoftware-cloudflare`: your `name` (lowercase letters, digits, `.`, `-`, `_`), `kind: "external"`, your `publicKey` (from `yourname.pub`), and the `url`. Before merging the maintainer checks that the name and key are new, the address is https and reachable, and the file verifies and signs the current head. The project may remove a witness that stays unreachable or misbehaves; the history of the registry is in git.

Please run your own copy of the script from a source you have read: it only reads the public chain and signs a small text.

## 7. Where everything is

| What | Where |
|---|---|
| The witness script (also the checker) | `scripts/witness.mjs` (copies in `workers/qa-audit/src/` and `workers/witness-job/`, kept identical by tests) |
| Registry | `site/witness/registry.json` → `https://rabbitsoftware.io/witness/registry.json` |
| Signatures | `…ledger-public…/witness/<name>/cosignature.json` for project witnesses; yours wherever you publish it |
| The result everyone reads | `status/witness.json` (every 5 minutes), shown on `rabbitsoftware.io/proof` and `/network` |
| PC witness | `scripts/powershell/Run-Witness.ps1` (nightly job step) |
| Cloud witness | `scripts/powershell/Setup-GcpWitness.ps1`, `workers/witness-job/` |
| Check as a stranger | `node scripts/witness.mjs check --registry https://rabbitsoftware.io/witness/registry.json` |

## 8. What can go wrong, and what the model does about it

| Risk | Result |
|---|---|
| The author rewrites an old block | every witness that saw the old hash reports `conflict` and refuses to sign; trust is withheld until explained |
| The author shows different chains to different readers (split view) | witnesses that fetched different chains sign different heads; a reader holding either sees `conflict` for the other |
| The chain is rolled back or truncated | witnesses refuse (shorter than they saw); readers see `behind`/`stale` witnesses and `agrees` drops below k |
| A cached or stale copy | witnesses and readers add a cache-buster; a longer signature than the copy read is `ahead`, not an alarm |
| A witness key is stolen | someone could sign for that witness; remove the entry, and add a new key under a new name |
| The project controls the registry | a reader can use its own registry and k; the registry's history is public in git |
| The project's witnesses collude (they are the project) | they prove nothing against the project; only outside witnesses do (section 6) |
| Witnesses only check the chain's structure | they say nothing about whether the research is true |
| Availability | an unreachable witness is `missing`, never a failure of the chain |

## 9. Still to do

- A log-based alert that emails the owner on `witness_conflict` / `witness_refused` from the cloud witness, and when the quorum is lost.
- Outside witnesses (the model's real strength). The owner can invite people who would sign independently, for example a researcher, a university lab or a friend with a spare computer.
- Witness the **RabbitOS ledger** too (`ledger/chain_head.json`) with the same script (a `verify-ledger` first).
- Signed blocks by the author, so a witness can also say who mined a block (see `docs/chain-roadmap.md`).
