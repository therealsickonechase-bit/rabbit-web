import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { appUrl } from '@/lib/mail'
import { EMAIL_SHAPE } from '@/lib/auth/password'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'
import Turnstile, { captchaTokenFrom } from '@/components/Turnstile'

async function requestReset(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  if (!EMAIL_SHAPE.test(email)) redirect('/forgot-password?error=email')

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    captchaToken: captchaTokenFrom(formData),
    redirectTo: `${appUrl()}/auth/confirm`,
  })
  if (error) {
    console.error('password reset request failed', error.status, error.code)
    if (error.message.toLowerCase().includes('captcha')) redirect('/forgot-password?error=captcha')
  }
  // Same answer whether or not the address has an account, so this cannot be used to look people up.
  redirect('/forgot-password?sent=1')
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link href="/login" className="text-accent underline">Back to sign in</Link>}>
        <Notice tone="ok">If an account exists for that address, we have sent a link to reset the password. It works once.</Notice>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password" footer={<Link href="/login" className="text-accent underline">Back to sign in</Link>}>
      <form action={requestReset} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={authInput} />
        </div>
        {error && <Notice tone="bad">{error === 'captcha' ? 'Please complete the check and try again.' : 'Enter a valid email address.'}</Notice>}
        <Turnstile />
        <button className={button}>Send reset link</button>
      </form>
    </AuthShell>
  )
}
