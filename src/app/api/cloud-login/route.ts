import { createClient } from '@/lib/supabase/server'
import { requireRemoteMode } from '@/lib/cloud-access'
import { restrictedLogin, restrictedLoginInput } from '@/lib/cloud-login'
import { CloudJobError, readJson, requireWriteOrigin } from '@/lib/cloud-jobs'
import { privateJson } from '@/lib/cloud-job-bff'

export async function POST(request: Request) {
  try {
    if (requireRemoteMode(process.env) !== 'supabase') throw new CloudJobError(403, 'Restricted password login is only enabled in Supabase mode.')
    requireWriteOrigin(request)
    const input = restrictedLoginInput(await readJson(request, 4096), process.env)
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new CloudJobError(503, 'Restricted Supabase authentication is not configured.')
    }
    return privateJson(await restrictedLogin(await createClient(), input, process.env))
  } catch (error) {
    return privateJson({ error: error instanceof CloudJobError ? error.message : 'Restricted sign-in unavailable.' },
      error instanceof CloudJobError ? error.status : 503)
  }
}
