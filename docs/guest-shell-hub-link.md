# Connecting the guest shell to the hub and the public ledger bucket

**Status: not applied.** It widens what the public guest shell can reach, so it waits for the owner's explicit go-ahead. Nothing here opens Supabase, Cloudflare, Google Cloud APIs, the private backups bucket or the owner's PC; those stay closed on purpose.

## What it adds (two hosts, nothing else)

| Host | Why | Safe because |
|---|---|---|
| `rabbitos-hub-mcp-vxx5lz7c5a-wl.a.run.app` | Agents in the shell (`claude`, `gemini`, `copilot`) can use the hub tools: links, status, the public chain and data, the command catalog, safe command drafting. | The hub is read-only, runs nothing, holds no secrets and rate-limits anonymous callers to 20 per minute per address. |
| `rabbitsoftware-io-ledger-public.storage.googleapis.com` | Agents can read the public chain mirror directly. | It is this one bucket's own host name, not `storage.googleapis.com` (which would reach any bucket). The bucket is world-readable by design and holds only the public chain files. |

## The four places to change (all must match)

1. `rabbitsoftware-cloudflare/workers/public-shell/src/egress.mjs`: add both hosts to `EGRESS_HOSTS`. In `egressDecision`, allow `POST /mcp` and `GET /health` on the hub host and only `GET`/`HEAD` on the bucket host.
2. `rabbit-web/scripts/powershell/Setup-GcpShell.ps1`: add both hosts to `$allowed` (the Squid proxy list), then rerun the script (about 6 minutes; it rebuilds the image and refreshes the proxy).
3. `rabbitsoftware-cloudflare/workers/hub-mcp/src/catalog.mjs`: add both to `HOSTS_GUEST_CAN_REACH` so `command_draft` stops warning about them.
4. Both Dockerfiles (`public-shell`, `public-shell-gcp`): copy an MCP settings file for each agent into the visitor's home, so the agents find the hub on their own:
   - Gemini: `~/.gemini/settings.json` with `mcpServers.rabbitos-hub.httpUrl`
   - Claude Code: `~/.claude.json` with `mcpServers.rabbitos-hub` of type `http`
   - Copilot CLI: `~/.copilot/mcp-config.json`

   The exact file formats for Claude and Copilot should be checked against the installed versions (`claude mcp list`, `copilot` help) before relying on them.

## Prove it, and prove nothing else opened

Rerun `workers/public-shell-gcp/scripts/reach.mjs` (change the two rows "hub MCP" and "Public ledger bucket" from `closed` to `open`). Every other row must still say `blocked`.

## Revert

Remove the two hosts from the same four places and rerun `Setup-GcpShell.ps1`.
