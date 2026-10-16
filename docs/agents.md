# Agents: where they run, how to reach them, how to deploy them

Checked 2026-10-16. "Registered" means listed in the Google Cloud **Agent Registry** (project `rabbitsoftware-io`, API `agentregistry.googleapis.com`), where agents, MCP servers and skills are discovered. Registering only describes where an agent is; access is whatever the agent itself allows. The registry holds things that run in Google Cloud and speak a protocol (A2A for agents, MCP for tool servers); the other agents are listed here with how they run.

## In Google Cloud and registered

| Agent | Protocol | Where | Access | Deploy |
|---|---|---|---|---|
| **RabbitOS Research Agent** | A2A (JSON-RPC `message/send`), agent card at `/.well-known/agent-card.json` | Cloud Run `rabbit-research-agent` (`https://rabbit-research-agent-vxx5lz7c5a-wl.a.run.app`) | public, read only: live search of PubMed, Europe PMC, ClinicalTrials.gov, openFDA; stores nothing; no secrets; service account with no roles | `pwsh -File scripts/powershell/Setup-GcpResearchAgent.ps1` |
| **RabbitOS Hub** | MCP (JSON-RPC over HTTP), 25 read-only tools | Cloud Run `rabbitos-hub-mcp` (`.../mcp`) | public tools need no key; owner tools need a hub key | `pwsh -File scripts/powershell/Setup-GcpHub.ps1` |

Register or refresh both: `pwsh -File scripts/powershell/Register-AgentRegistry.ps1` (`-WhatIf` first; `-Remove` deletes the registry entries only). The list it registers is `scripts/agent-registry.json`.

Call the research agent from anywhere:

```
curl -X POST https://rabbit-research-agent-vxx5lz7c5a-wl.a.run.app -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"kind":"message","role":"user","messageId":"1","parts":[{"kind":"text","text":"pubmed: BRCA1 breast cancer"}]}}}'
```

## In Google Cloud, not in the registry (jobs and hosts, no agent protocol)

| What | Where | What it does | Deploy |
|---|---|---|---|
| Visitor shell | Cloud Run `rabbit-visitor-shell` | one throwaway terminal per guest with the `claude`, `gemini` and `copilot` CLIs, behind an allowlist proxy | `Setup-GcpShell.ps1` |
| **Task worker** (moved from the PC 2026-10-16) | Cloud Run job `rabbit-task-worker` (every 5 minutes) | claims one approved task from the RabbitOS queue, runs it against public sources only (PubMed, Europe PMC, ClinicalTrials.gov, NCBI RefSeq) and sends back a proposal that the owner approves on the website; reads only the ingest secret | `Setup-GcpTaskWorker.ps1` |
| Maxwell miner | Cloud Run job `rabbit-miner` (nightly) | mines the rabbit web snapshot onto the Maxwell chain | `Setup-GcpMinerJob.ps1` |
| Bitcoin anchor | job `rabbit-anchor` (every 6 h) | OpenTimestamps proofs of the chain heads | `Setup-GcpAnchor.ps1` |
| Ethereum and XRPL anchor | job `rabbit-anchor-chains` (parked, paused) | posts the same fingerprint to two more networks once funded | `Setup-GcpAnchorChains.ps1` |
| Wallet watcher | job `rabbit-wallet-watch` (30 min) | records and announces what arrives at the wallet addresses | `Setup-GcpWalletWatch.ps1` |
| Backup, status, weekly audit | jobs `rabbit-backup`, `rabbit-status`, `rabbit-qa` | cloud backup, live status feed, audit with score | `Setup-GcpBackupJob.ps1`, `Setup-GcpStatusFeed.ps1`, `Setup-GcpQaWorkflow.ps1` |
| Vault mirror | job `rabbit-vault-mirror` (built, not deployed) | GitHub vault to the private bucket | `Setup-GcpVaultMirror.ps1` |

## On the owner's PC (`research-agents`, Python)

Personal data stays here; only public-source findings are synced to RabbitOS (signed ingest).

| Agent | File | What it does |
|---|---|---|
| IntegratedResearchAgent | `integrated_research_agent.py` | research, mining, corpus and visuals in one |
| GrowingResearchAgent | `growing_research_agent.py` | explores queued topics and queues related ones |
| CrisprResearchAgent / CrisprResearchSuite | `crispr_research_agent.py`, `crispr_research_suite.py` | CRISPR literature tracking and guide design (text and public data only) |
| ResearchAgent | `research_agent.py` | the base public-source search |
| AIParticipant | `ai_gossip.py` | periodic analysis of the network ledger |
| Task worker | `task_worker.py` | **now also runs in Google Cloud** (above); the PC task can stay as a second worker, the queue gives each task to one worker only, or be disabled |
| Research sync, chain pull | `rabbit_sync.py`, `chain_pull.py` | scheduled task (30 minutes) that sends local findings to RabbitOS and pulls the chain back; reads local files, so it stays on the PC |
| Maxwell miner (PC) | `rabbitweb_miner.py` | the same miner as the cloud job; both may add blocks |

Run for a while by hand: the one-hour wrapper pattern used on 2026-10-15 (`run_all.py` with a time limit). To put one of these in Google Cloud and in the registry, copy the pattern in `workers/agent-a2a` (an A2A wrapper around a read-only function) and add it to `scripts/agent-registry.json`. An agent that handles personal data should not be deployed.

## On Cloudflare and Hugging Face

| What | Where | Notes |
|---|---|---|
| Vault agent and note-job queue | Cloudflare Worker `vault-agent` + R2 | approved note snapshots as one-hour scoped jobs (see the vault's `Pathways/` notes) |
| Tasks worker, owner shell broker, gateway, Qwen gateway | Cloudflare Workers | task queue, owner commands, model routing |
| Image Space | Hugging Face `rabbitos-eeg-qwen-image` | receives fixed words only |

## What moved to Google Cloud, and what stays on the PC

- **Moved:** the task worker (public sources only, no personal data).
- **Stays on the PC on purpose:** anything that reads EEG, wearables, labs or self data (the BrainFlow bridge, the self-data hub, the vault agents) and the local-file syncs (`rabbit_sync.py`, `chain_pull.py`).
- **Can move next, with a design decision:** the research explorers (IntegratedResearchAgent, GrowingResearchAgent, CrisprResearchAgent). They keep their topic queue and corpus in local files, so a cloud copy needs the state moved to the app or to a bucket, and PC and cloud must not overwrite each other.

## Why the PC agents are not in the registry yet

The registry needs a reachable URL and a protocol. The PC agents have neither on purpose (they hold or sit next to personal data and run on a schedule). Public, read-only agents can be wrapped and deployed like the Research Agent; say which one to do next.
