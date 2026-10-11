import TurnstileWidget from '@/components/TurnstileWidget'
import { usableCaptchaToken } from '@/lib/auth/captcha'

// Cloudflare Turnstile bot check. Local development without a site key keeps the ordinary submit button.
// The widget owns a hidden "cf-turnstile-response" field in the surrounding <form>, which the
// server action forwards to Supabase as the captcha token.
export default function Turnstile({ buttonClass }: { buttonClass: string }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY   // read on the server and passed down, so the browser never depends on build-time inlining
  if (!siteKey) return <button className={buttonClass}>Email me a sign-in link</button>
  return <TurnstileWidget siteKey={siteKey} buttonClass={buttonClass} />
}

/** The token Turnstile put into the submitted form, or undefined when there is none. */
export function captchaTokenFrom(formData: FormData) {
  const token = formData.get('cf-turnstile-response')
  return usableCaptchaToken(token) ? token : undefined
}
