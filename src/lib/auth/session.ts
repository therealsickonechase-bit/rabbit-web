import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Two roles:
 *   owner  - listed in public.owners. Sees everything.
 *   member - any other confirmed, signed-in account (the default for a sign-up). Research data only.
 *
 * The database enforces this with row-level security (see the owner_member_roles migration); these
 * helpers only decide what the app shows and where it redirects. A mistake here cannot expose owner data.
 */

/** Signed-in, email-confirmed user, or a redirect to /login. */
export async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!user.email_confirmed_at) redirect('/login?error=unconfirmed')
  return user
}

/** The user plus their role, from the database's own is_owner() check. */
export async function getSessionRole() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data } = await supabase.rpc('is_owner')
  return { user, isOwner: data === true }
}

/** Owner-only pages: members are sent to the research page. */
export async function requireOwner() {
  const session = await getSessionRole()
  if (!session.isOwner) redirect('/research')
  return session.user
}
