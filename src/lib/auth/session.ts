import { createAdminClient } from '@/lib/supabase/admin'
import { visitor, type Visitor } from '@/lib/open-access'

/**
 * Open access. There is no login and there are no owner, member or guest tiers: everyone is the same anonymous visitor,
 * with no cookies and no auth. The helpers below keep their old names so pages did not need rewriting, but none of them
 * ever redirects or returns 404.
 *
 * What stays closed is decided by the data layer, not by who is asking: contact records, API keys, per-person secrets
 * and the audit trail's write path are never reachable from these pages (see docs/rabbitos.md).
 */

export async function requireUser(): Promise<Visitor> {
  return visitor()
}

export async function getSessionRole() {
  return { user: visitor(), isOwner: true as const, isGuest: false as const, guestUntil: null }
}

export const requireMember = requireUser

export async function requireOwner(): Promise<Visitor> {
  return visitor()
}

export async function requireViewer() {
  return getSessionRole()
}

/** Always the server's admin client (service role, server-only). Callers must list the columns they need. */
export async function viewerClient() {
  return createAdminClient()
}
