import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { CloudJobError } from '../cloud-jobs'
import { accessHumanIdentity, machineIdentity, requireRemoteMode, supabaseIdentity, verifiedAccessJwt } from '../cloud-access'

export async function requireCloudIdentity(request?: Request, machine = false) {
  const mode = requireRemoteMode(process.env)
  if (machine) {
    if (!request) throw new CloudJobError(401, 'Machine request required.')
    return machineIdentity(request, process.env)
  }
  if (mode === 'cloudflare-access') {
    const token = request ? request.headers.get('cf-access-jwt-assertion') : (await headers()).get('cf-access-jwt-assertion')
    return accessHumanIdentity(await verifiedAccessJwt(token, process.env), process.env)
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new CloudJobError(503, 'Restricted Supabase authentication is not configured.')
  }
  try {
    const client = await createClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error) throw new CloudJobError(401, 'Restricted cloud sign-in is required.')
    return supabaseIdentity(user, process.env)
  } catch (error) {
    if (error instanceof CloudJobError) throw error
    throw new CloudJobError(503, 'Restricted authentication is unavailable.')
  }
}
