# RabbitSoftware: what it is and how to check it

A one-page guide for visitors, collaborators and anyone deciding whether to trust the project. Everything below can be checked without an account, a wallet or any payment.

## What exists today

| Piece | What it does | Where to see it |
|---|---|---|
| **Research agents** | Search public sources (PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, INSPIRE-HEP and others) and collect titles and links into one shared store. They store pointers to public records, not endorsements. | [rabbitsoftware.io/research](https://rabbitsoftware.io/research.html) (live list and a search box) |
| **RabbitOS** | The console at app.rabbitsoftware.io: the research store, the data hub, the cloud shell, the agents' tasks. | app.rabbitsoftware.io |
| **The ledger and the Maxwell chain** | Two hash-chained public records: the ledger of research events and the Maxwell chain whose blocks anchor the research store (a Merkle root plus a count). Several independent copies agree. | [rabbitsoftware.io/blockchain](https://rabbitsoftware.io/blockchain.html) |
| **Anchors** | A fingerprint of both chains' heads is witnessed by Bitcoin (free, through OpenTimestamps) and by a standard RFC 3161 timestamp authority (FreeTSA). | [rabbitsoftware.io/proof](https://rabbitsoftware.io/proof.html) |
| **Status** | Whether the site, the console and the services are answering, checked from Google Cloud every five minutes. | [rabbitsoftware.io/status](https://rabbitsoftware.io/status.html) |
| **Open code** | The main repositories are public (UPL-1.0). | github.com/therealsickonechase-bit |

## What is not switched on (said plainly)

- **Ethereum and XRP Ledger anchoring.** The software exists, but the two signing accounts hold no funds, so nothing has been posted there. The Bitcoin and FreeTSA witnesses do not depend on them.
- **The donation wallet** holds nothing yet. No real funds have moved.
- There is **no token, coin or sale**.

## Check it yourself (about five minutes)

1. Open the [proof page](https://rabbitsoftware.io/proof.html). Each anchor shows its Bitcoin block and whether our status job re-checked it against the real block.
2. Do the check on your own machine: download `scripts/verify-anchor.py` from the public repository and run `python verify-anchor.py <anchor id>`. It replays the OpenTimestamps proof and compares it with that Bitcoin block's Merkle root from a public Bitcoin API.
3. Compare the ledger with its independent copy in Google Cloud (`ledger/chain_head.json`) and read the Maxwell chain (`maxwell/maxwell_chain.json`) to see each block name the hash of the one before it. Both links are on the [blockchain page](https://rabbitsoftware.io/blockchain.html).
4. Verify the FreeTSA timestamp of an anchor with `openssl ts -verify` and the certificates from freetsa.org.

More detail: [anchoring.md](anchoring.md) and [github-mirrors.md](github-mirrors.md).

## What a proof does and does not mean

A timestamp proves a fingerprint existed by a certain time and has not changed since. It does **not** prove that a record is true, that a paper's claim is correct, or that a result was replicated. Research pointers are starting points: always check the venue, the citations and whether a finding was confirmed by others. Nothing here is medical advice.

## Personal data

Personal data (EEG, wearables, labs, DNA sequences) stays on the owner's own computer. Only fixed words go to an image model, and only coarse owner-only summaries may be stored in the cloud. DNA comparisons run locally and only an acknowledgement is echoed, never a sequence or a result.
