import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AuthShell, Notice, authInput, button } from '@/components/AuthShell'
import Turnstile, { captchaTokenFrom } from '@/components/Turnstile'

async function signIn(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
    options: { captchaToken: captchaTokenFrom(formData) },
  })
  if (error) {
    const m = error.message.toLowerCase()
    redirect(`/login?error=${m.includes('captcha') ? 'captcha' : m.includes('confirm') ? 'unconfirmed' : '1'}`)
  }
  redirect('/')
}

const MESSAGES: Record<string, string> = {
  unconfirmed: 'Confirm your email address first, using the link we sent you.',
  confirm: 'That link is not valid or has already been used. Request a new one.',
  captcha: 'Please complete the check and try again.',
  reset: 'Your password was changed. Sign in with the new one.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { error, msg } = await searchParams
  const note = msg ? MESSAGES[msg] : undefined
  const problem = error ? (MESSAGES[error] ?? 'Invalid email or password.') : undefined

  return (
    <AuthShell
      title="Sign in to your account"
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
      <form action={signIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={authInput} />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium mb-1">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className={authInput} />
        </div>
        {problem && <Notice tone="bad">{problem}</Notice>}
        <Turnstile />
        <button className={button}>Log in</button>
        <p className="text-xs text-center">
          <Link href="/forgot-password" className="text-muted underline">Forgot your password?</Link>
        </p>
      </form>
    </AuthShell>
  )
}
