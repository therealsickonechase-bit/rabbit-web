import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { appUrl } from '@/lib/mail'
import { EMAIL_SHAPE } from '@/lib/auth/email'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'
import Turnstile, { captchaTokenFrom } from '@/components/Turnstile'

async function signUp(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()

  if (!EMAIL_SHAPE.test(email)) redirect('/signup?error=email')
  if (formData.get('agree') !== 'on') redirect('/signup?error=agree')

  // Passwordless: the emailed link creates the account. The contact record is stored when the link is
  // confirmed (see /auth/confirm), because the new account's id does not exist until then.
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, captchaToken: captchaTokenFrom(formData), emailRedirectTo: `${appUrl()}/auth/confirm` },
  })

  if (error) {
    // Log the reason without the address. A known address gets the same success page as a new one,
    // so this form cannot be used to find out who has an account.
    console.error('sign-up failed', error.status, error.code)
    const m = error.message.toLowerCase()
    const code = m.includes('captcha') ? 'captcha' : m.includes('not allowed') || m.includes('disabled') ? 'closed' : error.status === 429 ? 'rate' : 'failed'
    redirect(`/signup?error=${code}`)
  }
  redirect('/signup?sent=1')
}

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  agree: 'Please confirm that you have read the privacy policy and the contact record notice.',
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
          If that address can be registered, we have sent a link to finish creating the account and sign in. The link works once. It can take a few minutes to arrive, so look in your spam folder too.
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
          <p className="text-xs text-muted mt-1">We send one sign-in link to this address. No password needed. Use an address you can open now.</p>
        </div>
        <div className="rounded-md border border-line bg-canvas p-3 text-xs text-muted space-y-1">
          <p className="font-medium text-fg">Contact record</p>
          <p>
            We keep an encrypted copy of your email address. It is kept only so we can respond to a valid legal request,
            for example a court order about illegal activity, and for no other purpose. Only the site owner holds the key
            that opens it, and every time one is opened it is logged.
          </p>
        </div>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" name="agree" required className="mt-0.5" />
          <span>
            I have read the{' '}
            <a href="https://rabbitsoftware.io/privacy.html" className="text-accent underline" target="_blank" rel="noopener noreferrer">privacy policy</a>{' '}
            and the contact record notice above.
          </span>
        </label>
        {error && <Notice tone="bad">{ERRORS[error] ?? ERRORS.failed}</Notice>}
        <Turnstile />
        <button className={button}>Create account</button>
      </form>
    </AuthShell>
  )
}
