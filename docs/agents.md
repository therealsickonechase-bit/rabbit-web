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
| **Research explorer** (moved from the PC 2026-10-16) | Cloud Run job `rabbit-research-explorer` (hourly at :20) | stateless: reads the topic queue from the RabbitOS app, explores up to two queued topics on public sources, ingests topic, run and records through the signed ingest; keeps no files | `Setup-GcpResearchExplorer.ps1` |
| **EEG sample analysis** (private) | Cloud Run job `rabbit-eeg-analysis` (weekly, no URL, not in the registry) | band-power summaries of the PhysioNet EEG sample recordings in the private backups bucket, written to `analysis/eeg/`; IAM lets it read only `eeg_data` and `eeg_runs` and write only `analysis/eeg/` | `Setup-GcpEegAnalysis.ps1` |
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
| Task worker | `task_worker.py` | **now runs in Google Cloud** (above); the PC task "RabbitOS Task Worker" was **disabled on 2026-10-16** (re-enable with `Enable-ScheduledTask -TaskName 'RabbitOS Task Worker'`; the queue gives each task to one worker only) |
| Echo (PC and cloud acknowledge each other) | `echo_link.py` | Cloud Run job `rabbit-echo` and PC task "RabbitOS Echo", both every 5 minutes. They share no network link: each writes a signed note (counter, random ID, time) to `gs://rabbitsoftware-io-reports/echo/` that acknowledges the other's last note, plus a status file. `Setup-GcpEcho.ps1`, `Run-Echo.ps1 -Register` |
| Echo record and heartbeat chart | `echo_record.py` | Every echo step also writes a log line (`echo/log/<side>/<date>.json`: time, sequence, heard, age of their note, acknowledged, and the round trip to the shared mailbox in ms). Each finished day is closed once into `echo/digest/<date>.json` with a SHA-256 over both logs. The cloud step rebuilds the public heartbeat `status/echo.json` (288 five-minute cells: heard by both / one side / nothing, plus %, longest silence, median round trip), which `rabbitsoftware.io/status.html` draws as the **Heartbeat: PC and cloud** chart. The daily hash is a Maxwell leaf (`echo:daily`), and the AI participant adds the plain-language summary to its insights. An alert ("PC echo silent") emails you if the cloud hears no fresh PC note for 3 hours. Times, counts and a hash only. `Setup-GcpEcho.ps1` |
| Log findings sent to the workers | `log_feedback.py` | Once an hour (inside the echo task) it reads the PC sync logs, the staged results and the cloud job counts, and stages one short note per worker (`research`, `task_worker`) naming what failed, how often, and the likely cause (for example a step that timed out). Only sent when the problems changed. The agents record it in their inbox results. `python log_feedback.py --dry-run` previews it |
| Staging (items wait for agents that are not running) | `stage_box.py` | Anything left for an agent (a task or a note, text only) is signed and kept in `echo/stage/<agent>/` in the private reports bucket. The PC's echo step (every 5 minutes) copies new items into `~\RabbitOS\staged\<agent>\` and writes a receipt back, so an agent that is stopped, or a PC that was off, finds them on its next start (`read_inbox`, then `done`). Items are data only, never run; expired (7 days) and old received items are swept. `python stage_box.py stage --to <agent> --kind task --title ...`, `pending`, `inbox --agent <agent>` **Who reads their inbox:** `task_worker.py` (agent `task_worker`; each item's body is JSON `{"kind": "research_topic|crispr_guides|brain_search", "params": {...}}`) and `run_all.py` (agent `research`; body `{"kind": "research_topic", "params": {"condition": "...", "biomarker": "..."}}`). Info items are noted; unknown, malformed or failing tasks are recorded, never guessed at. Outcomes are written to `~\RabbitOS\staged\<agent>
esults\<id>.json`. The cloud task worker is stateless and does not use the local inbox; the PC task worker is currently disabled, so its inbox is read when you re-enable it. | |
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

- **Moved:** the task worker and the research explorer (public sources only, no personal data), and a private analysis of the EEG sample recordings.
- **The catch, solved:** the explorers used to keep their topic queue and corpus in local files, so a cloud copy could have overwritten the PC's. The cloud explorer keeps **no files**: the RabbitOS app (Supabase) is the shared state. It reads the queued topics from the app, and the signed ingest upserts by id, so a topic that both the PC and the cloud explored is simply refreshed. Nothing is overwritten and nothing is lost. The PC explorers can keep running or be retired; pause the cloud one any time with `gcloud scheduler jobs pause rabbit-research-explorer-hourly --location us-west2`.
- **File-based syncs:** `rabbit_sync.py` (local files to the app) and `chain_pull.py` (app to local files) are by definition about the PC's files, so they stay on the PC. The cloud does not need them: it reads and writes the app directly, and the nightly backup copies the PC's state files to the private bucket.
- **About "EEG" in the backup:** `eeg_data` is the public PhysioNet EEG Motor Movement/Imagery sample dataset (27 volunteers), `eeg_runs` holds the classifier trained on it and demo runs, and `selfdata` holds only importer code. The owner's own EEG notes live in the Obsidian vault (`Local/EEG`) and are not uploaded. The cloud EEG analysis reads only the public sample data.
- **Cannot move:** the BrainFlow bridge needs the physical headset (USB or Bluetooth) and the vault agents work on the local vault; they stay on the PC.

## Why the PC agents are not in the registry yet

The registry needs a reachable URL and a protocol. The PC agents have neither on purpose (they hold or sit next to personal data and run on a schedule). Public, read-only agents can be wrapped and deployed like the Research Agent; say which one to do next.
