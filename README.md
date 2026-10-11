# RabbitOS (rabbit-web)

The account-free RabbitOS workspace at **app.rabbitsoftware.io**, served by
Next.js/vinext on Cloudflare Workers. No email, password, CAPTCHA or guest pass
is required. Public literature metadata comes from the existing Supabase feed;
private accounts and records remain stored but inaccessible. The in-app
**Guide** (`/guide`) describes the current workflow.

## What is in it

| Area | Who | Notes |
|---|---|---|
| Overview | anyone | Start directly; old login/signup/guest URLs redirect here. |
| Research, Ask RabbitOS | anyone | Latest 20 already-public literature titles; Qwen research chat uses up to four recent titles as pointers, not full papers or the private corpus. |
| Memory & Files, Collections, Local tasks, Settings | browser-local | Notes/checklists, selected-text-file viewer, workspace name, JSON export and clear. Tasks do not execute remote agents. No cross-device sync. |
| Brain & Body, Twin model, Connections | anyone | Existing local 3D explorer, physiology, avatar, opt-in loopback bridges, image/export tools. No server-stored EEG, twin identity or personal readings are loaded. Coarse portrait summaries stay in this browser. |
| CRISPR Explorer | anyone | Text-only teaching editor; no private guide candidates are loaded. |
| Public proof | anyone | Already-public audit head only; no private audit entries or sealing controls. |
| Accounts, API keys, owner controls | disabled | Old account cookies do not grant access. No shared/fake owner account is used and no database/RLS permissions are widened. |
| Open model API | anyone, read-only | `/api/model/body`, `/api/model/state`, `/api/model/concepts` (MeSH), `/api/model/openapi.json`, `/llms.txt`. Teaching data only; no personal data. |
| **Downloads** (`/downloads`) | anyone, read-only | Existing public packages with licence/checksum. Account uploads and removal are disabled. |
| Public feed | anyone, read-only | `/api/public/research-feed` for rabbitsoftware.io. |

## Commands

### Account-free boundary

`src/proxy.ts` rewrites public workspace paths to `/workspace/:section` before
legacy account pages run. Old account actions return 405; private account APIs,
including email sending, return 410 regardless of cookies. Legacy account
layout/session helpers also fail closed. Login, signup, guest and confirmation
pages redirect without consuming tokens or creating accounts.

Only explicit public read APIs and Qwen avatar POST remain available.
Signed ingest, agent and MCP endpoints retain their own credential validation;
they are not anonymous account access. Existing Supabase data, secrets and RLS
are unchanged. Legacy account implementation/design notes remain for history,
not as active public features.

Chats, notes, tasks and settings persist under `rabbitos.account-free.v1` in
unencrypted browser storage. Portrait saving stores one coarse local summary.
Storage failures are visible; Settings exports/clears local state. Browser
clearing or changing profiles does not preserve this workspace.

### Hosted Qwen chat

Ask RabbitOS and avatar open questions offer Cloudflare-hosted Qwen3.
Former account-stored Claude keys are not loaded. Qwen uses the fixed shared gateway
in `rabbitsoftware-cloudflare/workers/qwen`; no local Ollama installation or
personal provider key is needed. No sign-in is required. Approve
each message and never include private health data. Qwen failures do not call
Claude automatically. Built-in avatar body/introspection answers remain local.

Ask RabbitOS stores questions and answers in this browser only;
avatar conversations stay in the current tab.
The shared gateway enforces daily/hourly attempt quotas (including failed
attempts). Direct research chat uses the browser client's quota; avatar server
requests share their outbound-IP quota. No schema migration is required.

```powershell
node --test tests\account-free.test.mjs tests\qwen.test.mjs tests\avatar-qa.test.mjs tests\connections.test.mjs
npx tsc --noEmit
npm run build:vinext
```

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
