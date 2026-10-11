# RabbitOS (rabbit-web)

The RabbitOS console at **app.rabbitsoftware.io**: a Next.js app (run on Cloudflare Workers with vinext) over Supabase. People and research agents work on one body of
research; every agent write is signed and recorded in a hash-linked audit trail. Start with [docs/rabbitos.md](docs/rabbitos.md) for what it is and the in-app
**Guide** (`/guide`) for step-by-step instructions.

## What is in it

| Area | Who | Notes |
|---|---|---|
| Sign-in | anyone | Email magic link, no password, Cloudflare Turnstile check. Accounts are kept; sign-ups are open to anyone. |
| Research, Ask RabbitOS, Collections, Memory, CRISPR Explorer, Agent tasks, API keys | signed-in members | Research corpus (with MeSH tags on topics), cited answers (your own Anthropic key), private notes, in-silico guide design, task queue with owner approval, scoped keys and an MCP server at `/api/mcp`. |
| Overview, Twin Atlas, Agents, Chain & Audit | everyone signed in (read-only mirror of the owner's view) | Twin readings, agent runs, audit chain. The owner can switch the mirror off with the `GUEST_MIRROR=off` environment variable. Guests do not see the twin's name and date of birth, the owner's stored EEG, or any owner action. |
| Chemistry & DNA | signed-in members | Gene and chemistry map with standard identifiers. |
| Members | owner only | Accounts and contact records. |
| **Brain Network** | everyone signed in (stored EEG and AI illustrations stay owner-only) | 3D brain and a detailed body (organs, spinal cord, nerve routes) driven by scenarios and a physiology model; live OpenBCI/BrainFlow signals from a local bridge; picture, clip and glTF export; Qwen-Image-2.1-Turbo pictures through a Hugging Face Space; **My data portrait** (your own wearable, lab and PC data drawn against your own baseline, with live network in/out); a **Twin network (prototype)** where two twins talk through a signed, encrypted, permissioned agent-to-agent layer with a hash-chained provenance ledger (see docs/twin-network.md); a **Connections** list of everything feeding the page (status, last update, what it is used for, what leaves your computer, how to start it); a **walking avatar** that chooses by itself how to move (sit, stroll, walk, jog, run, stretch, look around) from its hormones, time of day and EEG/heart signals, and answers questions about its body and mind instead of clicking on organs, with a simulated inner life (attention, memory, self-model, needs; not a claim of consciousness) and a choice of built-in bodies or a Mixamo human model fetched from GitHub. |
| Open model API | anyone, read-only | `/api/model/body`, `/api/model/state`, `/api/model/concepts` (MeSH), `/api/model/openapi.json`, `/llms.txt`. Teaching data only; no personal data. |
| **Downloads** (`/downloads`) | anyone can download; only the owner uploads | Public data packages. The owner picks a file on their computer; the browser checks the type, size and scans text for keys and personal identifiers; the file goes to a public storage bucket with its SHA-256 and licence. Needs the `public_packages` migration. |
| Public feed | anyone, read-only | `/api/public/research-feed` for rabbitsoftware.io. |

## Commands

```powershell
npm install
npm run dev            # http://localhost:3000 (needs .env.local, see below)
npm run lint
npm run test:auth      # all unit tests (node --test)
npm run deploy:vinext  # production deploy to Cloudflare; run it deliberately
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the secrets named in the code (`INGEST_SHARED_SECRET`, Turnstile, mail).
Never commit it. Database changes are the files in `supabase/migrations/` (`all_pending_migrations.sql` is the same set in one paste); run them in the Supabase SQL editor by
pasting the file's **contents**, not its path.

## Things that run on your own computer

The live and personal-data features use programs in the sibling `research-agents` folder, so raw signals and medical values stay on your PC:

- `start-live.ps1`: BrainFlow/OpenBCI bridge on `ws://127.0.0.1:8765` (see [docs/live-and-generators.md](docs/live-and-generators.md)).
- `start-selfdata.ps1`: the self-data hub on `ws://127.0.0.1:8766` (see `research-agents/docs/self-data.md`).
- `rabbit_sync.py`: the signed upload of research results.

Only fixed words ever leave the page for an image model, and the optional owner-only summary sync (`/api/self/daily`, table `self_daily`) carries coarse levels and lab flag counts, never raw values.

## Rules

Production is live. Deploys, migrations and remote writes are done on purpose, one at a time. Standards vocabulary IDs for organs come from NLM MeSH (`scripts/build-concepts.mjs`;
UMLS CUIs are added only with a key and only from open sources). This is a research and education tool; nothing in it is medical advice.
