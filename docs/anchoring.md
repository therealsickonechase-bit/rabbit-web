# Anchoring: what is witnessed, by whom, and how to check it

An **anchor** is a small file, `anchors/<id>/anchor.json`, that holds the head hashes of the RabbitOS ledger and the Maxwell chain (public facts only). The anchor job (`rabbit-anchor`, every 6 hours, Cloud Run; code in `workers/anchor-job`) makes a new one whenever either head changed, then gets it witnessed in two independent ways. **None of this costs anything or needs a funded wallet.**

| Witness | What it is | Files |
|---|---|---|
| **Bitcoin via OpenTimestamps** | The SHA-256 of `anchor.json` goes (with a random nonce) to three free public calendars that batch many users' hashes into one Bitcoin transaction. A pending proof is upgraded to a Bitcoin-block proof within hours. | `anchor.json.ots`, status and `bitcoinHeight` in `anchors/index.json` |
| **RFC 3161 timestamp (FreeTSA)** | A signed timestamp from the free FreeTSA authority over the same digest. Not a blockchain: a second, independent trusted witness. Best effort; if the authority is down the Bitcoin anchor still goes ahead. | `anchor.json.tsr`, `tsa` in the index entry |
| Ethereum and XRP Ledger | Same digest in one transaction on each network. **Not switched on**: the signing accounts need a little gas / a 1 XRP reserve. Job `rabbit-anchor-chains` is paused. | `anchors/chains.json` |

All files are public in `gs://rabbitsoftware-io-ledger-public/anchors/` (`https://rabbitsoftware-io-ledger-public.storage.googleapis.com/anchors/...`).

## Check the Bitcoin witness yourself (no account, key or funds)

```
python scripts/verify-anchor.py 2026-10-17T070013Z        # rabbitsoftware-cloudflare; uses only the Python standard library
```

It checks that `sha256(anchor.json)` is the digest the proof is for, replays the proof's hash steps, and compares the result with the Merkle root of the Bitcoin block named in the proof, fetched from Blockstream or mempool.space. Verified on 2026-10-17: the anchor containing **Maxwell block 12** is attested in Bitcoin blocks 971827, 971838 and 971845, and every replayed value equals that block's Merkle root. The standard `ots verify anchor.json.ots` tool does the same with a Bitcoin node.

## What else an anchor now commits to

Since 2026-10-17 `anchor.json` also holds `"snapshots": {"count", "upTo", "manifest"}`: a commitment to the saved record set of every research anchor block (`maxwell/snapshots/block-NNNN.ndjson.gz`). The per-file hashes are published in `anchors/snapshots.json`; the manifest is the SHA-256 of the lines `<block> <sha256>` in block order. So Bitcoin vouches for the exact records each research root was built from, not only for the chain heads. `verify-anchor.py` recomputes the manifest, compares it with the one in `anchor.json`, and re-downloads every covered file to check its hash. First anchor with the commitment: `2026-10-17T151045Z`.

## Check the FreeTSA witness

```
openssl ts -verify -in anchor.json.tsr -data anchor.json -CAfile cacert.pem -untrusted tsa.crt
```

with `cacert.pem` and `tsa.crt` from https://freetsa.org/files/ . Expected: `Verification: OK`. (The query-file form, `-queryfile`, also works.) The reply states the time the authority signed.

## What a timestamp does and does not prove

It proves the fingerprint existed by that time. It does not prove the underlying record is true. Bitcoin and the timestamp authority are witnesses the project does not control.

## Getting the Ethereum and XRP anchors going later

Mainnet only (the code refuses other networks on purpose). The XRP Ledger base reserve is 1 XRP, so about 1-2 XRP activates `rN8pnpYCaZEQAXE5kL1GC9ThpJYZ8Rd1nX`; Ethereum needs a small amount of ETH at `0x32bA3432Caff0dac6C88D58Fb2875dc721986b3d`. Then unpause: `gcloud scheduler jobs resume rabbit-anchor-chains-6h --location us-west2`.
