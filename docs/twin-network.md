# Twin network (prototype)

The architecture diagram, and what exists for each box. The prototype is on the Brain Network page ("Twin network (prototype): two twins talking") and in `src/lib/twin-net.ts`.

```
Digital Twin A  <---- A2A layer ---->  Digital Twin B
 mind, memory, sensors      |            mind, memory, sensors
                  Identity + encryption
                  Policy / permissions
                  Provenance ledger
```

| Box in the diagram | Status | What it is here |
|---|---|---|
| Digital twin with memory, models, sensors | prototype | each twin is an avatar mind (`avatar-mind.ts`) with an inner life and episodic memory (`avatar-inner.ts`); sensors are simulated (hormone setting, a visitor switch) |
| Agent kernel | partly | the mind plus the message handler in `TwinNode`; no separate planning kernel yet |
| A2A layer | prototype | request and response envelopes: `status`, `presence`, `vitals`, `memory`, `question` |
| Identity + encryption | prototype | per-twin ECDSA P-256 signing key and ECDH P-256 key agreement; self-signed card; HKDF-derived AES-GCM key per pair; every envelope signed over its header and ciphertext; sequence numbers and a 5 minute window stop replays |
| Policy / permissions | prototype | per peer and capability: allow, ask me first, or deny. Raw EEG, heart, hormone or WiFi numbers are not a capability: only words can be shared, and anything with a digit is refused before it is sent |
| Provenance blockchain | prototype | an in-page hash-chained ledger (not a distributed blockchain) of every message and every decision (delivered, answered, asked, denied by policy or owner, bad signature, replay, undecryptable); verify, and a demo that shows an edit being found. The existing audit chain and Merkle batches (`/chain`) are the real-world counterpart |
| Windows / Linux / macOS and MicroPython nodes | not built | out of scope for the prototype |
| Network between separate computers | not built | the two twins live in one browser tab. A relay (for example a Cloudflare Durable Object over WebSocket) would carry the same envelopes unchanged, because they are already signed and encrypted end to end |

## Honest limits
- Not security-audited and not a finished protocol. Keys exist only in memory and are never saved.
- A self-signed card proves a message came from the holder of that key, not who the holder is in the real world. Real identity would need a trusted way to introduce keys.
- The ledger is a hash chain in one place, so it detects edits but does not by itself stop someone with control of the ledger from rewriting everything. Anchoring batches (as the Chain page does with Merkle roots) is what would publish that proof.
- The twins' minds are simulations for teaching. Nothing here reads real feelings or is medical advice.

## Next steps, in a sensible order
1. Persist identities (encrypted, owner-controlled) and let a person introduce a peer by scanning or pasting its card.
2. Carry envelopes over a relay between two real browsers or machines.
3. Anchor ledger batches in the existing Merkle chain.
4. Add richer capabilities, each with its own consent text and with words-only content.
