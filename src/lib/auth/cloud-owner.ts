import { createClient } from '@/lib/supabase/server'
import { CloudJobError, verifyOwnerIdentity } from '../cloud-jobs'

// Deliberately isolated from disabled legacy account pages and guest mirroring.
export async function requireCloudOwner() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new CloudJobError(503, 'Owner authentication is not configured.')
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) throw new CloudJobError(401, 'An existing owner session is required. Account sign-in remains disabled.')
    const role = await supabase.rpc('is_owner')
    return verifyOwnerIdentity(user, error, role)
  } catch (error) {
    if (error instanceof CloudJobError) throw error
    throw new CloudJobError(503, 'Owner authentication is unavailable.')
  }
}
