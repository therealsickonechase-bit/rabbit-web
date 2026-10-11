// The words RabbitOS sends to the EEG + Qwen-Image-2.1-Turbo Hugging Face Space (https://huggingface.co/spaces/Therealsickonechase-bit/rabbitos-eeg-qwen-image).
// Everything is derived here, in the browser, from the live bridge frame and the hormone context, and reduced to fixed words and a seed:
// no raw EEG, no ECG or EMG numbers and no hormone numbers ever leave the page. Pure functions, tested.

import { moodFromInputs, type Level } from './body-api.ts'
import { eegIndices, type LiveFrame } from './live-signals.ts'
import { levelsFrom, type HormoneSource } from './hormone-context.ts'

export const HF_SPACE_DEFAULT = 'Therealsickonechase-bit/rabbitos-eeg-qwen-image'
export const STATES = ['eyes_open', 'eyes_closed', 'motor_imagery'] as const
export const RESOLUTIONS = [768, 1024, 1536] as const
export type State = (typeof STATES)[number]

export interface SpaceWords {
  state: State
  rhythm: 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma'
  arousal: Level
  cortisol: Level
  melatonin: Level
  confident: boolean
  seed: number
  resolution: number
  heart: 'slow' | 'steady' | 'fast'
  muscle: 'still' | 'active' | 'tense'
}

export const validSpaceId = (id: string) => /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/.test(id)

/** Where the brain-state word came from, so the page can say so. */
export type StateSource = 'transformer (local bridge)' | 'alpha-share rule' | 'default'

export interface Built { words: SpaceWords; stateSource: StateSource; hormoneLabel: string; measured: { heart: boolean; muscle: boolean; eeg: boolean } }

/** Build the Space request from the newest bridge frame (or null) and the hormone context at a clock hour. */
export function buildWords(frame: LiveFrame | null, source: HormoneSource, hour: number, seed: number, resolution: number, emgRatio: number | null = null): Built {
  const idx = eegIndices(frame)
  const mood = moodFromInputs({ engagement: idx.engagement, dominant: idx.dominant }, null, null)
  let state: State = 'eyes_open', stateSource: StateSource = 'default', confident = false
  if (frame?.state && (STATES as readonly string[]).includes(frame.state.label)) {
    state = frame.state.label; stateSource = 'transformer (local bridge)'; confident = frame.state.confidence >= 0.55
  } else if (idx.channels > 0 && frame?.eeg) {
    const alpha = Object.values(frame.eeg).map((b) => b.alpha).filter((v): v is number => typeof v === 'number')
    const share = alpha.length ? alpha.reduce((a, b) => a + b, 0) / alpha.length : 0
    state = share > 0.4 ? 'eyes_closed' : 'eyes_open'; stateSource = 'alpha-share rule'; confident = Math.abs(share - 0.4) > 0.15
  }
  const bpm = frame?.ecg?.bpm
  const heart = bpm === undefined ? 'steady' : bpm < 60 ? 'slow' : bpm > 100 ? 'fast' : 'steady'
  const muscle = emgRatio === null ? 'still' : emgRatio > 4 ? 'tense' : emgRatio > 1.8 ? 'active' : 'still'
  const h = levelsFrom(source, hour)
  return {
    words: {
      state, rhythm: (mood.rhythm as SpaceWords['rhythm']) ?? 'alpha', arousal: mood.arousal ?? 'typical', cortisol: h.cortisol, melatonin: h.melatonin, confident,
      seed: Math.abs(Math.trunc(seed)) % 2147483647, resolution: (RESOLUTIONS as readonly number[]).includes(resolution) ? resolution : 1024, heart, muscle,
    },
    stateSource, hormoneLabel: h.label, measured: { heart: bpm !== undefined, muscle: emgRatio !== null, eeg: idx.channels > 0 },
  }
}

/** A short line for captions and history: the words, nothing else. */
export const describeWords = (w: SpaceWords) => `${w.state.replace('_', ' ')}, ${w.rhythm} rhythm, arousal ${w.arousal}, cortisol ${w.cortisol}, melatonin ${w.melatonin}, heart ${w.heart}, muscle ${w.muscle}`
