import { createAdminClient } from '@/lib/supabase/admin'
import { emailHash, sealContact } from '@/lib/contact-crypto'

/**
 * Stores the encrypted contact record for a new account. The address is sealed to the owner's PUBLIC key
 * (CONTACT_PUBLIC_KEY); this server never holds the private key, so it cannot read the record back.
 * Throws if the keys are not configured or the write fails, so the caller can refuse to keep an account
 * that has no contact record.
 */
export async function recordContact(userId: string, email: string) {
  const publicKey = process.env.CONTACT_PUBLIC_KEY
  const hashKey = process.env.CONTACT_HASH_KEY
  if (!publicKey || !hashKey) throw new Error('contact record keys are not configured')

  const sealed = await sealContact(email, publicKey)
  const { error } = await createAdminClient()
    .from('contact_records')
    .upsert(
      { user_id: userId, email_hash: await emailHash(email, hashKey), email_enc: JSON.stringify(sealed) },
      { onConflict: 'user_id' }
    )
  if (error) throw new Error(`contact record write failed: ${error.code ?? error.message}`)
}
