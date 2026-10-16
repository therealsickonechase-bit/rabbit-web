# Hugging Face and the platform

Account: `Therealsickonechase-bit` on huggingface.co (signed in on this PC with `hf auth login`; the token stays on the PC and is never sent to Google Cloud or the sites). Checked 2026-10-16.

| Item | What it is | Public? | How the platform uses it |
|---|---|---|---|
| Model `Llama-3.2-3B-RabbitSoftware-GGUF` | the RabbitSoftware fine-tune (LoRA on Llama 3.2 3B Instruct, GGUF for llama.cpp), license `llama3.2` | public, 83 downloads | listed on the platform map; status through the hub tool `huggingface_status` |
| Space `rabbitos-eeg-qwen-image` | Gradio app on ZeroGPU that draws an image from fixed words | public, running | RabbitOS sends it **fixed vocabulary words only** (never numbers, titles, notes or raw signals). Its status is on the pathway check and in `huggingface_status`. Note: the Space still lists `rabbitsoftware.io` as a custom domain with an expired verification challenge; remove it in the Space settings if you do not plan to use it |
| Datasets `dna_chain_training.jsonl`, `rabbitsoftware-training`, `rabbitsoftware-knowledge` | training and knowledge data | the first is public; the other two are **private** | backed up nightly to Google Cloud (below); the hub never reads private data |
| Buckets `RabbitAI` (1.7 GB, 128 files), `dna_chain_training.jsonl-bucket` (3 files), `Rabbitsoftware`, `rabbit` (empty) | Hugging Face storage buckets | public | backed up nightly to Google Cloud |
| Older models `Chase_MissionAi`, `Missionai`, `TSO`, `rabbit-2.2.8-...` | early experiments | public | not used by the platform; not backed up (their files live in git on Hugging Face) |

## Backup to Google Cloud

`scripts/powershell/Backup-HuggingFace.ps1` (task "RabbitOS Hugging Face to Google Cloud", nightly 02:30, up to 6 hours) downloads every bucket and every dataset you own with the `hf` CLI into a staging folder and copies them with `gcloud storage rsync` to `gs://rabbitsoftware-io-backups/huggingface/buckets/<name>/` and `.../datasets/<name>/` (private bucket, versioned; adds and updates only, never deletes). `-WhatIf` lists what it would copy. If the task cannot find `hf` or you are signed out, it writes a FAIL line to `~\RabbitOS\logs\hf-gcs-<date>.log`; sign in again with `hf auth login`.

## Where it shows up

- Platform map and status page: the model, Space, datasets and buckets (provider "Outside").
- Hub MCP: tool `huggingface_status` (public metadata only: downloads, likes, last update, whether the Space is running).
- `node scripts/pathways-check.mjs`: the Space is running and the model is public; the Hugging Face backup in Google Cloud is under 40 hours old.
