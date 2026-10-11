// Summary frames from the WiFi-sensing bridge on THIS computer (research-agents: python ruview_bridge.py, ws://127.0.0.1:8767), which reads RuView
// (github.com/ruvnet/RuView) and reduces it to presence, motion, breathing, heart rate and optional keypoints. The page validates every frame, keeps nothing,
// and never sends any of it anywhere.
//
// HONEST LIMITS. With an ordinary laptop WiFi adapter RuView only sees signal strength: coarse presence and motion. Real channel-state sensing needs a CSI device
// (such as an ESP32-S3). Breathing and heart rate from WiFi are experimental and unvalidated, so every frame says `validated: false` and they are used only as
// gentle hints. WiFi sensing sees everyone in range, including people who did not agree to it: use it only where everyone present knows.

export const WIFI_BRIDGE_URL = 'ws://127.0.0.1:8767'
export const WIFI_MAX_AGE_MS = 6000

export interface Vital { bpm: number; confidence: number }
export interface WifiFrame {
  t: number
  source: string
  presence: boolean | null
  persons: number | null
  /** 0 still .. 1 moving a lot */
  motion: number | null
  breathing: Vital | null
  heart: Vital | null
  signalQuality: number | null
  /** 17 body points in 0..1, only if the sensing model provides them */
  pose: { x: number; y: number; c: number }[] | null
  validated: false
  simulated: boolean
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const unit = (v: unknown): number | null => (isNum(v) && v >= 0 && v <= 1 ? v : null)
const vital = (v: unknown, lo: number, hi: number): Vital | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as { bpm?: unknown; confidence?: unknown }
  return isNum(o.bpm) && o.bpm >= lo && o.bpm <= hi ? { bpm: o.bpm, confidence: unit(o.confidence) ?? 0 } : null
}

export function parseWifiFrame(raw: unknown): WifiFrame | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.v !== 1 || m.type !== 'wifisense' || !isNum(m.t) || typeof m.source !== 'string' || !/^[a-z0-9:_.-]{1,40}$/i.test(m.source)) return null
  const persons = isNum(m.persons) && Number.isInteger(m.persons) && m.persons >= 0 && m.persons <= 50 ? m.persons : null
  let pose: WifiFrame['pose'] = null
  if (Array.isArray(m.pose) && m.pose.length === 17) {
    const pts = m.pose.map((p) => (p && typeof p === 'object' ? { x: (p as { x?: unknown }).x, y: (p as { y?: unknown }).y, c: (p as { c?: unknown }).c } : null))
    if (pts.every((p) => p && isNum(p.x) && isNum(p.y) && p.x >= -0.5 && p.x <= 1.5 && p.y >= -0.5 && p.y <= 1.5)) pose = pts.map((p) => ({ x: p!.x as number, y: p!.y as number, c: unit(p!.c) ?? 0 }))
  }
  return {
    t: m.t, source: m.source, presence: typeof m.presence === 'boolean' ? m.presence : null, persons, motion: unit(m.motion),
    breathing: vital(m.breathing, 3, 40), heart: vital(m.heart, 30, 200), signalQuality: unit(m.signal_quality), pose, validated: false,
    simulated: m.source.startsWith('bridge:simulated'),
  }
}

export const isFreshWifi = (f: WifiFrame | null, now = Date.now()): f is WifiFrame => !!f && Math.abs(now - f.t) < WIFI_MAX_AGE_MS

/** What the avatar's mind may use: presence and motion directly, vitals only when the estimate is confident enough to be more than noise. */
export interface Occupant { present: boolean | null; motion: number | null; breathingBpm: number | null; heartBpm: number | null; simulated: boolean; source: string }
export const MIN_VITAL_CONFIDENCE = 0.4

export function occupantFrom(f: WifiFrame | null): Occupant | null {
  if (!f) return null
  return {
    present: f.presence, motion: f.motion,
    breathingBpm: f.breathing && f.breathing.confidence >= MIN_VITAL_CONFIDENCE ? f.breathing.bpm : null,
    heartBpm: f.heart && f.heart.confidence >= MIN_VITAL_CONFIDENCE ? f.heart.bpm : null,
    simulated: f.simulated, source: f.source,
  }
}

/** A plain-words line for the screen and for answers. */
export function describeWifi(f: WifiFrame): string {
  const who = f.presence === null ? 'cannot tell if anyone is in range' : f.presence ? `sees ${f.persons && f.persons > 1 ? `${f.persons} people` : 'someone'} in range` : 'sees nobody in range'
  const move = f.motion === null ? '' : f.motion < 0.05 ? ', perfectly still' : f.motion < 0.3 ? ', sitting or standing still' : f.motion < 0.6 ? ', moving a little' : ', moving around'
  const br = f.breathing ? `, breathing about ${Math.round(f.breathing.bpm)} a minute` : ''
  const hr = f.heart ? `, heart about ${Math.round(f.heart.bpm)}` : ''
  return `WiFi ${who}${move}${br}${hr}${f.breathing || f.heart ? ' (experimental, unvalidated)' : ''}`
}
