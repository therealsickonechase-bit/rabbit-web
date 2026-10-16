# RabbitOS (rabbit-web)

RabbitOS at **app.rabbitsoftware.io**, served by Next.js/vinext on Cloudflare Workers.
**Access is open to everyone: no login, no sign-up, no owner, member or guest tiers.** Everyone is the same anonymous visitor and can read
and write the stored data (EEG band samples, daily summaries, twin, chain, agents, memory, collections, tasks) through the server.
Contact records, API keys and audit writes stay closed; agent tasks proposed here never run on their own. The in-app **Guide**
() describes the workflow; see [docs/rabbitos.md](docs/rabbitos.md).

## Where the operating docs are

| Doc | What it covers |
|---|---|
| [docs/rabbitos.md](docs/rabbitos.md) | The product: pages, data, chain, anchoring (Bitcoin built; Ethereum and XRPL built but parked), agents. |
| [docs/ops-log.md](docs/ops-log.md) | Every change to the live setup: what, how it was checked, how to undo it. Add entries with `node scripts/ops-log.mjs`. |
| [docs/security-hardening.md](docs/security-hardening.md) | The ordered security checklist and its results. |
| [docs/wallet.md](docs/wallet.md) | The hardware-key wallet: receiving record, recovery plan, withdrawal tool. Public donations are paused. |
| [docs/messaging.md](docs/messaging.md) | What to say and not say about the project, and the checklist before promoting donations. |
| [docs/gcp-platform.md](docs/gcp-platform.md), [docs/gcp-observability.md](docs/gcp-observability.md), [docs/gcp-standby.md](docs/gcp-standby.md) | Google Cloud services, monitoring and the standby site. |

## What is in it

| Area | Who | Notes |
|---|---|---|
| Overview | anyone | Start directly; old login/signup/guest URLs redirect here. |
| Research, Ask RabbitOS | anyone | Latest 20 already-public literature titles; Qwen research chat uses up to four recent titles as pointers, not full papers or the private corpus. |
| Memory & Files, Collections, Local tasks, Settings | browser-local | Notes/checklists, selected-text-file viewer, workspace name, JSON export and clear. Tasks do not execute remote agents. No cross-device sync. |
| Brain & Body, Twin model, Connections | anyone | Existing local 3D explorer, physiology, avatar, opt-in loopback bridges, image/export tools. No server-stored EEG, twin identity or personal readings are loaded. Coarse portrait summaries stay in this browser. |
| CRISPR Explorer | anyone | Text-only teaching editor; no private guide candidates are loaded. |
| Public proof | anyone | Already-public audit head only; no private audit entries or sealing controls. |
| Contact records, API keys, audit writes, task execution | closed | Not reachable anonymously. Members, Guests, Keys and Settings pages are removed. Ingest and agent endpoints keep their signed auth. |
| Open model API | anyone, read-only | `/api/model/body`, `/api/model/state`, `/api/model/concepts` (MeSH), `/api/model/openapi.json`, `/llms.txt`. Teaching data only; no personal data. |
| **Downloads** (`/downloads`) | anyone, read-only | Existing public packages with licence/checksum. Account uploads and removal are disabled. |
| Public feed | anyone, read-only | `/api/public/research-feed` for rabbitsoftware.io. |
| Owner cloud shell, Vault cloud jobs | existing verified owner session only | `/cloudshell`, `/vault-jobs`; separate opt-in BFF boundary, not anonymous account access. Services are not deployed by this change. |

## Commands

### Open-access boundary

 serves the pages directly and allows server-action POSTs on them ( in ).
Old login, signup, guest, members, guests, keys, settings and  URLs redirect to . Opened APIs: ,
,  and the public reads; every other  path returns 410. Signed ingest, agent and MCP
endpoints keep their own credential validation. Data access goes through the server admin client with explicit column lists;
migration  (apply by hand) opens public read and keeps writes service-role only.

### Allowlisted cloud tools

The Zero Trust team domain was renamed on 2026-10-12 to
`rsi-helloworld.cloudflareaccess.com`. The isolated Access console trusts
`https://rsi-helloworld.cloudflareaccess.com` as its issuer; its application
audience, exact-email/service-token policies, and credentials are unchanged.
Use a fresh application login after the rename. Any enrolled Cloudflare One
clients must use the new team name; the old name is no longer reserved.

#### Three independent entry points

The **main `rabbit-web` Worker stays local-only**, including all existing
production bindings/secrets in `cloudflare.config.ts`. No main custom domain or
account selection was changed. The same source now builds two **different**
Workers, not a browser mode switch or authentication fallback:

| Entry | cf/Vite mode | Worker name | Auth binding |
|---|---|---|---|
| Existing main (`app.rabbitsoftware.io`) | default / `local-primary` | `rabbit-web` | `local-only` |
| New isolated Supabase | `cloud-supabase` | `rabbit-web-cloud-supabase` | `supabase` |
| New isolated Access | `cloud-access` | `rabbit-web-cloud-access` | `cloudflare-access` |

Both isolated Workers are deployed (see "Verified isolated activation" below).
They explicitly select account `f78fa7ea6c63f95d9512053554416e32` and
`workersDev: true`, with **no routes/custom domains**, on the account's
workers.dev subdomain `rabbitsoftware-gateway`:
`https://rabbit-web-cloud-supabase.rabbitsoftware-gateway.workers.dev` and
`https://rabbit-web-cloud-access.rabbitsoftware-gateway.workers.dev`.
The backend Worker is separately named `rabbitsoftware-cloudshell`.

This repo uses **typed `cloudflare.config.ts` / cf**, not Wrangler environment
blocks. `defineConfig(({mode}) => ...)` selects source bindings at build time.
Each remote policy in `src/lib/cloud-deployment.ts` is independent; the supplied
eligible email is explicitly configured only there for both remote profiles.
Everything else remains blank. Remote branches bind only ASSETS, explicit
policy text, and three required bridge/machine secrets. They **do not inherit**
main service-role, encrypted-contact, ingestion, email or AI bindings/secrets.
Unknown/typo modes fail rather than falling back to another authentication mode.

Build locally (no deploy, secret writes or provider sign-ins):
```powershell
npm run build:console:supabase
npm run build:console:access
npm run build:console:local
```
Each build verifies generated `.cloudflare/output/v0` Worker name, mode/policy
and isolated bindings with `scripts/check-console-build.mjs`. The output location
is shared and **the latest build replaces the previous target**. Never deploy
the wrong cached bundle or use `--skip-build` to retarget it. The normal vinext
deployment wrapper propagates `--env` as cf/Vite `--mode` and rebuilds the target.

**Future deployment commands, ONLY after explicit deployment/secret approval:**
```powershell
npm run deploy:console:supabase
npm run deploy:console:access
# Main production must stay untouched unless separately requested:
# npm run deploy:console:local
```
These use installed `vinext-cloudflare deploy --env cloud-supabase|cloud-access`
(typed cf project); no `--name` override, Wrangler migration or resource creation
is needed for build. Existing `npm run deploy:vinext` still targets main local-only.

Configuration and rollout boundaries (approved pilot evidence below):
- Authorized Cloudflare deploy identity/token for supplied account; configure
  `CLOUDFLARE_API_TOKEN` safely, never source/command-log its value. Main account
  is not pinned/changed; isolated targets use the supplied account explicitly.
- Confirm proposed Worker names and actual workers.dev subdomain. Access app
  must cover the **isolated Access origin**, including machine endpoints; don't
  mutate `app.rabbitsoftware.io`. Configure verified-human policy plus named
  service identity policy externally, then issuer/AUD/service Client ID in source.
- Independently edit each remote nonsecret policy: `CLOUD_TOOLS_ALLOWED_EMAILS`,
  `CLOUD_TOOLS_AGENT_ID`, `CLOUD_TOOLS_AGENT_SCOPES`,
  `RABBIT_CLOUDSHELL_URL`, `VAULT_AGENT_URL`, `VAULT_AGENT_ROOTS`;
  Supabase instance needs `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` for an **existing confirmed eligible account**.
  Access instance needs `CLOUD_TOOLS_ACCESS_ISSUER`, `CLOUD_TOOLS_ACCESS_AUD`,
  `CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME`. Do not copy policy/credentials from `.env.local`
  or main worker implicitly. Config-declared text overwrites dashboard values
  on deployment; approved policy must be represented in the selected source.
- Install **per isolated Worker** secrets `RABBIT_CLOUDSHELL_TOKEN`,
  `VAULT_AGENT_TOKEN`, `CLOUD_TOOLS_AGENT_TOKEN` securely when approved.   No inheritance from main. Broker backend token and
  machine caller token stay distinct; NEVER bind `RABBIT_AGENT_APPROVAL_TOKEN`.
- Parent must independently configure/deploy `rabbitsoftware-cloudshell`
  AccessGate/sandbox with subject/scope allowlist and distinct approver secret,
  confirm eligible-image availability and paid-container approval.   Docker is installed; the matching Linux image and live shell are verified.
  Native Windows container development still needs WSL Node/Docker integration.
  No one-hour grant is created by an eligible email or console deployment.
- CLI `RABBIT_CLOUD_TOOLS_URL` selects the appropriate remote origin; it sends
  dedicated `CLOUD_TOOLS_AGENT_TOKEN`, and for Access edge optional
  `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`.   The signed Access service `common_name` must match the configured Client ID
  and `sub` must be empty. The approved identity is `local-vault-agent`.
- Verify actual same-origin URLs, rejected origins/identities, pending/revoked
  grants, same-grant job isolation and paid execution before claiming activation.
  No DB schema change, broad accounts, signup or automatic private upload.

Only `/api/cloudshell/execute` POST, `/api/vault/jobs` POST and
`/api/vault/jobs/<64 lowercase hex>` GET (optionally `/result`) bypass the old
410 boundary. Remote mode defaults to **local-only**, denying ALL human and
machine remote integrations. Operator `CLOUD_TOOLS_ACCESS_MODE` selects
`local-only`, `supabase`, or `cloudflare-access`; browsers cannot change policy.
Supabase mode verifies an existing session with `auth.getUser()`, confirmed
email and exact normalized `CLOUD_TOOLS_ALLOWED_EMAILS`. Access mode validates
an RS256 application JWT signature, issuer, application audience and expiry
using the fixed configured team JWKS, then the same email allowlist. No
user_metadata or unsigned email header authorization.

Human subjects are derived server-side as `email:<verified lowercased email>`.
Authentication alone is **pending**, not permission to run tools. Human
POST `/api/cloud-access/request` accepts only `{scopes}` with strict same-origin
JSON CSRF; GET `/api/cloud-access/status` refreshes status manually. Each
operation checks authoritative broker `/access/check` with the authenticated
subject, exact scope and unexpired at-most-one-hour grant. No local grant cache,
browser-supplied subject/approved flag/request ID, or approval token is trusted.
The separate approver agent controls approvals/revocations; its secret is NEVER
configured in this console. Withdrawal/revocation is observed on the next check.

The initial machine/login patch denial was preserved until the user explicitly
authorized completion. `/cloud-login` now exposes password sign-in **only in
Supabase mode**, POST `/api/cloud-login`: strict same-origin JSON, 4096-byte
body, exact email/password fields, existing allowlist checked before provider
request, existing-user `signInWithPassword()` only, then `getUser()` verifies
confirmed allowlisted matching email. Failed/denied verification signs out and
returns a generic error. Returned or thrown provider sign-out failures instead
return explicit sanitized 503 stating session clearance is NOT confirmed; raw
provider details are never logged/exposed. Every later cloud request still
verifies identity and grant independently. No signup, password logging/storage, legacy login or
account restoration. Credentials are cleared from form state after each attempt.
Authentication never approves access by itself.

Dedicated machine endpoints are POST `/api/cloud-agent/access/request`,
GET `/api/cloud-agent/access/status`, POST `/api/cloud-agent/shell`,
POST `/api/cloud-agent/vault/jobs`, and GET `/api/cloud-agent/vault/jobs/<id>`
(optionally `/result`). They reuse shared identity, grant, snapshot, command,
job-binding and proxy helpers. No console approver endpoints exist.

Dedicated machine policy uses `CLOUD_TOOLS_AGENT_TOKEN` (at least 32 characters),
safe 1–64-character `CLOUD_TOOLS_AGENT_ID`, explicit comma-separated
`CLOUD_TOOLS_AGENT_SCOPES`. Machine routes refuse ANY Origin, use timing-safe
Bearer comparison, derive `agent:<configured id>`, and in Access mode additionally
verify the signed JWT, empty service `sub` and exact
`CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME` (the Client ID, not human email).
JWT config is `CLOUD_TOOLS_ACCESS_ISSUER=https://<team>.cloudflareaccess.com`,
`CLOUD_TOOLS_ACCESS_AUD`; JWKS URLs are derived only from that operator issuer.
Existing installed jose is pinned as a direct dependency for reproducibility.

Vault submission links its verified returned ID to the authenticated subject
and active grant through broker `/access/link-job`. Status/results require
`/access/check-job` approval for the same subject/job/grant before upstream
reads. A `vault.read` grant is NOT permission to read other people's or agents'
guessed job IDs. Expiry/revocation loses linkage authorization; reapproval needs
resubmission/relinking. Link failure after actual submission returns a visible
error with the submitted ID for operator recovery, never a success-shaped result
or automatic retry. The broker persists at most 64 links per grant; no app DB
schema or global shared-job policy is introduced.

### Verified isolated activation, 2026-10-12

Both isolated consoles and the separate shell/broker are deployed. The main
`rabbit-web` console was not redeployed and stays `local-only`.

- Supabase console: https://rabbit-web-cloud-supabase.rabbitsoftware-gateway.workers.dev
- Access console: https://rabbit-web-cloud-access.rabbitsoftware-gateway.workers.dev
- Shell/broker: https://rabbitsoftware-cloudshell.rabbitsoftware-gateway.workers.dev

The named `local-vault-agent` requested scoped access, a separately authenticated
approving coding agent approved it, and both live machine routes returned
exact synthetic command stdout with exit 0 and no timeout/truncation.
The Access app has two verified reusable policies: the exact approved email,
and one specific pilot service token. Anonymous Access returns an authentication
redirect. A consented public-synthetic note job completed with its exact marker/
path and no edits; both consoles returned the same current-grant-linked result.
Guessed job IDs and machine browser Origins were denied. Human browser sign-in
remains unverified; no private notes were uploaded during these checks.

The pilot service token expires 2026-10-13T18:44:42Z. Broker grants last one
hour and neither credential nor grant is silently renewed. Access service JWTs
use an empty `sub` and signed `common_name` Client ID; human JWTs cannot satisfy
the machine identity check.

Live forwarding initially failed with a redirect-mode transport error. The
BFF now requests `redirect: manual` and explicitly rejects redirect responses,
with a regression checking that no second fetch occurs. Unknown failures retain
sanitized classification logs without credentials, request bodies or arbitrary
exception messages. The isolated fetch compatibility flag alone did not fix it.

Approved redeployment uses the protected helper from this repository:

```powershell
node scripts\deploy-cloud-console.mjs cloud-supabase --vault "<vault path>" --shell-secrets "<ignored shell production secret file>"
node scripts\deploy-cloud-console.mjs cloud-access --vault "<vault path>" --shell-secrets "<ignored shell production secret file>"
```

It verifies the selected credential snapshot is Git-ignored, reuses credentials
without implicit rotation, selects only public Supabase configuration and the
existing explicitly approved note provider, and transfers only caller/backend/
note credentials. Access additionally reads its protected
`.env.cloud-access-client` snapshot to supply only the public Client ID in the
policy; its Client Secret stays caller-local. The verified public issuer/AUD
are recorded in [cloud-deployment.ts](src/lib/cloud-deployment.ts). Approval
secrets never enter a console. The helper refuses missing/invalid configuration,
changed existing snapshots, deployment failures and automatic fallback.

Actor flow (source responsibilities):
```text
human verified Supabase/Access + owner email allowlist
  -> BFF identity(email:...) -> broker request(pending)
named agent dedicated token [+ signed Access service JWT]
  -> BFF identity(agent:...) -> broker request(pending)
separate approver agent -> AccessGate DO approve/deny/revoke (no console token)
BFF per-operation scope+expiry check -> shell /execute or vault /jobs
vault submit -> persistent same-grant subject/job link
vault status/result -> persistent same-grant subject/job check
local-only -> deny every remote path before credential use/network
```

Configure server-only `RABBIT_CLOUDSHELL_URL`, `RABBIT_CLOUDSHELL_TOKEN`,
`VAULT_AGENT_URL`, `VAULT_AGENT_TOKEN` only when the separate services are ready.
URLs must be HTTPS; requests never follow redirects or forward browser Origin,
cookies or app credentials. The shell token must contain at least 32 characters.
Writes require exact same Origin and JSON.
No deployment, database changes, plugins or credentials inside the shell are
included. The shell worker owns instance limits (maximum two), owner sandbox
selection and its authoritative one-command-at-a-time lock.

The shell sends `{command, consent:true}` to `/execute` with a 4000 UTF-8-byte
limit. Each run requires fresh consent; commands launch independently, are
limited remotely to 60 seconds, and may use billable networking. Files are
ephemeral and the container is destroyed after each command. Startup/teardown
may extend the bounded overall BFF wait to 210 seconds. An expired request does
not prove cancellation; there are no automatic retries. `timedOut`, `truncated`,
stderr and nonzero exit codes remain visible, never interpreted as success.
Serialized upstream output is bounded to 256 KiB and rendered as text. Copy/download is
local and owner-only; commands/reports are not logged or stored by this BFF.

Vault jobs accept manually entered/uploaded snapshots only; no vault filesystem
is read and no notes are automatically selected or written. Set server-only
`VAULT_AGENT_ROOTS` to a comma-separated exact subset of
`Cloud Agents/Knowledge/`, `Agents/`, `Workers/` (trailing slashes required).
Missing or any invalid entry fails closed; roots are not inferred.
Each note must have a unique relative `.md` path under those roots and exact
top-level `cloud-agent-share:` frontmatter with trimmed value `true`; trailing
whitespace is accepted, quoted/comment values and duplicate unquoted keys fail.
Windows reserved/unsafe paths, dot-prefixed components, trailing dots/spaces,
case-insensitive duplicates, NUL and common private-key/GitHub/AWS credential
patterns in note contents fail before forwarding. Paths are limited to 240
characters. Instruction is trimmed and limited to 4000 UTF-8 bytes; notes are
sorted lexically for deterministic snapshots. Limits: 40 notes, 16000 UTF-8 bytes/note,
64 KiB actual serialized upstream snapshot. BFF-only `consent:true` is removed
before forwarding `{mode,instruction,notes}` to upstream **`/jobs`**, not
`/vault/jobs`. Browser endpoints stay `/api/vault/jobs`; status and result proxy
to `/jobs/<id>` and `/jobs/<id>/result`. Submit/status response IDs must be 64
lowercase hex and status IDs must match the requested job. Results MUST contain the exact requested ID, valid
mode (`task`, `answer`, `organize`), string answer and an edits array of objects;
missing/mismatched IDs or invalid output shape fail with sanitized 502.
Status/results are manually
retrieved with the same owner check. Results are proposals, not automatic edits.

Local validation: `node --test tests\cloud-login.test.mjs tests\cloud-access.test.mjs tests\cloud-jobs.test.mjs tests\account-free.test.mjs`,
`npx tsc --noEmit`, and targeted ESLint. No remote writes/deployment are needed.

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
