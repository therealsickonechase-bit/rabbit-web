import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { appUrl } from '@/lib/mail'
import { EMAIL_SHAPE } from '@/lib/auth/email'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'
import Turnstile, { captchaTokenFrom } from '@/components/Turnstile'

// Passwordless sign-in and sign-up in one form: the person enters only their email address and gets a one-time
// link. A new address gets an account when the link is confirmed (its encrypted contact record is stored there).
async function sendLink(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  if (!EMAIL_SHAPE.test(email)) redirect('/login?error=email')
  const captchaToken = captchaTokenFrom(formData)
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) redirect('/login?error=captcha')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, captchaToken, emailRedirectTo: `${appUrl()}/auth/confirm` },
  })
  if (error) {
    console.error('sign-in link failed', error.status, error.code)
    const m = error.message.toLowerCase()
    // A new address gets the same "sent" page as a known one, so this form cannot reveal who has an account.
    if (m.includes('captcha')) redirect('/login?error=captcha')
    if (m.includes('not allowed') || m.includes('disabled')) redirect('/login?error=closed')
    if (error.status === 429) redirect('/login?error=rate')
    redirect('/login?error=failed')
  }
  redirect('/login?sent=1')
}

const MESSAGES: Record<string, string> = {
  unconfirmed: 'Confirm your email address first, using the link we sent you.',
  confirm: 'That link is not valid or has already been used. Request a new one.',
}

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  captcha: 'The security check was missing, expired or rejected. Complete a fresh check and try again. If it cannot load, allow challenges.cloudflare.com in your browser or network filters.',
  closed: 'Sign-in is not open yet.',
  rate: 'Too many attempts. Please wait a few minutes and try again.',
  failed: 'We could not send the link. Please try again.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string; sent?: string }> }) {
  const { error, msg, sent } = await searchParams

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link href="/login" className="text-accent underline">Back to sign in</Link>}>
        <Notice tone="ok">
          We have sent a sign-in link to that address. The link works once. It can take a few minutes to arrive, so look in your spam folder too.
        </Notice>
      </AuthShell>
    )
  }

  const note = (error && MESSAGES[error]) || (msg && MESSAGES[msg]) || undefined
  const problem = error && !MESSAGES[error] ? (ERRORS[error] ?? ERRORS.failed) : undefined

  return (
    <AuthShell
      title="Sign in to your account"
      subtitle="No password. Enter your email and we send you a one-time sign-in link. Anyone can join."
      footer={<p>rabbitsoftware.io</p>}
    >
      {note && <Notice tone="ok">{note}</Notice>}
      <form action={sendLink} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={authInput} />
        </div>
        <p className="text-xs text-muted">
          First time here? Entering your email creates your account. We keep an encrypted copy of your address, used only to answer a valid legal request.
          By continuing you agree to the{' '}
          <a href="https://rabbitsoftware.io/privacy.html" className="text-accent underline" target="_blank" rel="noopener noreferrer">privacy policy</a>.
        </p>
        {problem && <Notice tone="bad">{problem}</Notice>}
        <Turnstile buttonClass={button} />
      </form>
    </AuthShell>
  )
}
