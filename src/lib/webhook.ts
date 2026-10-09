// Verifies a Standard Webhooks signature, the scheme Supabase uses to sign Auth hook calls.
//   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
//   key            = the base64 part of the hook secret ("v1,whsec_<base64>")
//   header         = space-separated "v1,<base64 HMAC-SHA256>" entries; any one valid entry is enough.

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function hookKeyBytes(secret: string) {
  const raw = secret.includes('whsec_') ? secret.slice(secret.indexOf('whsec_') + 'whsec_'.length) : secret
  return b64ToBytes(raw.trim())
}

export async function verifyStandardWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  toleranceSeconds = 300,
  nowMs = Date.now()
) {
  if (!headers.id || !headers.timestamp || !headers.signature) return false

  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('raw', hookKeyBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  } catch {
    return false
  }

  const signed = new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${body}`)
  for (const part of headers.signature.split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    try {
      if (await crypto.subtle.verify('HMAC', key, b64ToBytes(sig), signed)) return true
    } catch {
      // malformed entry: ignore it and try the next one
    }
  }
  return false
}
