// Pure helpers for the owner console's terminal view: in-memory command history (Up/Down), scrollback entries and the local `help` text.
// Nothing here runs a command or touches storage: history lives in component state and is gone on reload.

export const HISTORY_MAX = 100
export const SCROLLBACK_MAX = 200
export const OUTPUT_MAX_CHARS = 64 * 1024

/** Newest last. Empty and immediately repeated commands are not added. */
export function pushHistory(history: readonly string[], command: string): string[] {
  const c = command.trim()
  if (!c || history[history.length - 1] === c) return [...history]
  return [...history, c].slice(-HISTORY_MAX)
}

export interface HistoryCursor { index: number; draft: string }
export const freshCursor: HistoryCursor = { index: -1, draft: '' }

/** Up goes to older commands, Down to newer and finally back to what was being typed. `index` -1 means "not browsing". */
export function stepHistory(history: readonly string[], cursor: HistoryCursor, direction: 'up' | 'down', current: string):
  { cursor: HistoryCursor; value: string } {
  if (!history.length) return { cursor, value: current }
  if (direction === 'up') {
    const draft = cursor.index === -1 ? current : cursor.draft
    const index = cursor.index === -1 ? history.length - 1 : Math.max(0, cursor.index - 1)
    return { cursor: { index, draft }, value: history[index] }
  }
  if (cursor.index === -1) return { cursor, value: current }
  const index = cursor.index + 1
  if (index >= history.length) return { cursor: freshCursor, value: cursor.draft }
  return { cursor: { index, draft: cursor.draft }, value: history[index] }
}

export interface ScrollEntry { id: number; command: string; output: string; status: string }

const clip = (text: string) => (text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n[output clipped in this view]` : text)

export function outputText(data: { stdout?: unknown; stderr?: unknown }): string {
  const out = typeof data.stdout === 'string' ? data.stdout : ''
  const err = typeof data.stderr === 'string' ? data.stderr : ''
  return clip([out, err].filter(Boolean).join(out && err && !out.endsWith('\n') ? '\n' : ''))
}

export function statusText(data: { exitCode?: unknown; timedOut?: unknown; truncated?: unknown }): string {
  const parts = [data.timedOut === true ? 'timed out' : `exit ${typeof data.exitCode === 'number' ? data.exitCode : '?'}`]
  if (data.truncated === true) parts.push('output truncated')
  return parts.join(', ')
}

/** Newest last, capped. */
export function appendScroll(entries: readonly ScrollEntry[], entry: ScrollEntry): ScrollEntry[] {
  return [...entries, entry].slice(-SCROLLBACK_MAX)
}

/** Typing exactly `help` (any case, spaces around) shows the guide locally instead of being sent anywhere. */
export const isHelpCommand = (text: string) => text.trim().toLowerCase() === 'help'

export const OWNER_HELP: readonly string[] = [
  'Type a bash command at the prompt. Nothing runs when you press Enter.',
  'To run it: tick the approval box, then click "Run approved command". The checkbox resets after every run.',
  'Each command runs in a fresh, disposable container (no kept directory or variables). 4000 bytes, 60 seconds, one at a time.',
  'Up / Down walk through commands you ran in this tab. History and scrollback are kept in memory only and vanish on reload.',
  'Pick a catalog command to fill the prompt. Type help and press Enter to show this guide again.',
  'Never type provider keys or tokens into a command; no app credentials are passed into the sandbox.',
]
