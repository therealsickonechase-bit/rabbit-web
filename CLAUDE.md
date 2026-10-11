@AGENTS.md

# rabbit-web

RabbitOS, the console at app.rabbitsoftware.io. See [README.md](README.md) for the map and [docs/rabbitos.md](docs/rabbitos.md) for the product.

## Commands
- `npm run lint`, `npm run test:auth` (all unit tests, `node --test`), `npx tsc --noEmit`.
- `npm run deploy:vinext` deploys to production. Run it only when the user asks.

## Rules
- Production is live. Do not deploy, apply Supabase migrations, or write remote data without an explicit go-ahead.
- Secrets live in `.env.local` / Cloudflare secrets, never in the repo or in chat. Server code that needs the service role uses `src/lib/supabase/admin.ts`.
- Tests import `.ts` files directly with Node: use relative imports (not the `@/` alias) in files under `src/lib` that tests load.
- Personal data (EEG, wearables, labs) stays on the user's computer. Only fixed words go to an image model; only coarse owner-only summaries may go to Supabase.
- Pure logic goes in `src/lib` with a test in `tests/`; components stay thin.
- The bash tool mangles long heredocs with quotes: write files with the Write tool.
