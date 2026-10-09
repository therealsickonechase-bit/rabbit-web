// One password rule for sign-up and reset. Supabase hashes with bcrypt, which ignores everything past
// 72 bytes, so longer passwords are refused rather than silently truncated.
export const MIN_PASSWORD = 12
export const MAX_PASSWORD_BYTES = 72

export function passwordProblem(password: string, confirm?: string): 'weak' | 'long' | 'mismatch' | null {
  if (password.length < MIN_PASSWORD) return 'weak'
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'long'
  if (confirm !== undefined && password !== confirm) return 'mismatch'
  return null
}

export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
