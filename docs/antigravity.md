# Antigravity research search

Two meanings of "antigravity", both covered:

1. **Google Antigravity** (the IDE and the `agy` CLI) is connected to the RabbitOS research search.
2. **Antigravity** (the physics topic: gravitational repulsion, antihydrogen free fall, ALPHA-g) is a research topic whose papers are linked to your research store, the Maxwell chain and Google Cloud.

## One search, three ways in

| Way | How | What runs |
|---|---|---|
| Web | the search box under "What the research agents found most recently" on rabbitsoftware.io/research | the public data hub (`/api/data/research_records?q=`) plus `status/research-live.json`, marking each hit "Covered by Maxwell block N" or "Not yet in a Maxwell block" |
| Terminal | `node scripts/research-search.mjs antigravity` (`--sources openalex,inspirehep`, `--limit 6`, `--json`) | the Hub tool `research_link` |
| Network | Hub MCP tool `research_link`; Research Agent (A2A) message `link: antigravity` or data part `{skill: "research-link", query}` | the same shared function (`researchLinkReport` in `workers/hub-mcp/src/research.mjs`) |

`research_link` searches OpenAlex, INSPIRE-HEP, Europe PMC and PubMed live, then shows (1) what RabbitOS already stores about the topic, (2) whether each stored record was first seen before the newest Maxwell `RESEARCH_ANCHOR` block (so that block's Merkle root covers it), and (3) the Google Cloud copies (live research file, public chain mirror). It is read only and stores nothing.

## Connecting Google Antigravity

```powershell
pwsh -File scripts/powershell/Connect-Antigravity.ps1 -WhatIf   # shows the command
pwsh -File scripts/powershell/Connect-Antigravity.ps1           # agy mcp add --type http rabbitos-hub <hub url>
agy mcp list                                                     # rabbitos-hub  http  enabled
```

No key is involved: the Hub's research tools are public and read only. `-Remove` unregisters it. In Antigravity ask, for example:

> Use research_link to search "antigravity" and tell me which results Maxwell already covers and which are new.

## Keeping findings (the "mine" link)

Live search stores nothing. To put the papers into your research store:

```powershell
cd research-agents
python physics_research.py                       # OpenAlex + INSPIRE-HEP -> physics_records.json
python physics_research.py --query "antihydrogen gravity" --per-query 3
pwsh -File ..\rabbit-web\scripts\powershell\Run-ResearchSync.ps1 -Mode Sync   # rabbit_sync.py sends physics_records.json as physics_paper / physics_preprint
```

The records are public titles and links only (public sources `physics_paper`, `physics_preprint`). The nightly Maxwell research anchor then covers them, and the status job copies the newest anchor into `research-live.json` so the website and `research_link` can say which block covers a record. `physics_records.json` is also in the Maxwell backup file list.

## Caution

Antigravity is a fringe topic and many results are speculative. A paper listed here is a pointer, not an endorsement, and the chain proves a record existed at a time, not that its claim is true.
