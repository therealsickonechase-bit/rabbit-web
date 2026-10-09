// AES-GCM encryption for secrets stored in user_settings. The key comes from the
// KEY_ENCRYPTION_SECRET Worker secret (64 hex chars); the database only ever sees ciphertext.

function secretKey() {
  const hex = process.env.KEY_ENCRYPTION_SECRET ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('KEY_ENCRYPTION_SECRET is not configured')
  const raw = new Uint8Array(32)
  for (let i = 0; i < 32; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Returns "iv.ciphertext", both base64. A fresh random IV is used every time. */
export async function encryptSecret(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretKey(), new TextEncoder().encode(plain)))
  return `${b64(iv)}.${b64(ct)}`
}

export async function decryptSecret(stored: string) {
  const [iv, ct] = stored.split('.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await secretKey(), unb64(ct))
  return new TextDecoder().decode(plain)
}
