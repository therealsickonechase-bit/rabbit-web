// Guest passes: a link the owner hands out that signs someone in for 3 days with no password.
// Pure rules live here so they can be tested; database and session code is in the pages that use them.

export const ACCESS_DAYS = 3
export const LINK_DAYS = 14          // an unused link stops working after this long
export const MAX_USES = 5            // sign-ins one link allows (several devices, but not unlimited sharing)
export const MAX_ACTIVE_PASSES = 20
export const GUEST_EMAIL_DOMAIN = 'guest.rabbitsoftware.io'   // never receives mail; the account is never emailed
const DAY = 86_400_000

/** Pages a guest may open. Everything else sends them back to Research. */
export const GUEST_PATHS = ['/research', '/crispr', '/guide', '/guest', '/login']

export const guestPathAllowed = (path: string) => GUEST_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `rbg_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

export const tokenShape = (t: string) => /^rbg_[A-Za-z0-9_-]{30,64}$/.test(t)

export async function hashToken(token: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const guestEmail = (id: string) => `guest-${id}@${GUEST_EMAIL_DOMAIN}`
export const isGuestEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`)

export interface PassRow {
  link_expires_at: string
  first_used_at: string | null
  access_until: string | null
  uses: number
  max_uses: number
  revoked_at: string | null
}

export type Redemption = { ok: true; accessUntil: string; first: boolean } | { ok: false; reason: 'revoked' | 'link_expired' | 'access_ended' | 'too_many_uses' }

/** Can this pass be used right now, and until when does access last? */
export function evaluateRedemption(p: PassRow, now = Date.now()): Redemption {
  if (p.revoked_at) return { ok: false, reason: 'revoked' }
  if (p.access_until && new Date(p.access_until).getTime() <= now) return { ok: false, reason: 'access_ended' }
  if (!p.first_used_at && new Date(p.link_expires_at).getTime() <= now) return { ok: false, reason: 'link_expired' }
  if (p.uses >= p.max_uses) return { ok: false, reason: 'too_many_uses' }
  return p.access_until
    ? { ok: true, accessUntil: p.access_until, first: false }
    : { ok: true, accessUntil: new Date(now + ACCESS_DAYS * DAY).toISOString(), first: true }
}

export const REASON_TEXT: Record<string, string> = {
  revoked: 'This guest pass was cancelled.',
  link_expired: 'This guest link was never used and has expired. Ask for a new one.',
  access_ended: 'This guest pass has ended. Ask for a new one.',
  too_many_uses: 'This guest link has been used the maximum number of times.',
  invalid: 'That guest link is not valid.',
}

/** What the session says about a guest: from the user's app_metadata, set by the server when the pass is first used. */
export function guestState(user: { app_metadata?: Record<string, unknown> | null } | null | undefined, now = Date.now()) {
  const m = user?.app_metadata
  if (!m || m.guest !== true) return { isGuest: false as const }
  const until = typeof m.guest_until === 'string' ? new Date(m.guest_until).getTime() : NaN
  // A guest account with no valid end date is treated as already ended: fail closed.
  return { isGuest: true as const, active: Number.isFinite(until) && until > now, until: Number.isFinite(until) ? new Date(until).toISOString() : null }
}

export function timeLeft(untilIso: string | null, now = Date.now()) {
  if (!untilIso) return 'ended'
  const ms = new Date(untilIso).getTime() - now
  if (ms <= 0) return 'ended'
  const h = Math.floor(ms / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : h >= 1 ? `${h}h left` : `${Math.max(1, Math.floor(ms / 60_000))}m left`
}
