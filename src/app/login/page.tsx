import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { appUrl } from '@/lib/mail'
import { EMAIL_SHAPE } from '@/lib/auth/email'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'
import Turnstile, { captchaTokenFrom } from '@/components/Turnstile'

// Passwordless sign-in: the person enters only their email address and gets a one-time link.
// shouldCreateUser is false, so this form never makes an account (sign-up has its own form and contact record).
async function sendLink(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  if (!EMAIL_SHAPE.test(email)) redirect('/login?error=email')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, captchaToken: captchaTokenFrom(formData), emailRedirectTo: `${appUrl()}/auth/confirm` },
  })
  if (error) {
    console.error('sign-in link failed', error.status, error.code)
    const m = error.message.toLowerCase()
    // An unknown address gets the same "sent" page as a known one, so this form cannot reveal who has an account.
    if (m.includes('captcha')) redirect('/login?error=captcha')
    if (error.status === 429) redirect('/login?error=rate')
    if (!m.includes('not found') && !m.includes('signups not allowed')) redirect('/login?error=failed')
  }
  redirect('/login?sent=1')
}

const MESSAGES: Record<string, string> = {
  unconfirmed: 'Confirm your email address first, using the link we sent you.',
  confirm: 'That link is not valid or has already been used. Request a new one.',
}

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  captcha: 'Please complete the check and try again.',
  rate: 'Too many attempts. Please wait a few minutes and try again.',
  failed: 'We could not send the link. Please try again.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string; sent?: string }> }) {
  const { error, msg, sent } = await searchParams

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link href="/login" className="text-accent underline">Back to sign in</Link>}>
        <Notice tone="ok">
          If that address has a RabbitOS account, we have sent a sign-in link. The link works once. It can take a few minutes to arrive, so look in your spam folder too.
        </Notice>
      </AuthShell>
    )
  }

  const note = (error && MESSAGES[error]) || (msg && MESSAGES[msg]) || undefined
  const problem = error && !MESSAGES[error] ? (ERRORS[error] ?? ERRORS.failed) : undefined

  return (
    <AuthShell
      title="Sign in to your account"
      subtitle="No password. Enter your email and we send you a one-time sign-in link."
      footer={
        <>
          <p>
            New here? <Link href="/signup" className="text-accent underline">Create an account</Link>
          </p>
          <p>rabbitsoftware.io</p>
        </>
      }
    >
      {note && <Notice tone="ok">{note}</Notice>}
      <form action={sendLink} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={authInput} />
        </div>
        {problem && <Notice tone="bad">{problem}</Notice>}
        <Turnstile />
        <button className={button}>Email me a sign-in link</button>
      </form>
    </AuthShell>
  )
}
