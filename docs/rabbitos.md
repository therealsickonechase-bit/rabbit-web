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
- **Replication.** After each event it is mirrored, best effort and without blocking the write, to a second store: the R2 bucket
  `rabbitos-chain-mirror`, bound as `CHAIN_MIRROR` in `cloudflare.config.ts`. Where there is no binding (local development, Node, the Cloud Run image) the
  no-op mirror is used and nothing breaks. `GET /api/chain/ledger?since=N` publishes the events and `GET /api/chain/head` returns
  `{length, headHash, updatedAt}`; both are open to everyone, GET only, CORS `*`, and rate limited. The Maxwell node keeps its own verified copy with
  `research-agents/chain_pull.py` (or `scripts/chain-export.mjs export`), and `/ledger` is the public explorer with an in-browser verifier.
  Restore also reads the mirror, so it can rebuild even a lost Supabase ledger, but only if the combined chain verifies.
  - **R2 mirror setup (one time, run by the owner):** `npx wrangler r2 bucket create rabbitos-chain-mirror`, then deploy so the binding exists.
    Check with `npx wrangler r2 bucket list`. Until then the mirror is a no-op.
- **What is never on the ledger.** Only whitelisted columns of the tables above. Contact records, API keys, per-person settings, guest passes and the
  twin's name and date of birth are never written to it, the public route re-sanitises every payload, and the import route rejects events carrying anything else.

**What "public" means here.** The ledger is fully public, by the owner's decision. Anyone can read every event in full (`/ledger`,
`/api/chain/ledger`), verify the hash chain themselves, and mirror all of it, forever. Once someone has copied an event it **cannot be recalled**: a later
delete only adds a tombstone event, and no copy anywhere is touched. Do not put anything in a table that opens to the ledger that you would not want
copied for good. The protected list (contact records, API keys, per-person settings, guest passes, owners, the twin's name and date of birth, key
material) is never written to the ledger, and every payload is re-sanitised on the way out. "Public" does not make it a consensus blockchain: see below.

**What this is not.** It is a tamper-evident, replicated, hash-chained log you control. It is not a decentralized public blockchain: there is no consensus
among strangers, and someone with database superuser rights could still disable the triggers and rewrite it. Tampering is *detectable* by comparing against the
mirror or the Maxwell copy, not impossible. **What survives:** if the live tables are wiped, the ledger restores them. If Supabase is lost but the R2 mirror is
intact, the mirror restores both. If Supabase AND the mirror are both lost, only a copy pulled by the Maxwell node (`chain-export.mjs export`, run regularly)
remains, so schedule that pull. Data written after your last export from a total double loss is gone.

#### Anchoring
**Bitcoin (built 2026-10-15).** The Cloud Run job `rabbit-anchor` (workers/anchor-job in rabbitsoftware-cloudflare, set up by `scripts/powershell/Setup-GcpAnchor.ps1`) runs every
6 hours. When the public ledger head or the Maxwell chain head changed, it builds one small public document (`anchor.json`: ledger length and head hash, Maxwell length, head hash and
index, the date), sends its SHA-256 to the public OpenTimestamps calendars, and stores the proof (`anchor.json.ots`) under `anchors/<id>/` in the public ledger bucket, with
`anchors/index.json` and `anchors/latest.json`. Later runs upgrade pending proofs once Bitcoin has confirmed them (status `pending` then `confirmed`, with the Bitcoin block height).
Anyone can check a proof with the standard `ots verify`. What it proves: the document existed by that Bitcoin block. It does not prove the contents are true. The Maxwell miners record
the newest anchor (`anchor:bitcoin` leaf), so each new anchor and each confirmation also grows the Maxwell chain.

**Ethereum and XRPL (code built and deployed 2026-10-15; switched on when you fund the two addresses).** The Cloud Run job `rabbit-anchor-chains` (workers/wallet/anchor-chains.mjs, set up by
`scripts/powershell/Setup-GcpAnchorChains.ps1`) runs every 6 hours, 30 minutes after the Bitcoin job. It posts the SAME digest as the Bitcoin anchor in one Ethereum transaction (zero value, sent to itself,
data = `RBOS` + version 1 + digest) and one XRP Ledger AccountSet memo, and records `anchors/<id>/ethereum.json`, `xrpl.json` and `anchors/chains.json` in the public ledger bucket. It signs with a
SEPARATE hardware key, `rabbit-wallet/anchor-signer`, that can hold only a little gas money; the donation key is never used by automation. Until the anchoring addresses are funded it sends nothing and
`chains.json` says `funded:false`. Guards: Ethereum gas cap 60 gwei, XRPL fee cap 1000 drops, at most one transaction per chain per 20 hours. Anchoring addresses (public): Ethereum
`0x32bA3432Caff0dac6C88D58Fb2875dc721986b3d`, XRP Ledger `rN8pnpYCaZEQAXE5kL1GC9ThpJYZ8Rd1nX`. The XRPL serialization was checked against the official `xrpl` library (identical bytes, hash, and signature verification).
The existing `xrpl_memo_anchors` table is not used. The wallet's public pages are receive-only; the withdrawal tool (`workers/wallet/withdraw.mjs`, see `docs/wallet.md`) is built and tested but has not yet been used with real funds.

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

## AI coder in the owner CloudShell

The owner console at `/cloudshell` has an "AI coder" panel (Gemini by default, Claude optional). It exists only in that owner-only, approval-gated console; the open-access pages have no such panel and the console's access rules are unchanged.

- **Key**: you paste your own provider API key. It is held in the browser tab's memory only (never localStorage, cookies or RabbitOS servers, never logged) and goes straight from the browser to the provider in a request header. Closing the tab or "Forget key" removes it. Only the `/cloudshell` page's CSP allows connecting to `generativelanguage.googleapis.com` and `api.anthropic.com`.
- **Default coding agent**: the "Default coding agent" choice (Gemini or Claude) is saved in this browser's localStorage only (`rabbitos.defaultAgent`, never a key, never sent to a server) and is shared by the owner panel, the public CloudShell ("Start my default agent" types `gemini` or `claude` without Enter) and a banner on `/commands`. The permission rule is fixed and shown in the UI: every command needs your click (owner: plus an active approved grant); auto-run does not exist and no stored value can enable it.
- **Human in the loop**: the model replies with strict JSON (`explanation`, `files`, `command`, `done`). The exact text to be sent is shown. Nothing runs until you tick the approval box and click "Run in CloudShell", every step. It uses the console's existing execute path, so an active, approved grant is required. At most 8 steps per task; it stops on done, deny, an expired grant or any shell error, and never retries.
- **Local safety checks**: at most 8 files of 2000 bytes, safe relative paths, command plus files within the 4000-byte limit; environment dumps, ssh and credential-file access are refused; `curl | sh` needs a second confirmation.
- **What leaves your browser**: your task text and each command's output go to the AI provider you chose, after credential patterns (private keys, `sk-`, `AIza`, GitHub/AWS/Slack tokens, Bearer tokens) and your key are removed and the output is capped at 16 KB. Scrubbing is pattern-based, not a guarantee; do not run commands that print private data.
- Logic and tests: `src/lib/coding-assistant.ts`, `tests/coding-assistant.test.mjs`.

## Command catalog

`src/lib/command-catalog.ts` is one shared list of the commands built across rabbit-web, rabbitsoftware-cloudflare (including `workers/vault-agent` and the `vault:*` scripts) and research-agents. Every entry comes from a tracked file named in its `source` field (package.json scripts, README/DEVELOPMENT/docs, `scripts/`, the Python entry points and tests). Nothing is invented and nothing runs by itself.

- **Everyone**: the `/commands` page lists the catalog by project and group with search, copy buttons, scope badges and risk labels. Owner-only commands are shown read-only.
- **Public CloudShell**: the Commands drawer lists only `scope: 'public'` entries and types the chosen command into the terminal without pressing Enter. Public means read, test, lint, typecheck, build, dev-server, ledger helpers: no secret, nothing remote written, and valid in the public sandbox image (only `/workspace/rabbit-web` and the `site/` folder exist there; `/workspace` is read-only, so install-and-build commands work in a copy under the visitor's home).
- **Owner CloudShell**: a picker lists every entry and fills the command box. You still tick the approval box and click Run exactly as before. The AI coder can optionally be given the ids and labels (not the command text). Entries without a `cd /workspace` prefix are written for the repo root on your own computer, not for the sandbox.
- **Owner scope** covers anything that deploys, uses `wrangler` secrets or resources, Supabase service role, ingest secrets or the database URL, touches the vault or contact records, uses cloud-access/approval, or needs a private checkout (all of rabbitsoftware-cloudflare except the sandbox helpers, and all of research-agents, which are not in the sandbox image and whose data sources are not on its network allowlist). `needs` lists environment variable names only.
- Tests: `tests/command-catalog.test.mjs` checks unique ids, field validity, the 4000-byte/no-NUL contract, that no public entry matches deploy/secret/token/approval patterns, that every `npm run` script and referenced file exists in the sibling repos (skipped when a repo is absent), and stable order. Add a new command to the module with its `source`, then run `npm run test:auth`.

## Terminal look, Copilot and provider checks

- **Public CloudShell look**: black terminal (Cascadia Mono, Consolas, Menlo, monospace; 5000 lines of scrollback, blinking cursor), a title bar with a session clock (an estimate; the server decides), and a collapsible Guide panel. The `Style: Linux | PowerShell-look` toggle changes colors and the welcome banner only. The shell in the container is always bash. Typing `help-rabbit` in the sandbox prints the same guide.
- **PowerShell and network tools (default: the normal connection).**
  - *Public sandbox:* the image has PowerShell 7 (`pwsh`, v7.6.6 from the official GitHub release, SHA256 checked in the Docker build; the login shell stays bash). The page has a "Start PowerShell" button that types `pwsh` without pressing Enter. `Invoke-WebRequest` / `Invoke-RestMethod` work only through the same egress allowlist as `curl` (HTTPS, named hosts, mostly read-only); nothing about the allowlist, proxy or approval gates changed. `rabbit-net status` shows the allowlisted connection and `rabbit-net check` sends `curl --head` (5 s timeout) to each allowed host. **ICMP/ping, DNS lookup tools, traceroute, nmap, netcat and port scanners are intentionally not installed**: only HTTPS to named hosts can leave the box, so they could not give true answers, and they are the tools used to scan other machines from a free shared sandbox. Use the module below on your own PC for real diagnostics.
  - *Your PC:* `scripts/powershell/RabbitNet.psd1` (PowerShell 7). Run in PowerShell on your PC, from the rabbit-web folder: `Import-Module ./scripts/powershell/RabbitNet.psd1 -Force`. `Test-RabbitConnection` prints DNS, TCP 443, TLS, HTTP status and latency for app.rabbitsoftware.io, its `/api/chain/head` and (if set) `RABBIT_CLOUDSHELL_URL`. No proxy unless `-Proxy <url>` or `RABBIT_PROXY`. `-NetworkTools` is opt-in and asks first (`-Confirm`/`-WhatIf`): all DNS record types, a traceroute (Windows), IP configuration and MTU, only for hosts you name with `-TargetHost` (single host names; no IPs, ranges or ports) or the RabbitOS/Cloudflare hosts. There is no port-scan mode; only port 443 is contacted. `Get-RabbitChainHead` reads the public head.
  - *`Sync-RabbitChain` is a local pull, not an upload.* It reads `GET /api/chain/ledger?since=N` into `~/RabbitOS/chain_ledger_local.jsonl` (or `-Path`), verifies the hash chain with a PowerShell port of `src/lib/chain-ledger.ts` (checked against a test vector built by the TypeScript code), refuses a broken chain, and resumes from `<file>.state.json`. It sends only GET requests with no body: no vault, notes, local files or tokens leave the PC, and it never uses `vault:cloud-access`. The CloudShell does not read your PC's file; it reads the same public URL itself, so Sync prints the copy-able CloudShell command (`curl -fsS "https://app.rabbitsoftware.io/api/chain/ledger?since=0" | head -c 60000`).
  - *Tests:* `pwsh -File scripts/powershell/test-rabbitnet.ps1` (offline; skips with a message when PowerShell 7 is missing; `-Live` adds read-only live GETs) and `tests/rabbitnet.test.mjs` (static: exports, no port-scan cmdlets, no tokens, no uploads, no vault paths, default has no proxy; part of `npm run test:auth`). The command catalog lists these as owner commands labelled "run in PowerShell on your PC"; the public catalog gets only `rabbit-net check` and `pwsh --version`, and a test rejects scanning tools in any public entry.
- **Owner console**: the command box is a black terminal view with a prompt line, scrollback of this tab's commands and outputs, Up/Down history (memory only) and a `help` panel. Enter never runs anything; you still tick the approval box and click Run.
- **Copilot** (`copilot`, `@github/copilot`) is terminal-only. It can be the saved default agent for the public shell button; the AI coder panel then uses Gemini and says "Copilot runs in the terminal". Sign in with `/login` (device code) or paste a fine-grained token with the "Copilot Requests" permission as `COPILOT_GITHUB_TOKEN` in the keys drawer. It needs a Copilot subscription and Node 22+.
- **Gemini model picker**: "Load models from my key" calls `GET /v1beta/models` from your browser with your key, keeps models that support `generateContent`, and fills the picker. A 403 or 404 shows a clear message; you can always type a model name.
- **`npm run verify:ai`** (owner, your computer): with `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `COPILOT_GITHUB_TOKEN` in your environment it lists Gemini models, sends one tiny request per provider, checks GitHub accepts the Copilot token, and checks the three CLI packages with `npm view`. Prints PASS, FAIL or SKIPPED per item and never prints keys. With no keys only the npm checks run.

## Data hub

A public, read-only window onto research data and the chain ledger. Page: `/data`. API: `GET /api/data` (manifest: datasets, columns,
row counts, endpoints, ledger head) and `GET /api/data/<dataset>` with `q` (search), `limit` (1 to 200, default 50), `cursor` (the
`nextCursor` of the previous page), `sort` (a declared column, `-` for descending), exact-match filters on declared columns, and
`format=json|csv|ndjson` (`download=1` sends it as a file). CORS is `*`, responses are cached for seconds, and each caller is rate limited
(best effort). Only GET, HEAD and OPTIONS are allowed; there is nothing to write.

**What is public (permanent once copied):** exactly these datasets, with explicit column lists in `src/lib/data-hub.ts`:
`research_records`, `research_topics`, `research_runs`, `research_summaries`, `agents` (node id, kind, timestamps; no twin link),
`chain_blocks`, `node_scores`, `merkle_batches`, `audit_entries`, `ledger` (sequence, table name, operation and hashes only; no payloads and
no row ids, the full verified log stays at `/api/chain/ledger`) and `commands` (the public-scope CloudShell catalog). Any column or nested
key that looks like a token, secret, key, email, password or user id is dropped. Once somebody copies a row you cannot take it back.

**What is not in the hub:** chats, notes, collections, the memory graph, EEG samples, `self_daily`, contact records, API keys, settings, guest
passes, owners, twin name and date of birth, and user ids. They stay on their own pages. The private local research stores in the
`research-agents` folder are also not in the hub: they only appear here if they were ingested through the signed ingest into the research
tables above.

**From CloudShell** (the public sandbox may `GET` this API and nothing else on the origin):

```
curl -fsS "https://app.rabbitsoftware.io/api/data" | jq
curl -fsS "https://app.rabbitsoftware.io/api/data/research_records?limit=50&q=brca1" | jq
curl -fsS "https://app.rabbitsoftware.io/api/data/audit_entries?format=csv&limit=200" > audit.csv
```

The `/data` page shows the exact command per dataset with a copy button; the command catalog (`/commands`) lists them too. The website
copy of the explorer is `data.html` in rabbitsoftware-cloudflare; it reads the same API across origins.

## Maxwell mirror

Every block of the owner's Maxwell chain (`maxwell_chain.json` in research-agents) is also an event on the public chain ledger, so anyone can read and verify it at `/api/chain/ledger`, in the `/ledger` explorer and with `Sync-RabbitChain` / `chain_pull.py`.

- **What is public**: only the six block fields: `index`, `timestamp`, `transactions`, `previous_hash`, `nonce`, `hash`. A block carries at most 20 transactions, each with at most 12 string or number fields, and at most about 20 KB in all. Any other key, nested value, or field name that looks like a secret or personal data makes the block refused (never silently trimmed). The chain file holds no personal data.
- **How it is stored**: ledger table `maxwell_chain`, op `insert`, `row_id` = the block index. There is no live table behind it (the ledger is the data), so restore and auto-restore skip it. A partial unique index means an index can be mirrored once.
- **How it links**: two chains. The Maxwell chain links by `previous_hash` (block 0 follows 64 zeros). The ledger links each event to the one before it. `POST /api/ingest/maxwell-chain` checks the Maxwell linkage before writing: a new block's `previous_hash` must equal the hash of the block before it (already mirrored, or earlier in the same call), so gaps and forks are refused (422).
- **Idempotent, never overwritten**: re-sending a block with the same index and hash is skipped. The same index with a different hash is refused with 409 and nothing in that call is written.
- **Route contract**: signed like `/api/ingest` (`x-rabbit-timestamp`, `x-rabbit-signature` = hex HMAC-SHA256 of `${timestamp}.${body}` with `INGEST_SHARED_SECRET`). Body `{ "blocks": [...] }`, at most 50 blocks and 256 KB. Reply `{ accepted, skipped, rejected: [{ index, code, reason }] }`; `rejected` is empty on 200. Rate limited per caller; logs counts only, never block contents.
- **Sender**: `python maxwell_chain_sync.py [--dry-run] [--once]` in research-agents (run on your PC). It re-checks the chain locally (linkage and each block's SHA-256, recomputed the way `maxwellblockchain.py` hashes), remembers the last mirrored index in `.maxwell_chain_sync_state.json`, and posts only new blocks. `--dry-run` sends nothing and writes no state.
- **A mirror, not consensus**: the server does not re-do proof of work and no other node agrees on this chain. The ledger records "these blocks were published, in this order, and have not been changed since" — it does not make Maxwell a decentralized public blockchain.
- **Setup order**: apply `supabase/migrations/20261014010000_chain_ledger_maxwell.sql` by hand (after the base chain-ledger migration), deploy the app, then run the sync. `chain_pull.py` and the RabbitNet module list the ledger tables; keep them in step (`maxwell_chain` is in `RabbitNet.psm1`; `chain_pull.py` `TABLES` needs it too).
- Logic and tests: `src/lib/maxwell-block.ts`, `src/lib/maxwell-mirror.ts`, `src/app/api/ingest/maxwell-chain/route.ts`, `tests/maxwell-mirror.test.mjs`; sender tests in research-agents `test_maxwell_chain_sync.py`.
