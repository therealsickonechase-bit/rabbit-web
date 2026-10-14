// What feeds the Brain Network page, in one list: each data source or service, where it runs, whether it is live, what the page uses it for, whether
// anything leaves this computer because of it, and how to start it. Pure functions and fixed metadata, tested; the components report live status into it.

export type ConnStatus = 'off' | 'connecting' | 'live' | 'stale' | 'idle' | 'error'
export type ConnId = 'openbci' | 'selfdata' | 'wormhole' | 'wifi' | 'relay' | 'qwen' | 'qwenchat' | 'workersai' | 'claude' | 'server' | 'supabase'

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
    leaves: 'Nothing, unless you press "Paint with Qwen" (fixed words only). Saved coarse summaries remain unencrypted in this browser only.', start: 'research-agents\\start-selfdata.ps1 (-Demo for a made-up person)',
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
    leaves: 'Only ciphertext and who is talking to whom, when, and message sizes. The relay cannot read or change what is said.', start: 'research-agents\\start-twinnet.ps1 -Relay, then Connect Twin A in the Twin network panel',
  },
  {
    id: 'qwen', name: 'Qwen-Image Space (Hugging Face)', where: 'huggingface.co, Space Therealsickonechase-bit/rabbitos-eeg-qwen-image',
    uses: 'Paints a picture from the live brain state, hormone words and your data-portrait words.',
    leaves: 'Fixed words and a seed only (state, rhythm, hormone levels, heart and muscle words, level words). Never EEG, heart or hormone numbers. Optionally your own Hugging Face read token.', start: 'Press "Paint now" or "Paint with Qwen"',
  },
  {
    id: 'workersai', name: 'Cloudflare Workers AI illustration (retired)', where: 'Disabled account service',
    uses: 'The former owner illustration service is unavailable in the account-free workspace.',
    leaves: 'Nothing; this account endpoint is disabled.', start: 'Use the optional Hugging Face image panel instead',
  },
  {
    id: 'claude', name: 'Claude conversation (retired)', where: 'Disabled account service',
    uses: 'Former account-stored provider keys are not loaded.',
    leaves: 'Nothing; account-stored keys are never loaded.', start: 'Use hosted Qwen or the built-in local body model',
  },
  {
    id: 'qwenchat', name: 'Hosted Qwen3 conversation', where: 'RabbitOS server, then Cloudflare Workers AI through the shared Qwen gateway',
    uses: 'Answers avatar open questions; built-in body and introspection answers remain local.',
    leaves: 'Only your approved question, recent conversation and state words. No raw EEG, wearable or lab values. Hosted inference is separate from local Ollama.', start: 'Choose Hosted Qwen3 and approve each open question under the avatar',
  },
  {
    id: 'server', name: 'RabbitOS server and database', where: 'app.rabbitsoftware.io (Cloudflare Worker, Supabase); Cloud Run mirror at run.rabbitsoftware.io',
    uses: 'Serves the account-free workspace, public literature feed and optional hosted avatar chat.',
    leaves: 'Approved avatar questions/history/state words only. No account session is used; live raw EEG, WiFi and data-portrait values stay local.', start: 'Always on',
  },
  {
    id: 'supabase', name: 'Supabase (accounts, data, storage)', where: 'Supabase project behind app.rabbitsoftware.io; the page reaches it only through the RabbitOS server',
    uses: 'Already-public literature metadata and published downloads. Existing private accounts and records remain inaccessible.',
    leaves: 'No account credentials or browser notes. Public feed/download requests only. Raw EEG, wearable and lab data stay on this computer.', start: 'Public read-only access (health is read from the server database check)',
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
