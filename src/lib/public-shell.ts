// Browser-side rules for the public CloudShell sandbox. Pure and importable by Node tests (no `@/` alias, no DOM).
// The terminal talks straight to the public-shell Worker (NEXT_PUBLIC_PUBLIC_SHELL_URL). Nothing here goes through this app's server,
// and API keys are never written to storage that outlives the tab.

export const WS_PROTOCOL = 'rabbit-shell.v1'

/** The only variables the sandbox accepts, with labels for the drawer. Must match workers/public-shell/src/env.mjs. */
export const KEY_FIELDS = [
  { name: 'ANTHROPIC_API_KEY', label: 'Anthropic API key (for claude)' },
  { name: 'GEMINI_API_KEY', label: 'Gemini API key (for gemini)' },
  { name: 'GOOGLE_API_KEY', label: 'Google API key (alternative for gemini)' },
  { name: 'COPILOT_GITHUB_TOKEN', label: 'GitHub token for copilot (fine-grained, "Copilot Requests" permission)' },
] as const

export type KeyName = typeof KEY_FIELDS[number]['name']
export type Keys = Partial<Record<KeyName, string>>

const KEY_VALUE = /^[\x21-\x7e]{8,512}$/

/** Base URL of the Worker, or null when unset or not a plain https (or local http) origin. */
export function shellBase(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null
    return u.origin
  } catch {
    return null
  }
}

export function wsUrl(base: string): string {
  const u = new URL('/ws', base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

/** WebSocket subprotocols: the version, then the session token (kept out of the URL so it is not logged). */
export const protocols = (token: string): string[] => [WS_PROTOCOL, token]

/** Keep only well-formed entries. Returns the cleaned keys and the first problem, if any. */
export function cleanKeys(input: Record<string, string | undefined>): { keys: Keys; error: string | null } {
  const keys: Keys = {}
  for (const f of KEY_FIELDS) {
    const value = (input[f.name] ?? '').trim()
    if (!value) continue
    if (!KEY_VALUE.test(value)) return { keys: {}, error: `${f.label}: 8 to 512 printable characters, no spaces.` }
    keys[f.name] = value
  }
  return { keys, error: null }
}

export const helloFrame = (cols: number, rows: number, keys: Keys) => JSON.stringify({ t: 'hello', cols, rows, keys })
export const inputFrame = (d: string) => JSON.stringify({ t: 'i', d })
export const resizeFrame = (cols: number, rows: number) => JSON.stringify({ t: 'r', cols, rows })

/** Keyboard input is split so that no frame goes over the Worker's limit (16 KiB). */
export function inputChunks(data: string, maxChars = 4096): string[] {
  const out: string[] = []
  for (let i = 0; i < data.length; i += maxChars) out.push(data.slice(i, i + maxChars))
  return out
}

/** Buttons that type a command into the terminal. */
export const QUICK_START = [
  { label: 'Run gemini', command: 'gemini' },
  { label: 'Run claude', command: 'claude' },
  { label: 'Run copilot', command: 'copilot' },
  { label: 'Show ledger', command: 'ledger' },
  { label: 'List repos', command: 'repos' },
] as const

export const LIMITS_TEXT = [
  'Public and shared: anyone can open a sandbox, so never type a secret you want to keep.',
  'Ephemeral: a session ends after 10 idle minutes or 30 minutes in total, and everything in it is deleted.',
  'Small: a quarter of a vCPU, 1 GiB of memory, limited disk, one sandbox per visitor, a daily command quota.',
  'Limited network: package registries, public GitHub, api.anthropic.com, generativelanguage.googleapis.com, the Copilot CLI hosts and the public ledger only.',
  'Bring your own API key. Keys stay in this tab and are sent only to your own sandbox process; use a low-limit key.',
] as const

/** Friendly text for a failed session request (the Worker's message wins when present). */
export function sessionError(status: number, message?: string): string {
  if (message) return message
  if (status === 503) return 'The public sandbox is switched off right now.'
  if (status === 429) return 'Too many sandboxes right now. Try again soon.'
  if (status === 403) return 'The human check failed. Reload the check and try again.'
  return `The sandbox could not be started (${status}).`
}

// ---------- terminal look ----------
// The shell in the container is always bash. 'powershell' only changes colors and the banner: it never runs PowerShell.
export const TERM_STYLES = ['linux', 'powershell'] as const
export type TermStyle = (typeof TERM_STYLES)[number]
export const TERM_STYLE_LABEL: Record<TermStyle, string> = { linux: 'Linux', powershell: 'PowerShell-look' }
export const normalizeTermStyle = (v: unknown): TermStyle => (v === 'powershell' ? 'powershell' : 'linux')
export const TERM_FONT = 'Cascadia Mono, Consolas, Menlo, monospace'
export const TERM_SCROLLBACK = 5000

const BASE_THEME = { background: '#000000', foreground: '#cccccc', cursorAccent: '#000000', selectionBackground: '#3a3d41' }
export function terminalTheme(style: TermStyle) {
  // Accent also remaps ANSI green, which is the container's prompt color, so the prompt follows the chosen style.
  return style === 'powershell'
    ? { ...BASE_THEME, cursor: '#3b8eea', green: '#3b8eea', brightGreen: '#29b8db', blue: '#3b78ff', brightBlue: '#6ea8ff' }
    : { ...BASE_THEME, cursor: '#16c60c', green: '#16c60c', brightGreen: '#3ddc84', blue: '#3b78ff', brightBlue: '#6ea8ff' }
}
/** CSS accent (title bar dot, active buttons) per style. */
export const accentColor = (style: TermStyle) => (style === 'powershell' ? '#3b8eea' : '#16c60c')

/** Welcome text written into the terminal before a session starts. Honest: the shell is bash either way. */
export function welcomeBanner(style: TermStyle): string[] {
  const a = style === 'powershell' ? '\x1b[34m' : '\x1b[32m', off = '\x1b[0m'
  const out = style === 'powershell'
    ? [`${a}RabbitOS public sandbox${off}  (PowerShell-look theme)`, 'Colors only: the shell inside the sandbox is bash, not PowerShell. Use ls, cd, cat, not Get-ChildItem.']
    : [`${a}RabbitOS public sandbox${off}  (Linux theme)`, 'The shell inside the sandbox is bash.']
  return [...out, 'Pass the human check, then press Start sandbox. Type help-rabbit once connected for the guide.']
}

// ---------- session clock ----------
export const SESSION_IDLE_MS = 10 * 60_000
export const SESSION_MAX_MS = 30 * 60_000
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
/** What the title bar shows. The server is the authority; this is an estimate from the browser clock. */
export function sessionClock(startedAt: number, lastInputAt: number, now: number) {
  const elapsed = Math.max(0, now - startedAt)
  const idleLeft = Math.max(0, SESSION_IDLE_MS - Math.max(0, now - lastInputAt))
  const lifetimeLeft = Math.max(0, SESSION_MAX_MS - elapsed)
  return { elapsed: formatClock(elapsed), idle: formatClock(idleLeft), left: formatClock(lifetimeLeft), endsIn: formatClock(Math.min(idleLeft, lifetimeLeft)) }
}

// ---------- the Guide panel (the same content is printed by `help-rabbit` in the container) ----------
export interface GuideSection { title: string; lines: readonly string[] }
export const GUIDE: readonly GuideSection[] = [
  { title: 'First steps', lines: [
    'Pass the human check, press Start sandbox, wait for the prompt.',
    'Type repos to see the read-only code in /workspace, then cp -r /workspace/rabbit-web ~/work/ to get a writable copy.',
    'Type help-rabbit in the terminal to print this guide there.',
  ] },
  { title: 'Bring your own key', lines: [
    'Open API keys, paste a Gemini, Anthropic or Copilot key, then start the sandbox. Keys apply to the next session.',
    'The key stays in this tab and goes only to your sandbox process. Use a low-limit key.',
  ] },
  { title: 'Default agent', lines: [
    'Pick Gemini, Claude or Copilot, then Start my default agent. It types the name; you press Enter.',
  ] },
  { title: 'Copilot sign-in', lines: [
    'Needs a GitHub Copilot subscription. Either run /login inside copilot (device code: open the printed URL in your own browser),',
    'or paste a fine-grained GitHub token with the "Copilot Requests" permission as COPILOT_GITHUB_TOKEN before starting.',
  ] },
  { title: 'PowerShell and the network', lines: [
    'Start PowerShell types pwsh (PowerShell 7); press Enter yourself. The login shell stays bash; exit returns to it.',
    'Default is the normal connection: Invoke-WebRequest and Invoke-RestMethod work only through the same allowlist as curl.',
    'rabbit-net status shows the allowed hosts; rabbit-net check tests them with HTTPS HEAD requests (5 s timeout).',
    'ping, DNS lookup tools, traceroute, nmap, netcat and port scanners are not installed on purpose: only HTTPS to named hosts can leave this box, so they could not work, and they are the tools used to scan other machines. Use the RabbitNet module on your own PC for that.',
  ] },
  { title: 'Common commands', lines: [
    'cd DIR, ls -la, cat FILE, rg PATTERN, git status, git log, node FILE.js, python3 FILE.py',
  ] },
  { title: 'Limits', lines: [
    'Login shell is bash (type pwsh for PowerShell 7; the PowerShell-look style is colors only). 10 idle minutes or 30 minutes total, then everything is deleted.',
    'Network: package registries, public GitHub, Anthropic, Google AI and Copilot APIs, the public ledger.',
  ] },
]
