// What feeds the Brain Network page, in one list: each data source or service, where it runs, whether it is live, what the page uses it for, whether
// anything leaves this computer because of it, and how to start it. Pure functions and fixed metadata, tested; the components report live status into it.

export type ConnStatus = 'off' | 'connecting' | 'live' | 'stale' | 'idle' | 'error'
export type ConnId = 'openbci' | 'selfdata' | 'wormhole' | 'wifi' | 'relay' | 'qwen' | 'workersai' | 'claude' | 'server' | 'supabase'

export interface ConnMeta {
  id: ConnId
  name: string
  /** where it runs and its address */
  where: string
  /** what the page does with it */
  uses: string
  /** what, if anything, leaves this computer */
  leaves: string
  /** how to turn it on */
  start: string
}

export const CONNECTIONS: ConnMeta[] = [
  {
    id: 'openbci', name: 'OpenBCI / BrainFlow bridge', where: 'This computer: ws://127.0.0.1:8765',
    uses: 'Live EEG band shares, heart rate (ECG), muscle activity (EMG) and the brain state read by the EEG transformer: they colour the 3D brain, move the body model and can drive the avatar.',
    leaves: 'Nothing. Frames stay in this browser tab.', start: 'research-agents\\start-live.ps1 (add -Simulate to try it without a board)',
  },
  {
    id: 'selfdata', name: 'Self-data hub (my data portrait)', where: 'This computer: ws://127.0.0.1:8766',
    uses: 'Your own wearable, lab and PC data compared with your own usual, drawn as the data portrait, plus this PC’s network bytes in and out.',
    leaves: 'Nothing, unless you press "Paint with Qwen" (fixed words only) or "Save today’s summary" (owner only, coarse levels and flag counts).', start: 'research-agents\\start-selfdata.ps1 (-Demo for a made-up person)',
  },
  {
    id: 'wormhole', name: 'Wormhole moments (from the self-data hub)', where: 'This computer: ws://127.0.0.1:8766 (the same hub, its own connection)',
    uses: 'The moments you logged and how your body metrics read lately, compared with your present state to find the closest matches and build a scene of approved words.',
    leaves: 'Nothing, unless you press "Paint this scene" (approved words only) or share the scene with another twin (words only, and its owner is asked first).', start: 'research-agents: python -m selfdata import-moments FILE (or demo), then start-selfdata.ps1',
  },
  {
    id: 'wifi', name: 'WiFi sensing (RuView)', where: 'This computer: ws://127.0.0.1:8767, from RuView on 127.0.0.1:3000',
    uses: 'Presence, motion and, with CSI hardware, breathing and heart rate of people in range: they shape the avatar’s mood, breathing and awareness.',
    leaves: 'Nothing. Observes everyone in range of your router or sensors, so use it only where everyone agrees.', start: 'research-agents\\start-wifisense.ps1 (-Server for RuView, -Simulate for a pretend visitor)',
  },
  {
    id: 'relay', name: 'Twin relay (twins on other computers)', where: 'ws://127.0.0.1:8790 on this computer, or a wss:// relay you choose',
    uses: 'Carries signed, encrypted messages between Twin A in this page and twins on other computers (MicroPython or Python nodes).',
    leaves: 'Only ciphertext and who is talking to whom, when, and message sizes. The relay cannot read or change what is said.', start: 'research-agents\start-twinnet.ps1 -Relay, then Connect Twin A in the Twin network panel',
  },
  {
    id: 'qwen', name: 'Qwen-Image Space (Hugging Face)', where: 'huggingface.co, Space Therealsickonechase-bit/rabbitos-eeg-qwen-image',
    uses: 'Paints a picture from the live brain state, hormone words and your data-portrait words.',
    leaves: 'Fixed words and a seed only (state, rhythm, hormone levels, heart and muscle words, level words). Never EEG, heart or hormone numbers. Optionally your own Hugging Face read token.', start: 'Press "Paint now" or "Paint with Qwen"',
  },
  {
    id: 'workersai', name: 'Cloudflare Workers AI illustration', where: 'RabbitOS server, then Cloudflare Workers AI (owner only)',
    uses: 'Draws a teaching illustration of the chosen scenario, organ and style.',
    leaves: 'A prompt built on the server from the model alone, plus optional fixed mood words. No numbers, no free text.', start: 'Press "Generate AI illustration"',
  },
  {
    id: 'claude', name: 'Claude conversation (your own key)', where: 'RabbitOS server, then Anthropic, with the key saved in your Settings',
    uses: 'Lets the avatar hold a free conversation about open questions.',
    leaves: 'The question you type, the last few chat lines, and the avatar’s state as words (mood, activity, hormone levels, scenario).', start: 'Tick "also let Claude answer open questions" under the avatar',
  },
  {
    id: 'server', name: 'RabbitOS server and database', where: 'app.rabbitsoftware.io (Cloudflare Worker, Supabase)',
    uses: 'Serves this page, the research records and the stored EEG band powers (owner only).',
    leaves: 'Your sign-in session. Live EEG, WiFi and data-portrait values are not sent here.', start: 'Always on',
  },
  {
    id: 'supabase', name: 'Supabase (accounts, data, storage)', where: 'Supabase project behind app.rabbitsoftware.io; the page reaches it only through the RabbitOS server',
    uses: 'Sign-in, the research records, the stored EEG band powers (owner only), your coarse daily summaries (owner only) and the public downloads bucket.',
    leaves: 'Your sign-in session, and only what you press a button to save (for example today’s coarse summary). Raw EEG, wearable and lab data stay on this computer.', start: 'Always on (health is read from the server’s database check)',
  },
]

export interface ConnReport { status: ConnStatus; detail?: string; lastAt?: number | null }
export interface ConnInfo extends ConnMeta { status: ConnStatus; detail: string; lastAt: number | null }

export function merge(reports: Partial<Record<ConnId, ConnReport>>): ConnInfo[] {
  return CONNECTIONS.map((m) => {
    const r = reports[m.id]
    return { ...m, status: r?.status ?? (m.id === 'server' || m.id === 'supabase' ? 'idle' : 'off'), detail: r?.detail ?? '', lastAt: r?.lastAt ?? null }
  })
}

/** "3 s ago", "2 min ago", or a dash when it never reported. */
export function ageText(lastAt: number | null, now: number): string {
  if (lastAt === null) return 'never'
  const s = Math.max(0, Math.round((now - lastAt) / 1000))
  return s < 2 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

/** A live feed that has gone quiet is "stale", not "live": anything older than maxAge counts as stale. */
export function judge(status: ConnStatus, lastAt: number | null, now: number, maxAgeMs = 8000): ConnStatus {
  return status === 'live' && lastAt !== null && now - lastAt > maxAgeMs ? 'stale' : status
}

export const STATUS_LABEL: Record<ConnStatus, string> = { off: 'off', connecting: 'connecting', live: 'live', stale: 'quiet', idle: 'ready', error: 'problem' }

export function summary(infos: ConnInfo[]): string {
  const live = infos.filter((i) => i.status === 'live').length
  const feeds = infos.filter((i) => ['openbci', 'selfdata', 'wifi'].includes(i.id))
  const feedsLive = feeds.filter((i) => i.status === 'live').length
  return `${feedsLive} of ${feeds.length} local data feeds live; ${live} connection${live === 1 ? '' : 's'} live in all.`
}
