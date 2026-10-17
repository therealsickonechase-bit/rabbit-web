# Maxwell Core: one node program for the Maxwell chain

Planned and started 2026-10-17. **Maxwell Core** is a single program that does for the Maxwell chain what Bitcoin Core does for Bitcoin: keep a verified local copy, answer questions about it over a local RPC, and take part in checking it. RabbitOS manages it, rabbitweb tracks it, rabbitsoftware.io shows it.

## 1. Would this work? Honest answer

**Yes, as a node program. No, as a new blockchain network or a kernel.**

- **What already exists is scattered.** Syncing and adopting (`maxwell_adopt.py`, `chain_pull.py`), mining (two Python scripts and a cloud job), verifying (`verify-maxwell.py`, `witness.mjs`), witnessing, publishing (PowerShell and Cloud Run jobs). They work, but an outsider cannot install "the thing" and the owner's PC has to be awake for most of it. One program with one data folder and one RPC makes it installable, monitorable and manageable.
- **What I would not do:** fork Bitcoin Core, or write an operating-system kernel. Bitcoin Core is a currency node secured by thousands of independent miners; Maxwell is a provenance log with no coin. Proof of work with a handful of miners adds no security, and the C++ code base would be a heavy thing to carry for no gain. A kernel is not needed either: Maxwell Core is an ordinary user-space program (Node.js, no dependencies) that runs on Windows, Linux, a Raspberry Pi or a cloud VM.
- **What bare metal is good for:** an **always-on machine** (a Raspberry Pi 4 or 5, or a small mini PC, running normal Linux). Your main PC sleeps, which has already caused missed schedules and a start-up stampede. A small always-on node gives a witness and a miner that keep time, and it is independent of Google Cloud. That is the real benefit of "somewhere bare metal". It needs no custom kernel.
- **Nothing you have built is a kernel today.** `rabbitos` is the web console (a public snapshot of the app); `RABBIT-SOFTWARE` is an empty repository. So this is new, and that is fine.

## 2. What to borrow from Bitcoin Core (ideas, not code)

| Bitcoin Core idea | In Maxwell Core |
|---|---|
| Daemon plus command-line client talking JSON-RPC over localhost | `maxwell-core serve` and `maxwell-core cli <method>` |
| Cookie authentication (a random secret file the daemon writes at start) | `.cookie` in the data folder; remote access is off |
| A data directory with a config file | `~/.maxwell/` with `maxwell.conf`, `chain.json`, `state.json`, `witness/` |
| Familiar RPC names | `getblockcount`, `getbestblockhash`, `getblockhash`, `getblock`, `getblockheader`, `getblockchaininfo`, `verifychain`, `stop` |
| `verifychain` | re-checks every hash, link and work target |
| "Initial sync" then following the tip | `sync` fetches the public chain, verifies it, stores it atomically |
| Never replace your chain with one that contradicts it | a sync that disagrees at a position the node already holds is refused and flagged as a conflict |
| Signet: blocks signed by a designated key | planned: signed blocks (`docs/chain-roadmap.md`, step 5) |
| Header-only (SPV) verification | already how Bitcoin is checked here (only block headers are needed) |

## 3. Phases

| Phase | What | State |
|---|---|---|
| **0: read-only node** | `maxwell-core`: init, sync, verify, serve a JSON-RPC on 127.0.0.1 with cookie auth, a CLI, and `witness` (signs the head it verified, with the same code as `witness.mjs`) | **built, tested (see section 5)** |
| 1: RabbitOS manages it, rabbitweb tracks it | each node publishes a small signed heartbeat (version, height, best hash, last sync); the status job aggregates `status/nodes.json`; the rabbit web miner adds a leaf `core:nodes` (count and agreement) so the platform snapshot block commits to the node set; the Network map gets a "Core nodes" lane; the cloud shell page shows the nodes | planned |
| 2: mining moves into the Core | `getblocktemplate` / `submitblock` equivalents, owner-only (needs the ingest secret); the research-anchor and web-snapshot miners become Core modules; signed blocks | planned |
| 3: packaging | Docker image, `systemd` unit, Raspberry Pi guide, Windows service; optional build of the node on bare metal | planned |
| 4: joining the wider ecosystem | align checkpoints with the C2SP transparency-log formats so existing public witnesses and monitors can cosign (to be checked: whether public witness operators accept new logs) | idea |

## 4. How it fits RabbitOS, rabbitweb and the site

- **RabbitOS (manages):** the owner starts, stops and inspects nodes from the cloud shell and the console; configuration lives in the node's `maxwell.conf`; no secrets are needed for the read-only node.
- **rabbitweb (tracks):** the platform snapshot already commits the ledger head, code commits and research counts into a Maxwell block; node heartbeats become one more leaf, so the chain records which nodes agreed on which head, when.
- **rabbitsoftware.io (shows):** the Network map and the Proof page already show blocks, anchors, Bitcoin witnesses and the independent witnesses; Core nodes appear as one more lane.

## 5. Phase 0 in detail

Code: `maxwell-core/maxwell-core.mjs` in the `rabbitsoftware-cloudflare` repository (one file next to a copy of `witness.mjs`; Node 22 or newer; no dependencies).

```
node maxwell-core.mjs init                       # makes ~/.maxwell with maxwell.conf
node maxwell-core.mjs sync                       # downloads the public chain, verifies it, stores it
node maxwell-core.mjs serve                      # RPC on 127.0.0.1:8645, syncs every hour; writes a .cookie
node maxwell-core.mjs cli getblockchaininfo      # talks to the running node
node maxwell-core.mjs cli getblock 12
node maxwell-core.mjs cli verifychain
node maxwell-core.mjs witness --name mynode      # signs the head this node verified (key in the data folder)
```

Safety choices: the RPC listens only on the loopback address; it checks the `Host` header (a defence against DNS-rebinding) and rejects any request that carries a browser `Origin`; every call needs the cookie; request bodies are limited to 64 KB; the node never writes anywhere except its own data folder; a new chain that contradicts the stored one is refused and flagged, never silently adopted.

## 6. What is still open for you to decide

1. **Hardware:** a Raspberry Pi 5 or a small mini PC as the always-on node (a one-time cost of roughly the price of a modest phone; I have not priced it today), or stay with the PC and Google Cloud.
2. **Who else runs a node:** the model gets stronger with nodes you do not control.
3. **Whether to pursue Phase 4** (the wider transparency-log ecosystem) once the Core exists.
