import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAllowedDashboardEmail } from '@/lib/auth/allowlist'

/**
 * Returns the signed-in user, or redirects to /login. Also rejects confirmed-but-not-allowlisted
 * accounts. The proxy already enforces this on every request; calling it again in the layout and
 * in each server action means a mistake in one layer cannot expose the console.
 */
export async function requireAllowedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!user.email_confirmed_at || !isAllowedDashboardEmail(user.email)) {
    redirect('/login?error=unauthorized')
  }
  return user
}
