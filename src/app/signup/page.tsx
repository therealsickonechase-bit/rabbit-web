import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { appUrl } from '@/lib/mail'
import { EMAIL_SHAPE, MIN_PASSWORD, passwordProblem } from '@/lib/auth/password'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'
import Turnstile, { captchaTokenFrom } from '@/components/Turnstile'

async function signUp(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (!EMAIL_SHAPE.test(email)) redirect('/signup?error=email')
  const problem = passwordProblem(password, confirm)
  if (problem) redirect(`/signup?error=${problem}`)
  if (formData.get('agree') !== 'on') redirect('/signup?error=agree')

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { captchaToken: captchaTokenFrom(formData), emailRedirectTo: `${appUrl()}/auth/confirm` },
  })

  if (error) {
    // Log the reason without the address. Supabase answers an already-registered address with the
    // same success as a new one, so this form cannot be used to find out who has an account.
    console.error('sign-up failed', error.status, error.code)
    const m = error.message.toLowerCase()
    const code = m.includes('captcha') ? 'captcha' : m.includes('not allowed') || m.includes('disabled') ? 'closed' : error.status === 429 ? 'rate' : 'failed'
    redirect(`/signup?error=${code}`)
  }
  redirect('/signup?sent=1')
}

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  weak: `Use at least ${MIN_PASSWORD} characters for your password.`,
  long: 'That password is too long (72 bytes at most).',
  mismatch: 'The two passwords do not match.',
  agree: 'Please confirm that you have read the privacy policy.',
  captcha: 'Please complete the check and try again.',
  closed: 'Sign-up is not open yet.',
  rate: 'Too many attempts. Please wait a few minutes and try again.',
  failed: 'We could not create the account. Please try again.',
}

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link href="/login" className="text-accent underline">Back to sign in</Link>}>
        <Notice tone="ok">
          If that address can be registered, we have sent a link to confirm it. The link works once. It can take a few minutes to arrive, so look in your spam folder too.
        </Notice>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Members can read the public research library and run summaries with their own Anthropic key."
      footer={
        <p>
          Already have an account? <Link href="/login" className="text-accent underline">Sign in</Link>
        </p>
      }
    >
      <form action={signUp} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium mb-1">Your email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={authInput} />
          <p className="text-xs text-muted mt-1">We send one confirmation link to this address. Use an address you can open now.</p>
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium mb-1">Password (at least {MIN_PASSWORD} characters)</label>
          <input id="password" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={authInput} />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-xs font-medium mb-1">Repeat password</label>
          <input id="confirm" name="confirm" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={authInput} />
        </div>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" name="agree" required className="mt-0.5" />
          <span>
            I have read the{' '}
            <a href="https://rabbitsoftware.io/privacy.html" className="text-accent underline" target="_blank" rel="noopener noreferrer">privacy policy</a>.
          </span>
        </label>
        {error && <Notice tone="bad">{ERRORS[error] ?? ERRORS.failed}</Notice>}
        <Turnstile />
        <button className={button}>Create account</button>
      </form>
    </AuthShell>
  )
}
