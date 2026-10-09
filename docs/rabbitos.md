# RabbitOS — what it is, and where it is going

RabbitOS is the logged-in console at `app.rabbitsoftware.io` (later `rabbitsoftware.io/console`). It is the one
place where **people, AI agents and a digital twin** meet around a body of research. Supabase is the system of
record; Cloudflare Workers serve it; the Python research agents feed it through a signed ingest.

## What exists today

| Area | Who | What it does |
|---|---|---|
| Sign-in | anyone (once sign-ups open) | Email + password, email confirmation, bot check, password reset |
| Research | any confirmed user | Browse the corpus, summarise an item with their own Anthropic key (20/day) |
| Overview | owner | The digital twin: identity, convergence gate (valence, arousal, GSR, cortisol), RF mesh nodes, XRPL anchors |
| Agents | owner | Status and runs of the research agents |
| Chain & Audit | owner | Hash-chained audit log, verified on read |
| Members | owner | Accounts, roles, whether a sealed contact record exists |
| Ingest | agents | HMAC-signed, replay-protected writes from the research machines |

Principles that stay fixed: members never see the owner's twin; agents never get a key that can read other
people's data; every action that changes something is written to the audit chain.

## What the digital twin is

The twin (`twin_identity`) is a sealed, hash-identified record of one subject, with live signal tables around it
(convergence tokens, mesh readings, chemistry baselines, CRISPR guide registry, DNA storage records, simulation
sessions, XRPL anchors). RabbitOS reads it, never edits it in place. A change is a new row that points at the
old one, so the history is the proof.

## Planned features

Everything in the "agent" column follows the rule **read and propose; an owner approves**.

### 1. Ask RabbitOS (AI chat)
A chat page over the corpus and the member's own saved items. Answers cite record ids and link back to them.
Uses the member's own Anthropic key (already stored encrypted in Settings). Owners can also ask about the twin;
members cannot.

### 2. Agent task queue
- A member or owner files a task: "run ClinVar enrichment for gene X", "summarise new items on topic Y".
- Tasks sit in `agent_tasks` (`queued → claimed → proposed → approved/rejected → done`).
- Research agents poll a signed endpoint, claim a task, run it, and post a **proposal** (results + evidence).
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

### 8. Person data vault (opt-in)
A member may attach their own data to their account (for example a sequence file they own) to use with the
simulator and chat. It is encrypted before storage with a key derived per user, is never shown to other members,
is covered by explicit consent, and can be exported or deleted by the member at any time.

## Build order

1. **Foundations:** `agent_tasks`, `api_keys`, `collections`/`notes`, `consents`, audit entries for all of them (one migration).
2. **Ask RabbitOS + collections/notes.**
3. **Agent task queue + approval screen + signed agent endpoint.**
4. **API keys + public read API.**
5. **CRISPR simulator (client-side) + save to collection.**
6. **Twin explorer + consent receipts and XRPL anchoring of hashes.**
7. **Person data vault.**

Each step ships behind its own PR with tests, and nothing deploys without your go-ahead.
