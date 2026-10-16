// Session mode for the owner cloud shell, as the page and the backend see it. Pure helpers (no imports) so tests can run them.
// By default each command runs in its own blank sandbox that is destroyed afterwards. In session mode the commands share one sandbox that lives up to 20 idle minutes / 2 hours,
// so installs, files and background jobs survive between commands. The Worker (workers/cloudshell/src/session.mts) enforces the limits; these helpers only describe and shape them.

export const SESSION_TIMEOUTS = Object.freeze([60, 90, 120, 150] as const)
export const SESSION_DEFAULT_TIMEOUT = 90
export const SESSION_MAX_TIMEOUT = 150

export interface SessionView { active: boolean; startedAt?: number; lastUsed?: number; idleExpiresAt?: number; hardExpiresAt?: number }

/** The body for /api/cloudshell/execute. Without a session it is exactly the old shape. */
export function shellPayload(command: string, keepSession: boolean, timeoutSeconds: number = SESSION_DEFAULT_TIMEOUT) {
  if (!keepSession) return { command, consent: true as const }
  const seconds = Number.isInteger(timeoutSeconds) ? Math.min(SESSION_MAX_TIMEOUT, Math.max(1, timeoutSeconds)) : SESSION_DEFAULT_TIMEOUT
  return { command, consent: true as const, session: true as const, timeoutSeconds: seconds }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** What the Worker says about the session, reduced to the fields the page uses. Anything unexpected becomes "no session". */
export function sessionView(value: unknown): SessionView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { active: false }
  const v = value as Record<string, unknown>
  if (v.active !== true || !finite(v.idleExpiresAt) || !finite(v.hardExpiresAt)) return { active: false }
  return { active: true, startedAt: finite(v.startedAt) ? v.startedAt : undefined, lastUsed: finite(v.lastUsed) ? v.lastUsed : undefined, idleExpiresAt: v.idleExpiresAt, hardExpiresAt: v.hardExpiresAt }
}

/** The sentence under the terminal: whether a session is live and when it ends (whichever limit comes first). */
export function sessionLine(session: SessionView | null | undefined, now: number = Date.now()): string {
  if (!session?.active || !session.idleExpiresAt || !session.hardExpiresAt) return 'No session is open. Each command runs in its own blank sandbox.'
  const end = Math.min(session.idleExpiresAt, session.hardExpiresAt)
  if (end <= now) return 'The session has expired and is being cleaned up. The next command starts a fresh one.'
  const minutes = Math.max(1, Math.round((end - now) / 60_000))
  const why = session.hardExpiresAt <= session.idleExpiresAt ? 'the 2-hour limit' : 'idle time'
  return `Session open: files and installs stay between commands. It ends in about ${minutes} minute${minutes === 1 ? '' : 's'} (${why}); each command you run extends the idle window.`
}

/** The request body the session route accepts. Both actions need an explicit approval, which the button click is. */
export function sessionAction(value: unknown): 'start' | 'end' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => k !== 'action' && k !== 'consent') || v.consent !== true || (v.action !== 'start' && v.action !== 'end')) {
    throw new Error('Send {"action":"start"|"end","consent":true}.')
  }
  return v.action
}
