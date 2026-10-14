// Command catalog: the commands the owner built across rabbit-web, rabbitsoftware-cloudflare (incl. workers/vault-agent and the vault:* scripts)
// and research-agents. Pure data and helpers (no imports) so Node tests can load it; rendering lives in the /commands page and the shell components.
//
// Every entry comes from a tracked file named in `source` (package.json scripts, README/DEVELOPMENT/docs, scripts/, Python entry points and tests).
// Nothing here runs a command. The page and the drawers only show text, copy it, or type it into a terminal WITHOUT pressing Enter.
//
// scope 'public': read, test, lint, typecheck, build, dev-server, ledger and public-source commands that need no secret, write nothing remote,
//   and are valid in the public sandbox image (only /workspace/rabbit-web and the site/ folder of /workspace/rabbitsoftware-site exist there).
// scope 'owner': anything that deploys, applies migrations, writes secrets, uses a service role or ingest secret, touches the owner's vault or data,
//   or needs a full private checkout (rabbitsoftware-cloudflare, research-agents). Owner commands without a `cd /workspace/...` prefix are meant to
//   be run from the root of their own repo on the owner's computer.

export type CommandScope = 'public' | 'owner'
export type CommandRisk = 'read' | 'local' | 'network' | 'deploy' | 'secret'
export type CommandProject = 'rabbit-web' | 'rabbitsoftware-cloudflare' | 'research-agents'

export interface CatalogEntry {
  id: string
  project: CommandProject
  group: string
  label: string
  command: string
  description: string
  scope: CommandScope
  /** Environment variable NAMES the command reads (never values). */
  needs?: string[]
  risk: CommandRisk
  /** Tracked file that documents the command. */
  source: string
}

/** CloudShell contract: one bash command string, at most 4000 UTF-8 bytes, no NUL. */
export const COMMAND_MAX_BYTES = 4000

export const PROJECTS: readonly CommandProject[] = ['rabbit-web', 'rabbitsoftware-cloudflare', 'research-agents']

export const RISK_TEXT: Record<CommandRisk, string> = {
  read: 'Reads only',
  local: 'Runs locally, writes files here',
  network: 'Uses the network (reads)',
  deploy: 'Deploys or changes remote resources',
  secret: 'Needs or handles secrets',
}

type Seed = Omit<CatalogEntry, 'project' | 'source'> & { source?: string }
const seed = (project: CommandProject, source: string, rows: Seed[]): CatalogEntry[] => rows.map((r) => ({ ...r, project, source: r.source ?? source }))

// A writable copy of the read-only public checkout: /workspace is read-only and has no node_modules.
const WEB_COPY = 'rm -rf ~/rabbit-web && cp -r --no-preserve=mode /workspace/rabbit-web ~/rabbit-web && cd ~/rabbit-web'
const WEB_INSTALL = `${WEB_COPY} && npm ci --ignore-scripts`
const VAULT = '--vault "<vault-path>"'

const RABBIT_WEB: CatalogEntry[] = [
  ...seed('rabbit-web', 'package.json', [
    { id: 'web-test-auth', group: 'Checks', label: 'Run all unit tests', scope: 'public', risk: 'local',
      command: 'cd /workspace/rabbit-web && npm run test:auth',
      description: 'All unit tests with node --test (npm run test:auth). Writes nothing to the repo.' },
    { id: 'web-lint', source: 'package.json', group: 'Checks', label: 'Lint', scope: 'public', risk: 'network',
      command: `${WEB_INSTALL} && npm run lint`,
      description: 'Installs dependencies in a writable copy under your home folder, then runs ESLint (npm run lint).' },
    { id: 'web-tsc', source: 'README.md', group: 'Checks', label: 'Type check', scope: 'public', risk: 'network',
      command: `${WEB_INSTALL} && npx tsc --noEmit`,
      description: 'Installs dependencies in a writable copy, then runs npx tsc --noEmit (README.md).' },
    { id: 'web-build-vinext', group: 'Build and dev server', label: 'Build the vinext app', scope: 'public', risk: 'network',
      command: `${WEB_INSTALL} && npm run build:vinext`,
      description: 'Builds the Cloudflare/vinext bundle in a writable copy (npm run build:vinext). Does not deploy.' },
    { id: 'web-dev-vinext', group: 'Build and dev server', label: 'Start the dev server (port 3001)', scope: 'public', risk: 'network',
      command: `${WEB_INSTALL} && npm run dev:vinext`,
      description: 'Runs vite dev on port 3001 inside the sandbox (npm run dev:vinext). Stop it with Ctrl+C. No inbound ports are exposed, so use curl localhost:3001.' },
    { id: 'web-write-headers', source: 'scripts/write-static-headers.mjs', group: 'Build and dev server', label: 'Write static security headers', scope: 'public', risk: 'local',
      command: `${WEB_COPY} && node scripts/write-static-headers.mjs`,
      description: 'Writes public/_headers from src/lib/security-headers.ts in a writable copy (scripts/write-static-headers.mjs).' },
    { id: 'web-twin-fixtures', source: 'scripts/make-twin-fixtures.mjs', group: 'Build and dev server', label: 'Make twin interop test fixtures', scope: 'public', risk: 'local',
      command: 'cd /workspace/rabbit-web && node scripts/make-twin-fixtures.mjs ~/ts-twin.json',
      description: 'Writes two throwaway TEST identities, a request and a response to ~/ts-twin.json (scripts/make-twin-fixtures.mjs). Test keys only.' },
    { id: 'web-chain-export', source: 'scripts/chain-export.mjs', group: 'Public ledger', label: 'Download and verify the public chain ledger', scope: 'public', risk: 'network',
      command: 'cd /workspace/rabbit-web && node scripts/chain-export.mjs export https://app.rabbitsoftware.io ~/chain.jsonl && node scripts/chain-export.mjs verify ~/chain.jsonl',
      description: 'Reads GET /api/chain/ledger from the public origin, checks every hash link, saves ~/chain.jsonl, then verifies the saved file (scripts/chain-export.mjs).' },
    { id: 'web-data-manifest', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: list the datasets', scope: 'public', risk: 'network',
      command: 'curl -fsS https://app.rabbitsoftware.io/api/data | jq',
      description: 'Reads GET /api/data: every dataset with columns, row counts, endpoints and the ledger head. Public and read-only (docs/rabbitos.md, Data hub).' },
    { id: 'web-data-research-records', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Research records', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/research_records?limit=50" | jq',
      description: 'Reads the first 50 rows of the public research_records dataset (GET /api/data/research_records). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-research-topics', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Research topics', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/research_topics?limit=50" | jq',
      description: 'Reads the first 50 rows of the public research_topics dataset (GET /api/data/research_topics). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-research-runs', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Research runs', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/research_runs?limit=50" | jq',
      description: 'Reads the first 50 rows of the public research_runs dataset (GET /api/data/research_runs). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-research-summaries', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: AI summaries', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/research_summaries?limit=50" | jq',
      description: 'Reads the first 50 rows of the public research_summaries dataset (GET /api/data/research_summaries). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-agents', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Agents', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/agents?limit=50" | jq',
      description: 'Reads the first 50 rows of the public agents dataset (GET /api/data/agents). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-chain-blocks', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Network chain blocks', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/chain_blocks?limit=50" | jq',
      description: 'Reads the first 50 rows of the public chain_blocks dataset (GET /api/data/chain_blocks). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-node-scores', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Node scores', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/node_scores?limit=50" | jq',
      description: 'Reads the first 50 rows of the public node_scores dataset (GET /api/data/node_scores). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-merkle-batches', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Merkle batches', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/merkle_batches?limit=50" | jq',
      description: 'Reads the first 50 rows of the public merkle_batches dataset (GET /api/data/merkle_batches). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-audit-entries', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Audit entries', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/audit_entries?limit=50" | jq',
      description: 'Reads the first 50 rows of the public audit_entries dataset (GET /api/data/audit_entries). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-ledger', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Chain ledger metadata', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/ledger?limit=50" | jq',
      description: 'Reads the first 50 rows of the public ledger dataset (GET /api/data/ledger). Add &format=csv or &q=text. Read-only.' },
    { id: 'web-data-commands', source: 'docs/rabbitos.md', group: 'Public data hub', label: 'Data hub: Public commands', scope: 'public', risk: 'network',
      command: 'curl -fsS "https://app.rabbitsoftware.io/api/data/commands?limit=50" | jq',
      description: 'Reads the first 50 rows of the public commands dataset (GET /api/data/commands). Add &format=csv or &q=text. Read-only.' },
  ]),
  // The RabbitNet PowerShell module (scripts/powershell/). Run in PowerShell on the owner's own PC from the repo root. It reads public endpoints only and uploads nothing.
  ...seed('rabbit-web', 'scripts/powershell/RabbitNet.psd1', [
    { id: 'web-ps-import', group: 'PowerShell on your PC', label: 'Load the RabbitNet module (run in PowerShell on your PC)', scope: 'owner', risk: 'local',
      command: 'Import-Module ./scripts/powershell/RabbitNet.psd1 -Force',
      description: 'Run in PowerShell on your PC, from the rabbit-web folder. Loads Test-RabbitConnection, Get-RabbitChainHead and Sync-RabbitChain. Default connection is your normal one (no proxy).' },
    { id: 'web-ps-test', group: 'PowerShell on your PC', label: 'Check the RabbitOS connection (run in PowerShell on your PC)', scope: 'owner', risk: 'network',
      command: 'Test-RabbitConnection',
      description: 'Run in PowerShell on your PC after Import-Module. DNS, TCP 443, TLS, HTTP status and latency for app.rabbitsoftware.io and /api/chain/head. Add -NetworkTools for extra diagnostics (asks first).' },
    { id: 'web-ps-sync', group: 'PowerShell on your PC', label: 'Pull and verify the public ledger (run in PowerShell on your PC)', scope: 'owner', risk: 'network',
      command: 'Sync-RabbitChain',
      description: 'Run in PowerShell on your PC after Import-Module. Pulls the public ledger into a local .jsonl, verifies the hash chain, refuses a broken one. Uploads nothing.' },
  ]),
  ...seed('rabbit-web', 'package.json', [
    { id: 'web-dev', source: 'README.md', group: 'Local development', label: 'Next dev server', scope: 'owner', risk: 'local',
      command: 'npm run dev',
      description: 'npm run dev on http://localhost:3000. Needs your .env.local (README.md).' },
    { id: 'web-verify-ai', source: 'scripts/verify-ai-providers.mjs', group: 'Local development', label: 'Verify AI providers (your keys)', scope: 'owner', risk: 'network',
      needs: ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'COPILOT_GITHUB_TOKEN'],
      command: 'npm run verify:ai',
      description: 'Lists Gemini models, sends one tiny request to each provider whose key is set in your environment, checks the CLI packages with npm view, and prints PASS/FAIL/SKIPPED. Never prints keys. With no keys only the npm checks run.' },
    { id: 'web-build-console-local', group: 'Console builds', label: 'Build console: local-primary', scope: 'owner', risk: 'local',
      command: 'npm run build:console:local',
      description: 'vite build --mode local-primary, then scripts/check-console-build.mjs. Build only; the latest build replaces the previous target.' },
    { id: 'web-build-console-supabase', source: 'README.md', group: 'Console builds', label: 'Build console: cloud-supabase', scope: 'owner', risk: 'local',
      command: 'npm run build:console:supabase',
      description: 'Isolated Supabase console build and output check (README.md). Build only.' },
    { id: 'web-build-console-access', source: 'README.md', group: 'Console builds', label: 'Build console: cloud-access', scope: 'owner', risk: 'local',
      command: 'npm run build:console:access',
      description: 'Isolated Cloudflare Access console build and output check (README.md). Build only.' },
    { id: 'web-start-vinext', group: 'Console builds', label: 'Preview the vinext build', scope: 'owner', risk: 'local',
      command: 'npm run start:vinext',
      description: 'vite preview of an existing build.' },
    { id: 'web-deploy-vinext', group: 'Deploy', label: 'Deploy production (app.rabbitsoftware.io)', scope: 'owner', risk: 'deploy',
      command: 'npm run deploy:vinext',
      description: 'Production deploy to Cloudflare. Run it only deliberately and with an explicit go-ahead (CLAUDE.md, README.md).' },
    { id: 'web-deploy-console-local', source: 'README.md', group: 'Deploy', label: 'Deploy console: local-primary', scope: 'owner', risk: 'deploy',
      command: 'npm run deploy:console:local',
      description: 'vinext-cloudflare deploy --env local-primary. Main production; README.md says leave it untouched unless separately requested.' },
    { id: 'web-deploy-console-supabase', source: 'README.md', group: 'Deploy', label: 'Deploy console: cloud-supabase', scope: 'owner', risk: 'deploy',
      command: 'npm run deploy:console:supabase',
      description: 'Deploys the isolated Supabase console Worker. Only after explicit deployment approval (README.md).' },
    { id: 'web-deploy-console-access', source: 'README.md', group: 'Deploy', label: 'Deploy console: cloud-access', scope: 'owner', risk: 'deploy',
      command: 'npm run deploy:console:access',
      description: 'Deploys the isolated Access console Worker. Only after explicit deployment approval (README.md).' },
    { id: 'web-deploy-cloud-supabase', source: 'README.md', group: 'Deploy', label: 'Cloud console deploy script: cloud-supabase', scope: 'owner', risk: 'secret',
      command: `node scripts/deploy-cloud-console.mjs cloud-supabase ${VAULT} --shell-secrets "<secrets-file>"`,
      description: 'README.md form of scripts/deploy-cloud-console.mjs. Reads an ignored secrets file and your vault; deploys.' },
    { id: 'web-deploy-cloud-access', source: 'README.md', group: 'Deploy', label: 'Cloud console deploy script: cloud-access', scope: 'owner', risk: 'secret',
      command: `node scripts/deploy-cloud-console.mjs cloud-access ${VAULT} --shell-secrets "<secrets-file>"`,
      description: 'README.md form of scripts/deploy-cloud-console.mjs for the Access console. Reads an ignored secrets file and your vault; deploys.' },
    { id: 'web-r2-create', source: 'docs/rabbitos.md', group: 'Deploy', label: 'Create the chain mirror R2 bucket', scope: 'owner', risk: 'deploy',
      command: 'npx wrangler r2 bucket create rabbitos-chain-mirror',
      description: 'One-time setup from docs/rabbitos.md, then deploy so the binding exists.' },
    { id: 'web-r2-list', source: 'docs/rabbitos.md', group: 'Deploy', label: 'List R2 buckets', scope: 'owner', risk: 'read',
      command: 'npx wrangler r2 bucket list',
      description: 'Checks the chain mirror bucket exists (docs/rabbitos.md). Uses your Cloudflare login.' },
    { id: 'web-schema-snapshot', source: 'scripts/snapshot-api-schema.mjs', group: 'Database', label: 'Snapshot the API schema', scope: 'owner', risk: 'secret',
      command: 'npm run schema:snapshot', needs: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      description: 'Writes a structural snapshot of the Supabase public schema into supabase/schema/ (scripts/snapshot-api-schema.mjs). Read-only, uses the service role.' },
    { id: 'web-schema-dump', source: 'scripts/dump-schema.mjs', group: 'Database', label: 'Dump the full schema', scope: 'owner', risk: 'secret',
      command: 'npm run schema:dump', needs: ['SUPABASE_DB_URL'],
      description: 'Writes supabase/schema/full_schema.sql (scripts/dump-schema.mjs). Read-only, needs the database URL.' },
    { id: 'web-chain-import', source: 'scripts/chain-export.mjs', group: 'Database', label: 'Push missing chain events to the site', scope: 'owner', risk: 'secret',
      command: 'node scripts/chain-export.mjs import https://app.rabbitsoftware.io ~/chain.jsonl', needs: ['INGEST_SHARED_SECRET'],
      description: 'Signed POST to /api/chain/import for events the site is missing (scripts/chain-export.mjs). Writes remote data.' },
    { id: 'web-concepts', source: 'scripts/build-concepts.mjs', group: 'Database', label: 'Rebuild MeSH concept IDs', scope: 'owner', risk: 'network',
      command: 'node scripts/build-concepts.mjs',
      description: 'Looks up MeSH IDs live and rewrites src/lib/concepts.generated.json (scripts/build-concepts.mjs). Its host is not on the public sandbox allowlist.' },
    { id: 'web-add-umls', source: 'scripts/add-umls.ps1', group: 'Database', label: 'Add UMLS CUIs (asks for your key)', scope: 'owner', risk: 'secret',
      command: '.\\scripts\\add-umls.ps1', needs: ['UMLS_API_KEY'],
      description: 'PowerShell helper that asks for your UMLS key privately and adds CUIs to the body model (scripts/add-umls.ps1).' },
    { id: 'web-contact-keys', source: 'scripts/contact-keys.mjs', group: 'Contact records', label: 'Create contact record keys', scope: 'owner', risk: 'secret',
      command: 'npm run contacts:keys',
      description: 'Writes your PRIVATE key outside the repo and the public key to .dev.vars (scripts/contact-keys.mjs). Run it yourself, on your machine.' },
    { id: 'web-contact-selftest', source: 'scripts/contact-lookup.mjs', group: 'Contact records', label: 'Contact key self-test', scope: 'owner', risk: 'secret',
      command: 'npm run contacts:selftest',
      description: 'Proves a private key matches the public key the site uses (scripts/contact-lookup.mjs selftest). No database access.' },
    { id: 'web-contact-lookup', source: 'docs/legal-requests.md', group: 'Contact records', label: 'Open a contact record (legal request)', scope: 'owner', risk: 'secret',
      command: 'npm run contacts:lookup -- --email person@example.com --key "<private-key-path>" --reason "<reason>" --ref "<legal-reference>"',
      description: 'Opens one record for a valid legal request and writes an append-only access log (docs/legal-requests.md).' },
    { id: 'web-contact-purge', source: 'docs/legal-requests.md', group: 'Contact records', label: 'Purge expired contact records', scope: 'owner', risk: 'secret',
      command: 'npm run contacts:lookup -- purge-expired --reason "monthly retention purge" --ref "retention policy"',
      description: 'Retention purge from docs/legal-requests.md.' },
  ]),
]

const CF = 'rabbitsoftware-cloudflare'
const CLOUDFLARE: CatalogEntry[] = [
  ...seed(CF, 'workers/public-shell/container', [
    { id: 'cf-ledger', group: 'Public sandbox helpers', label: 'Show the public ledger', scope: 'public', risk: 'network',
      command: 'ledger',
      description: 'Sandbox helper: prints the public chain head, then the ledger (container/ledger). Public endpoints only.' },
    { id: 'cf-repos', group: 'Public sandbox helpers', label: 'List the read-only repos', scope: 'public', risk: 'read',
      command: 'repos',
      description: 'Sandbox helper: lists the public code in /workspace (container/repos).' },
    { id: 'cf-rabbit-net-check', source: 'workers/public-shell/container/rabbit-net', group: 'Public sandbox helpers', label: 'Check the sandbox connection (HTTPS reachability of allowed hosts)', scope: 'public', risk: 'network',
      command: 'rabbit-net check',
      description: 'Sandbox helper: curl --head with a 5 s timeout to each allowlisted host only. No scanning, no ping or DNS tools (not installed). "rabbit-net status" shows the allowlist.' },
    { id: 'cf-pwsh-version', source: 'workers/public-shell/Dockerfile', group: 'Public sandbox helpers', label: 'Show the PowerShell 7 version in the sandbox', scope: 'public', risk: 'read',
      command: 'pwsh --version',
      description: 'Prints the PowerShell 7 version installed in the sandbox. Type pwsh alone to start it; the login shell stays bash.' },
  ]),
  ...seed(CF, 'DEVELOPMENT.md', [
    { id: 'cf-site-static', source: 'DEVELOPMENT.md', group: 'Public sandbox helpers', label: 'Serve the static website (port 8788)', scope: 'public', risk: 'local',
      command: 'cd /workspace/rabbitsoftware-site && python3 -m http.server 8788 --bind 127.0.0.1 --directory site',
      description: 'The "Dev site (static, no tooling)" command from DEVELOPMENT.md on the sandbox copy of site/. Stop with Ctrl+C.' },
  ]),
  ...seed(CF, 'package.json', [
    { id: 'cf-dev-site', group: 'Dev servers', label: 'Dev: website (Pages)', scope: 'owner', risk: 'local',
      command: 'npm run dev:site', description: 'wrangler pages dev site on port 8788.' },
    { id: 'cf-dev-sync', group: 'Dev servers', label: 'Dev: sync Worker', scope: 'owner', risk: 'local',
      command: 'npm run dev:sync', description: 'Local-only wrangler dev for workers/sync on port 8801 (never points at production).' },
    { id: 'cf-dev-node-worker', group: 'Dev servers', label: 'Dev: node-worker', scope: 'owner', risk: 'local',
      command: 'npm run dev:node-worker', description: 'Local-only wrangler dev for workers/node-worker on port 8802.' },
    { id: 'cf-dev-gateway', group: 'Dev servers', label: 'Dev: gateway', scope: 'owner', risk: 'local',
      command: 'npm run dev:gateway', description: 'Local-only wrangler dev for workers/gateway on port 8803.' },
    { id: 'cf-dev-vault-agent', source: 'package.json', group: 'Dev servers', label: 'Dev: vault-agent Worker', scope: 'owner', risk: 'local',
      command: 'npm run dev:vault-agent', description: 'wrangler dev for workers/vault-agent on port 8805 using only simulated -dev storage (DEVELOPMENT.md).' },
    { id: 'cf-dev-cloudshell', group: 'Dev servers', label: 'Dev: owner cloudshell Worker', scope: 'owner', risk: 'local',
      command: 'npm run dev:cloudshell', description: 'Local wrangler dev for workers/cloudshell on port 8806.' },
    { id: 'cf-dev-public-shell', group: 'Dev servers', label: 'Dev: public-shell Worker', scope: 'owner', risk: 'local',
      command: 'npm run dev:public-shell', description: 'Local wrangler dev for workers/public-shell on port 8807.' },
    { id: 'cf-test-tasks', group: 'Tests and checks', label: 'Test: tasks Worker', scope: 'owner', risk: 'local',
      command: 'npm run test:tasks', description: 'node --test scripts/test-tasks-worker.mjs.' },
    { id: 'cf-test-cloudshell', group: 'Tests and checks', label: 'Test: cloudshell and cloud access', scope: 'owner', risk: 'local',
      command: 'npm run test:cloudshell', description: 'Cloudshell, cloud-access and vault cloud-access tests.' },
    { id: 'cf-test-public-shell', group: 'Tests and checks', label: 'Test: public-shell Worker', scope: 'owner', risk: 'local',
      command: 'npm run test:public-shell', description: 'node --test scripts/test-public-shell.mjs.' },
    { id: 'cf-test-site', group: 'Tests and checks', label: 'Test: website pages (chain viewer, data hub)', scope: 'owner', risk: 'local',
      command: 'npm run test:site', description: 'node --test scripts/test-chain-viewer.mjs scripts/test-site-data.mjs.' },
    { id: 'cf-typecheck-public-shell', group: 'Tests and checks', label: 'Typecheck: public-shell', scope: 'owner', risk: 'local',
      command: 'npm run typecheck:public-shell', description: 'tsc -p workers/public-shell/tsconfig.json.' },
    { id: 'cf-typecheck-cloudshell', group: 'Tests and checks', label: 'Typecheck: cloudshell', scope: 'owner', risk: 'local',
      command: 'npm run typecheck:cloudshell', description: 'tsc -p workers/cloudshell/tsconfig.json.' },
    { id: 'cf-test-gateway', group: 'Tests and checks', label: 'Test: gateway and Qwen quota', scope: 'owner', risk: 'local',
      command: 'npm run test:gateway', description: 'Gateway quota and Qwen gateway tests.' },
    { id: 'cf-test-coding-agent', group: 'Tests and checks', label: 'Test: coding agent', scope: 'owner', risk: 'local',
      command: 'npm run test:coding-agent', description: 'node --test scripts/test-coding-agent.mjs.' },
    { id: 'cf-test-mailbox-clients', group: 'Tests and checks', label: 'Test: vault mailbox clients', scope: 'owner', risk: 'local',
      command: 'npm run test:vault-mailbox-clients', description: 'Strict TypeScript check of the clients, then their node tests (Java client test needs a JDK).' },
    { id: 'cf-check-csp', source: 'package.json', group: 'Tests and checks', label: 'Check page CSP', scope: 'owner', risk: 'local',
      command: 'npm run check:csp', description: 'scripts/check-csp.mjs on changed HTML (DEVELOPMENT.md).' },
    { id: 'cf-probe', source: 'scripts/probe.mjs', group: 'Tests and checks', label: 'Health probe (site, console, API, agent)', scope: 'owner', risk: 'network',
      command: 'npm run probe', description: 'scripts/probe.mjs requests several rabbitsoftware.io hosts; most are not on the public sandbox allowlist.' },
    { id: 'cf-test-site-installers', source: 'DEVELOPMENT.md', group: 'Tests and checks', label: 'Test: site installers (Python)', scope: 'owner', risk: 'local',
      command: 'python -B scripts/test-site-installers.py', description: 'Offline regression checks for the site installers (DEVELOPMENT.md).' },
    { id: 'cf-test-local-site', source: 'DEVELOPMENT.md', group: 'Tests and checks', label: 'Test: local site server (Python)', scope: 'owner', risk: 'local',
      command: 'python -B scripts/test-local-site.py', description: 'Request-guard tests for scripts/local-site.py (DEVELOPMENT.md).' },
    { id: 'cf-local-site', source: 'DEVELOPMENT.md', group: 'Dev servers', label: 'Local site with a local model', scope: 'owner', risk: 'local',
      command: 'python scripts/local-site.py --model qwen2.5:3b', description: 'DEVELOPMENT.md: serves the site against a local Ollama model, which must already be pulled.' },
    { id: 'cf-qwen-test', source: 'DEVELOPMENT.md', group: 'Tests and checks', label: 'Test: Qwen gateway and quota', scope: 'owner', risk: 'local',
      command: 'node --test scripts/test-qwen-gateway.mjs scripts/test-qwen-quota.mjs', description: 'DEVELOPMENT.md; the quota test runs real workerd SQL/RPC.' },
  ]),
  ...seed(CF, 'DEVELOPMENT.md', [
    { id: 'cf-qwen-dryrun', group: 'Deploy', label: 'Dry run: Qwen gateway', scope: 'owner', risk: 'local',
      command: 'npx wrangler deploy --config workers/qwen/wrangler.jsonc --dry-run', description: 'Packages without deploying.' },
    { id: 'cf-tasks-dryrun', group: 'Deploy', label: 'Dry run: tasks Worker', scope: 'owner', risk: 'local',
      command: 'npx wrangler deploy --config workers/tasks/wrangler.jsonc --dry-run', description: 'Packages without deploying.' },
    { id: 'cf-gateway-dryrun', group: 'Deploy', label: 'Dry run: gateway', scope: 'owner', risk: 'local',
      command: 'npx wrangler deploy --config workers/gateway/wrangler.toml --dry-run', description: 'Packages without deploying.' },
    { id: 'cf-vault-agent-dryrun', group: 'Vault agent (workers/vault-agent)', label: 'Dry run: vault-agent Worker', scope: 'owner', risk: 'local',
      command: 'npx wrangler deploy --config workers/vault-agent/wrangler.jsonc --dry-run', description: 'Packages workers/vault-agent without deploying.' },
  ]),
  ...seed(CF, 'README.md', [
    { id: 'cf-wrangler-deploy', group: 'Deploy', label: 'Deploy one Worker', scope: 'owner', risk: 'deploy',
      command: 'cd workers/<gateway|node-worker|sync> && npx wrangler deploy',
      description: 'README.md "Deploying": one Worker at a time; deploy sync before node-worker. Replace the placeholder first.' },
    { id: 'cf-pages-preview', source: 'README.md', group: 'Deploy', label: 'Publish the website preview', scope: 'owner', risk: 'deploy',
      command: 'npm run preview:site', description: 'wrangler pages deploy to the preview branch for review.' },
    { id: 'cf-pages-prod', source: 'README.md', group: 'Deploy', label: 'Publish the website to production', scope: 'owner', risk: 'deploy',
      command: 'npx wrangler pages deploy site --project-name rabbitsoftware-site --branch master', description: 'README.md: production branch is master.' },
  ]),
  ...seed(CF, 'package.json', [
    { id: 'cf-supabase-start', group: 'Supabase', label: 'Supabase: start local stack', scope: 'owner', risk: 'local',
      command: 'npm run supabase:start', description: 'npx supabase start.' },
    { id: 'cf-supabase-stop', group: 'Supabase', label: 'Supabase: stop local stack', scope: 'owner', risk: 'local',
      command: 'npm run supabase:stop', description: 'npx supabase stop.' },
    { id: 'cf-supabase-link', group: 'Supabase', label: 'Supabase: link the project', scope: 'owner', risk: 'secret',
      command: 'npm run supabase:link', description: 'npx supabase link with the project ref; needs your Supabase login.' },
    { id: 'cf-supabase-diff', group: 'Supabase', label: 'Supabase: db diff', scope: 'owner', risk: 'local',
      command: 'npm run supabase:diff', description: 'npx supabase db diff.' },
    { id: 'cf-supabase-types', group: 'Supabase', label: 'Supabase: generate types', scope: 'owner', risk: 'secret',
      command: 'npm run supabase:types', description: 'npx supabase gen types typescript --linked; needs your Supabase login.' },
  ]),
  // Vault agents (workers/vault-agent and the vault:* scripts). All of them touch the owner's vault or cloud access.
  ...seed(CF, 'package.json', [
    { id: 'vault-agents-plan', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agents plan', scope: 'owner', risk: 'local',
      command: `npm run vault:agents -- ${VAULT} --plan`, description: 'DEVELOPMENT.md: shows what a sync would send. Uploads nothing.' },
    { id: 'vault-agents-sync', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agents sync (uploads opted-in notes)', scope: 'owner', risk: 'secret',
      command: `npm run vault:agents -- ${VAULT} --sync --allow-upload`, description: 'DEVELOPMENT.md: uploads opted-in notes to the cloud vault agent.' },
    { id: 'vault-agents-pull', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agents pull results', scope: 'owner', risk: 'secret',
      command: `npm run vault:agents -- ${VAULT} --pull`, description: 'DEVELOPMENT.md: downloads finished cloud job results into the vault.' },
    { id: 'vault-agents-apply', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agents apply a job', scope: 'owner', risk: 'secret',
      command: `npm run vault:agents -- ${VAULT} --apply <job-id> --approve-edits`, description: 'DEVELOPMENT.md: applies a reviewed job to the vault.' },
    { id: 'vault-test-agent', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'Test: vault agent suite', scope: 'owner', risk: 'local',
      command: 'npm run test:vault-agent', description: 'The eleven vault-agent test files (DEVELOPMENT.md).' },
    { id: 'vault-agent-search', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agent search', scope: 'owner', risk: 'local',
      command: `npm run vault:agent -- ${VAULT} --search "agents workers"`, description: 'DEVELOPMENT.md: local Ollama search over your vault.' },
    { id: 'vault-agent-read', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agent read a note', scope: 'owner', risk: 'local',
      command: `npm run vault:agent -- ${VAULT} --read "Agents/Agents.md"`, description: 'DEVELOPMENT.md: reads one note.' },
    { id: 'vault-agent-task', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agent task', scope: 'owner', risk: 'local',
      command: `npm run vault:agent -- ${VAULT} --task "<task>"`, description: 'DEVELOPMENT.md: runs a local research/tool loop on selected notes.' },
    { id: 'vault-agent-learning', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agent approve learning', scope: 'owner', risk: 'local',
      command: `npm run vault:agent -- ${VAULT} --approve-learning "Cloud Agents/Proposals/<id>-<index>.json"`, description: 'DEVELOPMENT.md: promotes a reviewed proposal to a retrieval-memory note.' },
    { id: 'vault-agent-install', source: 'DEVELOPMENT.md', group: 'Vault agent (workers/vault-agent)', label: 'vault:agent:install (Obsidian plugin)', scope: 'owner', risk: 'local',
      command: `npm run vault:agent:install -- ${VAULT}`, description: 'DEVELOPMENT.md: copies the Rabbit Vault Agent plugin into .obsidian/plugins.' },
    { id: 'vault-tasks-discover', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:tasks discover', scope: 'owner', risk: 'local',
      command: `npm run vault:tasks -- ${VAULT} --discover`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-tasks-list', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:tasks list', scope: 'owner', risk: 'local',
      command: `npm run vault:tasks -- ${VAULT} --list`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-tasks-enqueue', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:tasks enqueue', scope: 'owner', risk: 'local',
      command: `npm run vault:tasks -- ${VAULT} --enqueue task.json`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-tasks-run', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:tasks run', scope: 'owner', risk: 'local',
      command: `npm run vault:tasks -- ${VAULT} --run`, description: 'DEVELOPMENT.md: each run needs an explicit operator decision.' },
    { id: 'vault-dispatch-list', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:dispatch list', scope: 'owner', risk: 'local',
      command: `npm run vault:dispatch -- ${VAULT} --agent vault-dispatcher --list`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-dispatch-inspect', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:dispatch inspect', scope: 'owner', risk: 'local',
      command: `npm run vault:dispatch -- ${VAULT} --agent vault-dispatcher --inspect "<request-id>"`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-dispatch-review', source: 'DEVELOPMENT.md', group: 'Vault tasks and dispatch', label: 'vault:dispatch review', scope: 'owner', risk: 'local',
      command: `npm run vault:dispatch -- ${VAULT} --agent vault-dispatcher --review "<task-id>"`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-network-list', source: 'DEVELOPMENT.md', group: 'Vault network', label: 'vault:network list', scope: 'owner', risk: 'local',
      command: `npm run vault:network -- ${VAULT} --list`, description: 'DEVELOPMENT.md: store-and-forward mailbox.' },
    { id: 'vault-network-receive', source: 'DEVELOPMENT.md', group: 'Vault network', label: 'vault:network receive', scope: 'owner', risk: 'local',
      command: `npm run vault:network -- ${VAULT} --receive vault-orchestrator`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-network-diagnose', source: 'DEVELOPMENT.md', group: 'Vault network', label: 'vault:network diagnose', scope: 'owner', risk: 'local',
      command: 'npm run vault:network -- --diagnose', description: 'DEVELOPMENT.md: checks adapters without needing a vault.' },
    { id: 'vault-network-serve', source: 'DEVELOPMENT.md', group: 'Vault network', label: 'vault:network serve (port 8810)', scope: 'owner', risk: 'local',
      command: `npm run vault:network -- ${VAULT} --serve 8810`, description: 'DEVELOPMENT.md.' },
    { id: 'vault-corpus-plan', source: 'DEVELOPMENT.md', group: 'Vault corpus', label: 'vault:corpus plan', scope: 'owner', risk: 'local',
      command: 'npm run vault:corpus -- --plan', description: 'DEVELOPMENT.md: counts only, no network.' },
    { id: 'vault-corpus-apply', source: 'DEVELOPMENT.md', group: 'Vault corpus', label: 'vault:corpus apply', scope: 'owner', risk: 'secret',
      command: 'npm run vault:corpus -- --apply', description: 'DEVELOPMENT.md: uploads changed chunks and deletes removed ones.' },
    { id: 'vault-live', source: 'scripts/vault-live.mjs', group: 'Vault corpus', label: 'vault:live', scope: 'owner', risk: 'secret',
      command: 'npm run vault:live', description: 'Re-indexes the corpus and pulls finished cloud job results; logs to .wrangler/vault-live.log.' },
    { id: 'vault-cloud-access', source: 'DEVELOPMENT.md', group: 'Cloud access and approvals', label: 'vault:cloud-access', scope: 'owner', risk: 'secret',
      command: `npm run vault:cloud-access -- ${VAULT} <action>`, description: 'DEVELOPMENT.md: authenticated cloud-access requests and decisions. See the component guide for the actions.' },
    { id: 'agent-code', source: 'scripts/coding-agent.mjs', group: 'Cloud access and approvals', label: 'agent:code (coding agent)', scope: 'owner', risk: 'secret',
      command: 'npm run agent:code', needs: ['CLOUD_TOOLS_AGENT_TOKEN', 'RABBIT_CLOUD_TOOLS_URL'],
      description: 'scripts/coding-agent.mjs: a coding agent that goes through the approval-gated cloud tools. Also reads provider keys from the environment.' },
  ]),
  ...seed(CF, 'DEVELOPMENT.md', [
    { id: 'cf-hf-vault', group: 'Vault imports', label: 'Sync Hugging Face into the vault', scope: 'owner', risk: 'network',
      command: `python scripts/sync-huggingface-vault.py ${VAULT}`, description: 'DEVELOPMENT.md: one note per model, dataset and Space.' },
    { id: 'cf-hf-vault-test', group: 'Vault imports', label: 'Test: Hugging Face vault sync', scope: 'owner', risk: 'local',
      command: 'python -B scripts/test-sync-huggingface-vault.py', description: 'DEVELOPMENT.md.' },
    { id: 'cf-gh-import', group: 'Vault imports', label: 'Import GitHub into the vault', scope: 'owner', risk: 'network',
      command: `python scripts/import-github-vault.py ${VAULT}`, description: 'DEVELOPMENT.md.' },
    { id: 'cf-gh-import-verify', group: 'Vault imports', label: 'Verify the GitHub import', scope: 'owner', risk: 'local',
      command: `python scripts/import-github-vault.py ${VAULT} --verify-only`, description: 'DEVELOPMENT.md.' },
    { id: 'cf-gh-sync', group: 'Vault imports', label: 'Sync GitHub vault', scope: 'owner', risk: 'network',
      command: `python scripts/sync-github-vault.py ${VAULT}`, description: 'DEVELOPMENT.md.' },
    { id: 'cf-gh-sync-verify', group: 'Vault imports', label: 'Verify the GitHub vault sync', scope: 'owner', risk: 'local',
      command: `python scripts/sync-github-vault.py ${VAULT} --verify-only`, description: 'DEVELOPMENT.md.' },
    { id: 'cf-publish-development', group: 'Vault imports', label: 'Publish the development notes page', scope: 'owner', risk: 'local',
      command: `node scripts/publish-development.mjs ${VAULT}`, description: 'DEVELOPMENT.md: builds the site development page from the vault.' },
  ]),
]

const RA: CatalogEntry[] = [
  ...seed('research-agents', 'task_worker.py', [
    { id: 'ra-task-dry', group: 'Task worker', label: 'task_worker dry run', scope: 'owner', risk: 'network',
      command: 'python task_worker.py --dry-run', description: 'Claims nothing; shows what the handlers would do for a sample task.' },
    { id: 'ra-task-once', group: 'Task worker', label: 'task_worker handle one task', scope: 'owner', risk: 'secret',
      command: 'python task_worker.py --once', needs: ['RABBIT_URL', 'RABBIT_INGEST_SECRET', 'RABBIT_TASK_NODE_ID'],
      description: 'Claims at most one filed task, runs it against public sources and sends back a proposal (RABBIT_TASK_NODE_ID is optional).' },
    { id: 'ra-task-loop', group: 'Task worker', label: 'task_worker keep polling', scope: 'owner', risk: 'secret',
      command: 'python task_worker.py', needs: ['RABBIT_URL', 'RABBIT_INGEST_SECRET'], description: 'Polls every 20 seconds.' },
  ]),
  ...seed('research-agents', 'rabbit_sync.py', [
    { id: 'ra-sync-dry', group: 'Sync to RabbitOS', label: 'rabbit_sync dry run', scope: 'owner', risk: 'local',
      command: 'python rabbit_sync.py --dry-run', description: 'Prints what would be sent; sends nothing.' },
    { id: 'ra-sync', group: 'Sync to RabbitOS', label: 'rabbit_sync one pass', scope: 'owner', risk: 'secret',
      command: 'python rabbit_sync.py', needs: ['RABBIT_URL', 'RABBIT_INGEST_SECRET', 'RABBIT_NODE_ID'],
      description: 'Pushes local state to the signed ingest endpoint (RABBIT_NODE_ID is optional with one node).' },
    { id: 'ra-sync-watch', group: 'Sync to RabbitOS', label: 'rabbit_sync every 5 minutes', scope: 'owner', risk: 'secret',
      command: 'python rabbit_sync.py --watch 300', needs: ['RABBIT_URL', 'RABBIT_INGEST_SECRET'], description: 'Repeats the sync every 300 seconds.' },
  ]),
  ...seed('research-agents', 'run_all.py', [
    { id: 'ra-run-all', group: 'Agents', label: 'run_all (chain, research agent, AI participant, audit)', scope: 'owner', risk: 'network',
      command: 'python3 run_all.py', description: 'The single entry point that launches everything under one project identifier.' },
  ]),
  ...seed('research-agents', 'chain_pull.py', [
    { id: 'ra-chain-pull', group: 'Public chain', label: 'chain_pull once', scope: 'owner', risk: 'network',
      command: 'python chain_pull.py --once', needs: ['RABBIT_URL'],
      description: 'Pulls and verifies the public ledger into a local JSONL copy. No secret needed; a broken chain is refused (exit 2). The repo is not in the public sandbox.' },
    { id: 'ra-chain-pull-url', group: 'Public chain', label: 'chain_pull once from app.rabbitsoftware.io', scope: 'owner', risk: 'network',
      command: 'python chain_pull.py --url https://app.rabbitsoftware.io --out chain_ledger_local.jsonl --once', description: 'Same, with the origin given explicitly.' },
  ]),
  ...seed('research-agents', 'brain_research.py', [
    { id: 'ra-brain', group: 'Research', label: 'brain_research', scope: 'owner', risk: 'network',
      command: 'python brain_research.py', description: 'Searches PubMed and Europe PMC for EEG, chemistry and gene papers; writes brain_records.json.' },
    { id: 'ra-brain-3', group: 'Research', label: 'brain_research, 3 per query', scope: 'owner', risk: 'network',
      command: 'python brain_research.py --per-query 3', description: 'Fewer results per query.' },
  ]),
  ...seed('research-agents', 'neuro_variants.py', [
    { id: 'ra-neuro', group: 'Research', label: 'neuro_variants', scope: 'owner', risk: 'network',
      command: 'python neuro_variants.py', description: 'ClinVar variant counts and examples for the brain genes; writes neuro_records.json and neuro_gene_counts.json.' },
    { id: 'ra-neuro-comt', group: 'Research', label: 'neuro_variants for COMT', scope: 'owner', risk: 'network',
      command: 'python neuro_variants.py --gene COMT', description: 'One gene.' },
  ]),
  ...seed('research-agents', 'DEVELOPMENT.md', [
    { id: 'ra-crispr-data', group: 'CRISPR', label: 'crispr_data (BRCA1)', scope: 'owner', risk: 'network',
      command: 'python crispr_data.py --gene BRCA1', description: 'Transcripts, guides and literature for one gene; writes crispr_records.json. Text and public data only.' },
    { id: 'ra-crispr-data-nolit', group: 'CRISPR', label: 'crispr_data (BRCA1, no literature)', scope: 'owner', risk: 'network',
      command: 'python crispr_data.py --gene BRCA1 --no-literature', description: 'Skips the literature search.' },
    { id: 'ra-crispr-suite', group: 'CRISPR', label: 'crispr_research_suite', scope: 'owner', risk: 'network',
      command: 'python crispr_research_suite.py', description: 'All four pieces together.' },
    { id: 'ra-crispr-cancer', group: 'CRISPR', label: 'crispr_cancer_research', scope: 'owner', risk: 'network',
      command: 'python crispr_cancer_research.py', description: 'Literature only (trials, papers, preprints).' },
    { id: 'ra-crispr-tool', group: 'CRISPR', label: 'crispr_tool: guides for BRCA1', scope: 'owner', risk: 'network',
      command: 'python crispr_tool.py --gene BRCA1', description: 'Top guides on a built-in gene (RefSeq transcript downloaded once and cached).' },
    { id: 'ra-crispr-tool-edit', group: 'CRISPR', label: 'crispr_tool: preview a 1-base deletion', scope: 'owner', risk: 'network',
      command: 'python crispr_tool.py --gene BRCA1 --guide 1 --delete 1', description: 'Edit preview that reports the protein change.' },
  ]),
  ...seed('research-agents', '.claude/skills', [
    { id: 'ra-bio-networks', source: '.claude/skills/bio-research-sources/SKILL.md', group: 'Research', label: 'bio_networks (ping public data sources)', scope: 'owner', risk: 'network',
      command: 'python bio_networks.py', description: 'Pings every public source and prints status and latency (--json for machines).' },
    { id: 'ra-eeg-dry', source: '.claude/skills/eeg-brainflow/SKILL.md', group: 'EEG', label: 'brainflow_bridge dry run (synthetic board)', scope: 'owner', risk: 'local',
      command: 'python brainflow_bridge.py --dry-run --seconds 10', description: 'Synthetic board; prints and sends nothing (eeg-brainflow skill). Personal EEG stays on your computer.' },
  ]),
  ...seed('research-agents', 'test_*.py', [
    { id: 'ra-test-audit', group: 'Tests', label: 'Test: audit trail', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_audit_trail', description: 'Two writers must still produce one unbroken chain.' },
    { id: 'ra-test-bio', group: 'Tests', label: 'Test: bio_tools', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_bio_tools', description: 'Offline checks; needs biopython.' },
    { id: 'ra-test-brainflow', group: 'Tests', label: 'Test: brainflow bridge', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_brainflow_bridge', description: 'Band-power maths without hardware.' },
    { id: 'ra-test-chain-pull', group: 'Tests', label: 'Test: chain_pull', scope: 'owner', risk: 'local',
      command: 'python -I -m unittest test_chain_pull', description: 'Hash check against a vector made by the web app code.' },
    { id: 'ra-test-crispr-data', group: 'Tests', label: 'Test: crispr_data', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_crispr_data', description: 'Every guide is a 20-mer followed by NGG on both strands.' },
    { id: 'ra-test-crispr-tool', group: 'Tests', label: 'Test: crispr_tool', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_crispr_tool', description: 'The one-stop CLI.' },
    { id: 'ra-test-neuro', group: 'Tests', label: 'Test: neuro_variants', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_neuro_variants', description: 'ClinVar calls are faked.' },
    { id: 'ra-test-task-worker', group: 'Tests', label: 'Test: task_worker', scope: 'owner', risk: 'local',
      command: 'python -m unittest test_task_worker', description: 'Task worker handlers.' },
  ]),
]

/** The whole catalog, in a fixed order: project, then the order written above. */
export const CATALOG: readonly CatalogEntry[] = [...RABBIT_WEB, ...CLOUDFLARE, ...RA]

export const publicEntries = (entries: readonly CatalogEntry[] = CATALOG) => entries.filter((e) => e.scope === 'public')

/** Where a command is meant to run: in a sandbox that has /workspace (or the sandbox helpers), or on the owner's computer from the repo root. */
export const runsIn = (e: Pick<CatalogEntry, 'scope' | 'command'>): 'sandbox' | 'computer' =>
  e.scope === 'public' || e.command.includes('/workspace/') ? 'sandbox' : 'computer'

export const commandBytes = (command: string) => new TextEncoder().encode(command).length

export interface CatalogGroup { project: CommandProject; group: string; entries: CatalogEntry[] }

/** Entries grouped by project then group, keeping the catalog order. */
export function groupCatalog(entries: readonly CatalogEntry[] = CATALOG): CatalogGroup[] {
  const out: CatalogGroup[] = []
  for (const p of PROJECTS) {
    for (const e of entries) {
      if (e.project !== p) continue
      let g = out.find((x) => x.project === p && x.group === e.group)
      if (!g) { g = { project: p, group: e.group, entries: [] }; out.push(g) }
      g.entries.push(e)
    }
  }
  return out
}

/** Case-insensitive match on every word of the query against id, label, command, description, group and project. */
export function searchCatalog(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...entries]
  return entries.filter((e) => {
    const hay = `${e.id} ${e.project} ${e.group} ${e.label} ${e.command} ${e.description}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export const findEntry = (id: string): CatalogEntry | undefined => CATALOG.find((e) => e.id === id)

/** Short context for the AI coder: ids and labels only, never the command text. */
export function aiContext(entries: readonly CatalogEntry[] = CATALOG): string {
  return ['Known project commands (id: label). Ask for one by id; the command text is not included.', ...entries.map((e) => `${e.id}: ${e.label}`)].join('\n')
}
