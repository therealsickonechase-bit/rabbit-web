// Encrypted contact records: the cryptography, with no imports so it runs in the Worker, in Node tests
// and in the owner's lookup script unchanged.
//
//   encrypt (in the app):   a fresh AES-256-GCM key encrypts the address; that key is wrapped with the owner's
//                           PUBLIC RSA key (RSA-OAEP, SHA-256). The app holds only the public key.
//   decrypt (offline):      the owner unwraps with the PRIVATE key. The app cannot do this.
//   find a record:          emailHash() = HMAC-SHA256(normalised address, server hash key). Deterministic, so a
//                           record can be located from an address named in a legal request, but it reveals nothing
//                           without the hash key.

export interface SealedContact {
  v: 1
  alg: 'RSA-OAEP-256+A256GCM'
  k: string // AES key, wrapped with the owner's public key (base64)
  iv: string
  ct: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const toB64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function emailHash(email: string, hashKeyB64: string) {
  const key = await crypto.subtle.importKey('raw', fromB64(hashKeyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(normalizeEmail(email)))
  return toB64(sig)
}

/** publicKeySpkiB64 is the owner's RSA public key in SPKI DER form, base64. */
export async function sealContact(email: string, publicKeySpkiB64: string): Promise<SealedContact> {
  const pub = await crypto.subtle.importKey('spki', fromB64(publicKeySpkiB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(normalizeEmail(email)))
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, await crypto.subtle.exportKey('raw', aes))
  return { v: 1, alg: 'RSA-OAEP-256+A256GCM', k: toB64(wrapped), iv: toB64(iv), ct: toB64(ct) }
}

/** privateKeyPkcs8B64 is the owner's RSA private key in PKCS#8 DER form, base64. Used only offline. */
export async function openContact(sealed: SealedContact, privateKeyPkcs8B64: string) {
  if (sealed.v !== 1 || sealed.alg !== 'RSA-OAEP-256+A256GCM') throw new Error('unsupported contact record format')
  const priv = await crypto.subtle.importKey('pkcs8', fromB64(privateKeyPkcs8B64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, fromB64(sealed.k))
  const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, aes, fromB64(sealed.ct))
  return dec.decode(plain)
}

/** A new owner key pair plus a hash key. Run by scripts/contact-keys.mjs on the owner's own machine. */
export async function generateContactKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  )
  return {
    publicKeySpkiB64: toB64(await crypto.subtle.exportKey('spki', pair.publicKey)),
    privateKeyPkcs8B64: toB64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    hashKeyB64: toB64(crypto.getRandomValues(new Uint8Array(32))),
  }
}
