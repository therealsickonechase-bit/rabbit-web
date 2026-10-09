import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import { MIN_PASSWORD, passwordProblem } from '@/lib/auth/password'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'

// Reached after the emailed link signed the person in (type=recovery), so a session already exists.
async function setPassword(formData: FormData) {
  'use server'
  await requireUser()
  const password = String(formData.get('password') ?? '')
  const problem = passwordProblem(password, String(formData.get('confirm') ?? ''))
  if (problem) redirect(`/reset-password?error=${problem}`)

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error('password update failed', error.status, error.code)
    redirect('/reset-password?error=failed')
  }
  await supabase.auth.signOut()
  redirect('/login?msg=reset')
}

const ERRORS: Record<string, string> = {
  weak: `Use at least ${MIN_PASSWORD} characters.`,
  long: 'That password is too long (72 bytes at most).',
  mismatch: 'The two passwords do not match.',
  failed: 'The password could not be changed. Request a new reset link and try again.',
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser()
  const { error } = await searchParams

  return (
    <AuthShell title="Choose a new password">
      <form action={setPassword} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-xs font-medium mb-1">New password (at least {MIN_PASSWORD} characters)</label>
          <input id="password" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={authInput} />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-xs font-medium mb-1">Repeat new password</label>
          <input id="confirm" name="confirm" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={authInput} />
        </div>
        {error && <Notice tone="bad">{ERRORS[error] ?? ERRORS.failed}</Notice>}
        <button className={button}>Change password</button>
      </form>
    </AuthShell>
  )
}
