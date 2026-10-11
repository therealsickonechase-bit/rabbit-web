# Live signals, the picture generators and the data portrait in the Brain Network page

```
OpenBCI board ──BrainFlow──> local_bridge.py (your PC) ──ws://127.0.0.1:8765──> Brain Network page (your browser)
  EEG, ECG, EMG                EEG band shares, ECG heart rate, EMG, brain state        │
                               (EEG transformer, torch)                                  ├─ 3D brain colours and body (measured values replace the model's)
hormone context ───────────────────────────────────────────────────────────────────────  ├─ readings, traces, session file (JSON / CSV)
  typical daily pattern | levels you pick | your CSV                                      ├─ picture, clip, glTF export
                                                                                          └─ Qwen-Image-2.1-Turbo picture, through the Hugging Face Space
```

## What leaves your computer

| Step | Data | Where it goes |
|---|---|---|
| Board to bridge | raw EEG / ECG / EMG | nowhere: stays on your PC (BrainFlow) |
| Bridge to page | summary frames (band shares, bpm, RMS, state) | `ws://127.0.0.1` only; the bridge refuses pages from other sites |
| Page to Qwen Space | **fixed words and a seed**: state, strongest rhythm, arousal, cortisol, melatonin, heart (slow/steady/fast), muscle (still/active/tense) | straight from your browser to huggingface.co; RabbitOS servers never see it |
| Page to Workers AI (optional) | scenario names plus optional fixed mood words | RabbitOS server, then Cloudflare Workers AI |

No EEG, ECG, EMG or hormone number is ever sent to an image model. Hormone levels are never estimated from EEG: they are the typical daily pattern
(labelled "not measured"), levels you choose, or a CSV you load (`time,cortisol,melatonin`, read in the browser).

## Setup on Windows

```
cd C:\Users\odaat\Projects\research-agents
.\check-setup.ps1                   # tells you what is missing and how to fix it
.\start-live.ps1 -Simulate          # no hardware
.\start-live.ps1 -Board cyton -SerialPort COM3 -Ecg 8 -Emg "6=left_forearm,7=right_forearm"
```

Then open the Brain Network page, press Connect under "Live signals", and use "Paint it with Qwen-Image-2.1-Turbo".

The Space (`Therealsickonechase-bit/rabbitos-eeg-qwen-image`) uses ZeroGPU. Without a token the picture counts against the anonymous quota; add your own
Hugging Face token (kept only in your browser if you tick the box) to use your account's quota.

## My data portrait (your own data, drawn)

```
files you give it ──> selfdata hub (your PC) ──ws://127.0.0.1:8766──> Brain Network page ──> canvas art (live)
 wearable exports       encrypted store, analytics vs your own usual           │            └─ fixed words ──> Qwen Space (only when you press the button)
 lab CSV / FHIR         this PC's CPU/active time/network counters             └─ owner-only summary save (Supabase, optional, coarse)
 research feed          RabbitOS research feed
```

Start it with `research-agents\start-selfdata.ps1 -Demo` (made-up person) or `-Inbox` (your files), then press **Connect to my hub** in the "My data portrait" panel.
Full directions for exporting and supplying data are in `research-agents/docs/self-data.md`. The hub listens on loopback only and accepts only the RabbitOS site and localhost.
Blue particles are data coming in, amber are data going out; petal length is the last 7 days against your own usual, not good or bad.

| Step | Data | Where it goes |
|---|---|---|
| Files to hub | wearable and lab values, PC counters | stays on your PC; medical values are encrypted on disk |
| Hub to page | summary values per dimension, bytes in/out, flag counts | `ws://127.0.0.1` only |
| Page to Qwen Space | **fixed words only**, such as "sleep below usual", "data flowing in busy" | straight to huggingface.co |
| Page to Supabase (button) | coarse level, trend and lab flag counts per day | owner-only table `self_daily` (`/api/self/daily`); delete any time |

## Standard vocabulary

Organs in `/api/model/body?section=organs` carry NLM MeSH IDs, and `/api/model/concepts?term=...` maps a term to MeSH. UMLS CUIs are added only if you run
`scripts\add-umls.ps1` with a UMLS key, and only from open sources.

Genes can carry standard identifiers too (NCBI Gene, HGNC, OMIM, Ensembl, UniProt, RefSeq) from NCBI Datasets packages, kept in `src/lib/gene-ids.ts`; SLC6A4 has them now and
they appear in `/api/model/body?section=genes` and on its card in Chemistry & DNA.

## Files

`src/components/LiveBridge.tsx` connection | `HfGenerator.tsx` Qwen panel | `CapturePanel.tsx` pictures, clips, files, Workers AI |
`SelfData.tsx` data portrait | `src/lib/self-data.ts` frames and prompt words | `concepts.ts` MeSH IDs | `src/lib/live-signals.ts` frame validation, EEG indices | `hormone-context.ts` hormone sources | `hf-generator.ts` words for the Space | `body-api.ts` open model data.
