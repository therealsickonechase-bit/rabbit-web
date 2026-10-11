'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMember } from '@/lib/auth/session'
import { MAX_ACTIVE_KEYS, generateKey, hashKey } from '@/lib/mcp'

export type CreateState = { key?: string; name?: string; error?: string }

export async function createKey(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const user = await requireMember()
  const name = String(formData.get('name') ?? '').trim().slice(0, 60)
  if (!name) return { error: 'Give the key a name, for example "Claude Desktop".' }
  const scopes = formData.get('propose') ? ['read', 'propose'] : ['read']

  const admin = createAdminClient()
  const active = await admin.from('api_keys').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null).gt('expires_at', new Date().toISOString())
  if ((active.count ?? 0) >= MAX_ACTIVE_KEYS) return { error: `You can have ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` }

  const { key, prefix } = generateKey()
  const ins = await admin.from('api_keys').insert({ user_id: user.id, name, prefix, key_hash: await hashKey(key), scopes })
  if (ins.error) return { error: 'Could not create the key. Try again.' }
  revalidatePath('/keys')
  return { key, name }   // shown once; only its hash is stored
}

export async function revokeKey(formData: FormData) {
  const user = await requireMember()
  const id = String(formData.get('key') ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return
  await createAdminClient().from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).is('revoked_at', null)
  revalidatePath('/keys')
}
