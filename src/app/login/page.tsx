import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function signIn(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  })
  if (error) redirect('/login?error=1')
  redirect('/')
}

const input =
  'w-full rounded-md bg-canvas border border-line px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main className="min-h-screen bg-canvas text-fg flex flex-col items-center justify-center p-4">
      <p className="text-2xl font-semibold tracking-tight mb-1">
        <span className="text-accent">Rabbit</span>OS
      </p>
      <p className="text-sm text-muted mb-6">Sign in to your account</p>

      <form action={signIn} className="w-full max-w-sm bg-surface border border-line rounded-lg p-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className={input} />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium mb-1">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className={input} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-bad border border-bad/40 rounded-md px-3 py-2">
            {error === 'unconfirmed' ? 'Confirm your email address first, using the link we sent you.' : 'Invalid email or password.'}
          </p>
        )}
        <button className="w-full rounded-md bg-accent text-white font-medium py-2 text-sm hover:opacity-90">
          Log in
        </button>
      </form>

      <p className="text-xs text-muted mt-6">rabbitsoftware.io</p>
    </main>
  )
}
