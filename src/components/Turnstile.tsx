import TurnstileWidget from '@/components/TurnstileWidget'

// Cloudflare Turnstile bot check. Renders nothing when no site key is configured (local development).
// The widget puts a hidden "cf-turnstile-response" field into the surrounding <form>, which the
// server action forwards to Supabase as the captcha token.
export default function Turnstile() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY   // read on the server and passed down, so the browser never depends on build-time inlining
  if (!siteKey) return null
  return <TurnstileWidget siteKey={siteKey} />
}

/** The token Turnstile put into the submitted form, or undefined when there is none. */
export function captchaTokenFrom(formData: FormData) {
  const token = String(formData.get('cf-turnstile-response') ?? '')
  return token || undefined
}
