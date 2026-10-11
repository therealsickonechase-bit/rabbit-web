import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthShell, Notice, button } from '@/components/AuthShell'
import { REASON_TEXT, evaluateRedemption, guestEmail, hashToken, tokenShape } from '@/lib/guest'

// Public page. The link only shows a button; the pass is used when the button is pressed, so link scanners that
// open emailed links in advance cannot use it up.
async function redeem(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  if (!tokenShape(token)) redirect('/guest?e=invalid')

  const admin = createAdminClient()
  const found = await admin.from('guest_passes').select('id, user_id, link_expires_at, first_used_at, access_until, uses, max_uses, revoked_at').eq('token_hash', await hashToken(token)).maybeSingle()
  if (!found.data || !found.data.user_id) redirect('/guest?e=invalid')
  const pass = found.data!
  const verdict = evaluateRedemption(pass)
  if (!verdict.ok) redirect(`/guest?e=${verdict.reason}`)
  const ok = verdict as Extract<typeof verdict, { ok: true }>

  // Count the use first and only proceed if nobody else took the last one (optimistic check on the old count).
  const bump = await admin.from('guest_passes').update({
    uses: pass.uses + 1,
    ...(ok.first ? { first_used_at: new Date().toISOString(), access_until: ok.accessUntil } : {}),
  }).eq('id', pass.id).eq('uses', pass.uses).select('id')
  if (bump.error || !bump.data?.length) redirect('/guest?e=too_many_uses')

  // Mark the account as a guest until the end of the pass (this is what the app checks on every request).
  const meta = await admin.auth.admin.updateUserById(pass.user_id!, { app_metadata: { guest: true, guest_until: ok.accessUntil } })
  if (meta.error) redirect('/guest?e=invalid')

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: guestEmail(pass.id) })
  const hashed = link.data?.properties?.hashed_token
  if (link.error || !hashed) redirect('/guest?e=invalid')
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: hashed!, type: 'magiclink' })
  if (error) redirect('/guest?e=invalid')
  redirect('/research')
}

export default async function GuestPage({ searchParams }: { searchParams: Promise<{ t?: string; e?: string; ended?: string }> }) {
  const { t, e, ended } = await searchParams
  const problem = ended ? 'Your guest pass has ended. Ask for a new one.' : e ? (REASON_TEXT[e] ?? REASON_TEXT.invalid) : undefined
  const valid = !!t && tokenShape(t)

  return (
    <AuthShell title="Guest pass" subtitle={valid ? 'You have been given a guest pass to RabbitOS: 3 days of read-only access, no password needed.' : undefined}
      footer={<p>Guests can browse Research and the CRISPR Explorer. Questions: contact@rabbitsoftware.io</p>}>
      {problem && <Notice tone="bad">{problem}</Notice>}
      {valid ? (
        <form action={redeem} className="space-y-3">
          <input type="hidden" name="token" value={t} />
          <button className={button}>Open guest pass</button>
          <p className="text-xs text-muted">The 3 days start when you press the button. Research and education only; nothing here is medical advice.</p>
        </form>
      ) : (
        !problem && <p className="text-sm text-muted">Open the guest link you were sent. If you have an account, <a className="text-accent underline" href="/login">sign in</a>.</p>
      )}
    </AuthShell>
  )
}
