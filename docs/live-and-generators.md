# Live signals and the picture generators in the Brain Network page

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

## Files

`src/components/LiveBridge.tsx` connection | `HfGenerator.tsx` Qwen panel | `CapturePanel.tsx` pictures, clips, files, Workers AI |
`src/lib/live-signals.ts` frame validation, EEG indices | `hormone-context.ts` hormone sources | `hf-generator.ts` words for the Space | `body-api.ts` open model data.
