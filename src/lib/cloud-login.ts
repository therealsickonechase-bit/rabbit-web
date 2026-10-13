import { allowedEmail, requireRemoteMode, supabaseIdentity } from './cloud-access.ts'
import type { CloudConfig } from './cloud-access.ts'
import { CloudJobError } from './cloud-jobs.ts'

export function restrictedLoginInput(value: unknown, config: CloudConfig) {
  if (requireRemoteMode(config) !== 'supabase') throw new CloudJobError(403, 'Restricted password login is only enabled in Supabase mode.')
  const input = value as { email?: unknown; password?: unknown } | null
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['email', 'password'].includes(key)) ||
      typeof input.password !== 'string' || !input.password || input.password.length > 1024) {
    throw new CloudJobError(400, 'Email and password are required.')
  }
  try { return { email: allowedEmail(input.email, config), password: input.password } }
  catch { throw new CloudJobError(401, 'Existing confirmed allowlisted account sign-in failed.') }
}

type LoginClient = { auth: {
  signInWithPassword(input: { email: string; password: string }): Promise<{ error: unknown }>
  getUser(): Promise<{ data: { user: { email?: string; email_confirmed_at?: string | null } | null }; error: unknown }>
  signOut(): Promise<{ error?: unknown } | void>
} }

export async function restrictedLogin(client: LoginClient, input: { email: string; password: string }, config: CloudConfig) {
  try {
    const login = await client.auth.signInWithPassword(input)
    if (login.error) throw new Error('login failed')
    const verification = await client.auth.getUser()
    if (verification.error) throw new Error('verification failed')
    const identity = supabaseIdentity(verification.data.user, config)
    if (identity.subject !== `email:${input.email}`) throw new Error('session mismatch')
    return { signedIn: true, approvalRequired: true }
  } catch {
    try {
      const cleanup = await client.auth.signOut()
      if (cleanup?.error) throw new Error('provider cleanup rejected')
    } catch {
      throw new CloudJobError(503, 'Restricted sign-in was denied and provider session cleanup failed. Session clearance is NOT confirmed. Do not use this session; cloud identity and grant checks remain required.')
    }
    throw new CloudJobError(401, 'Existing confirmed allowlisted account sign-in failed.')
  }
}
