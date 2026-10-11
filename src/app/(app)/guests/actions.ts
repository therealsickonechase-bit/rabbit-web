'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import { appUrl } from '@/lib/mail'
import { MAX_ACTIVE_PASSES, generateToken, guestEmail, hashToken } from '@/lib/guest'

export type PassState = { link?: string; label?: string; error?: string }

export async function createPass(_prev: PassState, formData: FormData): Promise<PassState> {
  const owner = await requireOwner()
  const label = String(formData.get('label') ?? '').trim().slice(0, 60)
  const issuedTo = String(formData.get('issued_to') ?? '').trim().slice(0, 120) || null
  if (!label) return { error: 'Give the pass a label, for example "Dr Lee demo".' }

  const admin = createAdminClient()
  const active = await admin.from('guest_passes').select('id', { count: 'exact', head: true }).is('revoked_at', null).not('user_id', 'is', null)
  if ((active.count ?? 0) >= MAX_ACTIVE_PASSES) return { error: `You already have ${MAX_ACTIVE_PASSES} active passes. Revoke some first.` }

  const id = crypto.randomUUID()
  const user = await admin.auth.admin.createUser({ email: guestEmail(id), email_confirm: true, app_metadata: { guest: true } })
  if (user.error || !user.data.user) return { error: 'Could not create the guest account.' }

  const token = generateToken()
  const ins = await admin.from('guest_passes').insert({ id, label, issued_to: issuedTo, user_id: user.data.user.id, token_hash: await hashToken(token), created_by: owner.id })
  if (ins.error) {
    await admin.auth.admin.deleteUser(user.data.user.id)
    return { error: 'Could not create the pass.' }
  }
  revalidatePath('/guests')
  return { link: `${appUrl()}/guest?t=${token}`, label }   // shown once; only a hash is stored
}

export async function revokePass(formData: FormData) {
  await requireOwner()
  const id = String(formData.get('pass') ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return
  const admin = createAdminClient()
  const p = await admin.from('guest_passes').select('user_id').eq('id', id).maybeSingle()
  await admin.from('guest_passes').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null)
  if (p.data?.user_id) await admin.auth.admin.deleteUser(p.data.user_id)     // ends every session of that guest
  revalidatePath('/guests')
}

/** Delete the accounts of passes whose 3 days are over (their rows stay as history). */
export async function sweepEnded() {
  await requireOwner()
  const admin = createAdminClient()
  const ended = await admin.from('guest_passes').select('user_id').lt('access_until', new Date().toISOString()).not('user_id', 'is', null)
  for (const p of ended.data ?? []) await admin.auth.admin.deleteUser(p.user_id!)
  const stale = await admin.from('guest_passes').select('id, user_id').is('first_used_at', null).lt('link_expires_at', new Date().toISOString()).not('user_id', 'is', null)
  for (const p of stale.data ?? []) await admin.auth.admin.deleteUser(p.user_id!)
  revalidatePath('/guests')
}
