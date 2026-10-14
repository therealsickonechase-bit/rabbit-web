# RabbitOS — what it is, and where it is going

## Current: open access for everyone

RabbitOS is open to everyone. There is no login, no sign-up and no owner, member or guest tiers; every visitor is the same
anonymous identity (), with no cookies and no auth. The pages Overview, Twin Atlas, Brain Network, Chemistry & DNA,
Research, Ask RabbitOS, Memory, CRISPR Explorer, Collections, Agent tasks, Agents and Chain & Audit are served directly. Old
, , , , , ,  and  URLs redirect to .

What everyone can read and write (always through the server; the service role never reaches the browser): stored EEG band samples,
daily self summaries (), the twin, the chain, agents, memory, collections, notes, chats and tasks.
Because everyone shares one identity, everyone sees and can change the same chats, collections, notes and daily summaries.
,  and  are open, keeping their validation, size limits and rate limits.
Ask RabbitOS uses the hosted Qwen model only; there are no personal API keys.

Still closed to anonymous users:
- **contact_records** (other people's contact data) and **api_keys**: no one can mint, list or revoke keys. The Members, Guests, Keys
  and Settings pages and the guest-pass code are removed.
- **audit_entries** writes: the audit trail is readable by all but append-only; only the signed ingest writes it. Sealing Merkle batches is removed.
- **Agent task execution**:  and  keep their signed/machine auth. Anyone may propose a task; it is stored as
  , agents only claim  tasks, so it never runs on the owner's computer. Approving proposals into the corpus is removed.
- The twin's **name and date of birth** are never read or published (column list and a column-level grant).
- Personal data (EEG, wearables, labs) still belongs on the user's own computer; only coarse summaries are stored.

Database:  (not applied automatically) creates the shared visitor row, drops the
owner-only policies and grants public read on the opened tables. Writes stay service-role only.

## Historical account-backed design (inactive)

The remainder records the previous design (owner, member and guest roles), not current access or setup.

RabbitOS was the logged-in console at `app.rabbitsoftware.io` (linked from rabbitsoftware.io, section RabbitOS). It was the one
place where **people, AI agents and a digital twin** meet around a body of research. Supabase is the system of
record; Cloudflare Workers serve it; the Python research agents feed it through a signed ingest.

## What exists today

| Area | Who | What it does |
|---|---|---|
| Sign-in | anyone | Email magic link (no password), email confirmation, Cloudflare Turnstile check. Accounts are kept; sign-ups are open to anyone |
| Research | any confirmed user | Browse the corpus (topics carry NLM MeSH tags), summarise an item with their own Anthropic key (20/day) |
| Ask RabbitOS | any confirmed user | Cited answers built only from stored records (40/day) |
| Collections, Memory | any confirmed user | Save and tag records, private notes, semantic memory |
| CRISPR Explorer | any confirmed user | Real gene sequences, SpCas9 guide candidates, in-silico edit preview (education only) |
| Agent tasks | members file, owner approves | Task queue: queued, claimed, proposed, approved or rejected, done |
| API keys and MCP | any confirmed user | Scoped, revocable keys; MCP server at `/api/mcp` (search, CRISPR guides, proof digest, body model) |
| Overview, Twin Atlas, Chemistry & DNA | everyone signed in (read-only; owner can switch off with `GUEST_MIRROR=off`) | The digital twin (name and date of birth hidden from guests): identity, convergence gate, RF mesh nodes, readings vs baseline, reference variants |
| Brain Network | everyone signed in; stored EEG and AI illustrations owner-only | 3D brain and detailed body with organs, spinal cord and nerve routes tied to scenarios and a physiology model; live OpenBCI/BrainFlow signals from a local bridge; Qwen-Image pictures through a Hugging Face Space; **My data portrait** from the local self-data hub |
| Agents, Chain & Audit | everyone signed in (read-only); sealing batches is owner-only |
| Members | owner | Accounts and roles. |
| Ingest | agents | HMAC-signed, replay-protected writes from the research machines |
| Open model API | anyone, read-only | `/api/model/body`, `/state`, `/concepts` (MeSH), `/openapi.json` and `/llms.txt`: teaching data for people, AI models and open-source tools; no personal data |

Principles that stay fixed: guests see only a read-only mirror of the twin (never its name or date of birth, and never the owner's stored EEG), and only while the owner leaves the mirror on; agents never get a key that can read other
people's data; every action that changes something is written to the audit chain.

## What the digital twin is

The twin (`twin_identity`) is a sealed, hash-identified record of one subject, with live signal tables around it
(convergence tokens, mesh readings, chemistry baselines, CRISPR guide registry, DNA storage records, simulation
sessions, XRPL anchors). RabbitOS reads it, never edits it in place. A change is a new row that points at the
old one, so the history is the proof.

## Feature notes and status

Built so far: Ask RabbitOS, agent task queue, API keys and MCP, collections and notes, semantic memory, the CRISPR simulator, Merkle batches of the audit chain,
the Brain Network with the body model, live signals, generators and the data portrait, and standard vocabulary (MeSH) tags. Not built yet: email alerts for saved
searches, consent receipts, XRPL anchoring of batches (the page shows "not anchored"), the person data vault, and UMLS CUIs (waiting for an NLM key).
The design notes below are the original plan and still describe the rules those features follow.

Everything in the "agent" column follows the rule **read and propose; an owner approves**.

### 1. Ask RabbitOS (AI chat)
A chat page over the corpus and the member's own saved items. Answers cite record ids and link back to them.
Uses the member's own Anthropic key (already stored encrypted in Settings). Owners can also ask about the twin;
members cannot.

### 2. Agent task queue
- A member or owner files a task: "run ClinVar enrichment for gene X", "summarise new items on topic Y".
- Tasks sit in `agent_tasks` (`queued → claimed → proposed → approved/rejected → done`).
- Research agents poll a signed endpoint, claim a task, run it, and post a **proposal** (results + evidence).
- Proposal links must be parseable absolute HTTP(S) URLs, at most 500 characters;
  absent or null links are allowed. Malformed links are rejected before approval.
- An owner approves; only then do results enter the shared corpus. Rejected proposals stay on record.

### 3. API keys and a public API
- Members create scoped keys (`read:corpus`, `submit:task`). Shown once, stored as a SHA-256 hash.
- Keys are revocable, rate limited and expire. Every call is logged to the audit chain with the key id.
- Lets a member's own scripts or AI tools use RabbitOS without a browser session.

### 4. Collections, notes and alerts
Save and tag items, write private notes, share a collection by invitation, and get an email when agents add
something matching a saved search (sent through the existing mail path, at most one digest per day).

### 5. Twin explorer
A readable view of the twin for the owner: timeline of convergence tokens, node health, what each anchor
proves, and a "why did the gate fire" explanation built from the stored values and thresholds.

### 6. CRISPR edit simulator (in-silico only)
- Paste or pick a gene sequence; the page finds SpCas9 PAM sites (NGG), ranks candidate guides with the same
  published heuristic as `crispr_guide_design.py`, and shows the cut site and the resulting sequence change.
- Interactive: choose an edit (knockout by indel, base substitution), see the codon-level effect (silent,
  missense, frameshift, premature stop), and compare candidates side by side.
- It runs in the browser on text; nothing is sent anywhere unless the user saves the result.
- Scope: education and research planning. It does **not** produce lab protocols, delivery methods, or anything
  for use on a living subject. The page says so, and the score is labelled a heuristic, not a validated
  off-target prediction.

### 7. Where blockchain fits (and where it must not)
The chain proves **that something existed, who agreed, and that it was not changed**. It is public and permanent,
so it never holds personal or genomic data.

| Goes on the XRP Ledger | Never goes on-chain |
|---|---|
| SHA3-512 hash of a research record, simulation result or approval | Names, emails, DNA/RNA sequences, health values |
| A consent receipt: hash of "person P agreed to use Q for purpose R, until date S" | The consent text itself |
| A revocation receipt that supersedes the consent | Anything that identifies the person |

Flow for a person's data: the data stays encrypted in Supabase → RabbitOS hashes it → the hash (plus consent
receipt) is anchored → anyone holding the original can prove it matches, and nobody else learns anything.
Revoking consent deletes the data from Supabase and anchors a revocation; the old hash then proves nothing
about content.

### 7a. The chain ledger (why wiped data comes back)
Every write to the opened tables (EEG band samples, self-daily summaries, chats, collections and their items, notes, the knowledge graph, agent tasks)
is first appended to `chain_ledger`, and only then written to the live table. An event is
`{seq, table, op, row_id, payload, prev_hash, hash}`; the hash is the Merkle leaf hash (`src/lib/merkle.ts`) of the event's canonical JSON plus the
previous hash, so changing, dropping or reordering any event breaks every later one. A delete or a wipe is a **tombstone** event; the ledger itself
cannot be updated, deleted or truncated (RLS, revoked privileges, and triggers), and only the server's service role can insert.
The live tables are just a view of the ledger.

- **Restore.** `POST /api/chain/restore` (the "Restore from chain" button, and automatically when a page finds a table empty) replays the ledger,
  verifies the hash chain (a broken chain is refused, nothing is written), and puts back every row's last non-deleted state. It is idempotent: rows already
  present are left alone. A deliberate delete is therefore recorded, but can be undone by a restore; that is the point of "always persists".
- **Replication.** After each event it is mirrored, best effort and without blocking the write, to a second store: an R2 bucket bound as `CHAIN_MIRROR`
  (not bound by default; the no-op mirror is used until you add the binding). `GET /api/chain/ledger?since=N` publishes the events publicly (read-only) and
  `scripts/chain-export.mjs` pulls them to the Maxwell node (`export`), checks them (`verify`) and pushes them back (`import`, signed like `/api/ingest`).
  Restore also reads the mirror, so it can rebuild even a lost Supabase ledger, but only if the combined chain verifies.
- **What is never on the ledger.** Only whitelisted columns of the tables above. Contact records, API keys, per-person settings, guest passes and the
  twin's name and date of birth are never written to it, the public route re-sanitises every payload, and the import route rejects events carrying anything else.

**What this is not.** It is a tamper-evident, replicated, hash-chained log you control. It is not a decentralized public blockchain: there is no consensus
among strangers, and someone with database superuser rights could still disable the triggers and rewrite it. Tampering is *detectable* by comparing against the
mirror or the Maxwell copy, not impossible. **What survives:** if the live tables are wiped, the ledger restores them. If Supabase is lost but the R2 mirror is
intact, the mirror restores both. If Supabase AND the mirror are both lost, only a copy pulled by the Maxwell node (`chain-export.mjs export`, run regularly)
remains, so schedule that pull. Data written after your last export from a total double loss is gone.

### 8. Person data vault (opt-in)
A member may attach their own data to their account (for example a sequence file they own) to use with the
simulator and chat. It is encrypted before storage with a key derived per user, is never shown to other members,
is covered by explicit consent, and can be exported or deleted by the member at any time.

## Build order (original plan; steps 1 to 5 are done, step 6 is partly done, step 7 is not started)

1. **Foundations:** `agent_tasks`, `api_keys`, `collections`/`notes`, `consents`, audit entries for all of them (one migration).
2. **Ask RabbitOS + collections/notes.**
3. **Agent task queue + approval screen + signed agent endpoint.**
4. **API keys + public read API.**
5. **CRISPR simulator (client-side) + save to collection.**
6. **Twin explorer + consent receipts and XRPL anchoring of hashes.**
7. **Person data vault.**

Each step ships behind its own PR with tests, and nothing deploys without your go-ahead.
