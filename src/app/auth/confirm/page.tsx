import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { recordContact } from '@/lib/contact-record'
import { AuthShell, button } from '@/components/AuthShell'

// Landing page for the link in our auth emails. It shows a button instead of consuming the token on
// load, so mail scanners that open every link cannot use up a one-time token.

const TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change'] as const
type ConfirmType = (typeof TYPES)[number]

const NEXT_ALLOWED = new Set(['/', '/research'])
const safeNext = (value: string) => (NEXT_ALLOWED.has(value) ? value : '/')

async function confirm(formData: FormData) {
  'use server'
  const tokenHash = String(formData.get('token_hash') ?? '')
  const type = String(formData.get('type') ?? '') as ConfirmType
  const next = safeNext(String(formData.get('next') ?? '/'))
  if (!tokenHash || !TYPES.includes(type)) redirect('/login?error=confirm')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) redirect('/login?error=confirm')

  // An account never stays without its encrypted contact record. The write is an upsert, so doing it on
  // every sign-in is harmless and also repairs a record that failed to store the first time.
  if (data.user?.id && data.user.email) {
    try {
      await recordContact(data.user.id, data.user.email)
    } catch (e) {
      console.error('contact record failed', e instanceof Error ? e.message : 'unknown')
      await supabase.auth.signOut()
      redirect('/login?error=failed')
    }
  }
  redirect(next)
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>
}) {
  const { token_hash, type, next } = await searchParams
  const valid = !!token_hash && TYPES.includes(type as ConfirmType)

  if (!valid) {
    return (
      <AuthShell title="Link not valid" subtitle="This link is missing information or has already been used.">
        <a href="/login" className="text-sm text-accent underline">Back to sign in</a>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Sign in to RabbitOS" subtitle="Press the button to finish and sign in.">
      <form action={confirm}>
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next ?? '/'} />
        <button className={button}>Confirm and sign in</button>
      </form>
    </AuthShell>
  )
}
