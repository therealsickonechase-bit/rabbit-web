import { notFound, redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { guestState } from '@/lib/guest'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Two roles:
 *   owner  - listed in public.owners. Sees everything.
 *   member - any other confirmed, signed-in account (the default for a sign-up). Research data only.
 *
 * The database enforces this with row-level security (see the owner_member_roles migration); these
 * helpers only decide what the app shows and where it redirects. A mistake here cannot expose owner data.
 */

/** Legacy account surfaces are disabled, including for previously signed-in browsers. */
export async function requireUser(): Promise<User> {
  notFound()
}

/** The user plus their role, from the database's own is_owner() check. */
export async function getSessionRole() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data } = await supabase.rpc('is_owner')
  const guest = guestState(user)
  return { user, isOwner: data === true, isGuest: guest.isGuest, guestUntil: guest.isGuest ? guest.until : null }
}

/** For pages and actions that need a real account: a guest-pass visitor is sent back to Research. */
export async function requireMember() {
  const user = await requireUser()
  if (guestState(user).isGuest) redirect('/research')
  return user
}

/** Owner-only pages: members are sent to the research page. */
export async function requireOwner() {
  const session = await getSessionRole()
  if (!session.isOwner) redirect('/research')
  return session.user
}

/**
 * Read-only mirror of the owner's pages (Overview, Twin Atlas, Brain Network, Agents, Chain & Audit) for every signed-in account.
 * The owner chose this. It is ON unless the environment variable GUEST_MIRROR is set to "off" (then non-owners are sent to Research again).
 * Never mirrored: Members (accounts and contact records), the owner's stored EEG samples, the twin's name and date of birth, and every owner action (sealing batches, saving summaries, AI illustrations).
 */
export const guestMirrorOn = () => process.env.GUEST_MIRROR !== 'off'

/** Signed-in user on a mirrored page: the owner always, anyone else while the mirror is on. */
export async function requireViewer() {
  const session = await getSessionRole()
  if (!session.isOwner && !guestMirrorOn()) redirect('/research')
  return session
}

/** The owner reads through their own session. A guest reads the same tables through the server (their own session cannot see owner-only rows), so each caller
 *  must list the columns it needs and leave out anything private. */
export async function viewerClient(isOwner: boolean) {
  return isOwner ? await createClient() : createAdminClient()
}
