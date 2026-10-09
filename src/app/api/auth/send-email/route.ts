import { verifyStandardWebhook } from '@/lib/webhook'
import { renderAuthEmail, type AuthEmailType } from '@/lib/email-templates'
import { appUrl, sendMail } from '@/lib/mail'

// Supabase Auth "Send Email" hook. Supabase calls this instead of using its own mailer, signed with
// the hook secret (Standard Webhooks). We turn the call into an email sent through Cloudflare.

const TYPES = new Set<string>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'reauthentication'])

interface HookPayload {
  user?: { email?: string; new_email?: string }
  email_data?: {
    token?: string
    token_hash?: string
    token_new?: string
    token_hash_new?: string
    email_action_type?: string
  }
}

const failure = (status: number, message: string) =>
  Response.json({ error: { http_code: status, message } }, { status })

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET
  if (!secret) return failure(500, 'send-email hook is not configured')

  const body = await request.text()
  const ok = await verifyStandardWebhook(
    secret,
    {
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    },
    body
  )
  if (!ok) return failure(401, 'bad signature')

  let payload: HookPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return failure(400, 'invalid json')
  }

  const type = payload.email_data?.email_action_type
  const email = payload.user?.email
  if (!type || !TYPES.has(type) || !email) return failure(400, 'unsupported email type')

  try {
    const base = { appUrl: appUrl(), type: type as AuthEmailType }
    const data = payload.email_data!

    if (type === 'email_change' && data.token_hash_new && payload.user?.new_email) {
      // Secure email change: one confirmation goes to each address.
      await sendMail({ to: email, ...renderAuthEmail({ ...base, tokenHash: data.token_hash_new }) })
      await sendMail({ to: payload.user.new_email, ...renderAuthEmail({ ...base, tokenHash: data.token_hash ?? '' }) })
    } else {
      const to = type === 'email_change' && payload.user?.new_email ? payload.user.new_email : email
      await sendMail({ to, ...renderAuthEmail({ ...base, tokenHash: data.token_hash ?? '', token: data.token }) })
    }
  } catch (e) {
    // Log the reason, never the address or token. A failure here makes Supabase report the sign-up as failed.
    console.error('send-email hook failed', e instanceof Error ? e.message : 'unknown')
    return failure(502, 'could not send email')
  }

  return Response.json({})
}
