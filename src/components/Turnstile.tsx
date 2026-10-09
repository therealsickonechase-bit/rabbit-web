// Cloudflare Turnstile bot check. Renders nothing when no site key is configured (local development).
// The script puts a hidden "cf-turnstile-response" field into the surrounding <form>, which the
// server action forwards to Supabase as the captcha token.
export default function Turnstile() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  if (!siteKey) return null
  return (
    <>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" />
    </>
  )
}

/** The token Turnstile put into the submitted form, or undefined when there is none. */
export function captchaTokenFrom(formData: FormData) {
  const token = String(formData.get('cf-turnstile-response') ?? '')
  return token || undefined
}
