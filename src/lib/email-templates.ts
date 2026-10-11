// Auth emails sent through Cloudflare Email Service. Pure functions: no imports, easy to test.
// The link goes to OUR /auth/confirm page (not Supabase's verify URL), which asks the person to
// press a button. That stops mail scanners that open every link from using up the one-time token.

export type AuthEmailType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'reauthentication'

export interface AuthEmailInput {
  type: AuthEmailType
  appUrl: string // e.g. https://app.rabbitsoftware.io (no trailing slash)
  tokenHash: string
  token?: string // 6-digit code, used by reauthentication
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const COPY: Record<Exclude<AuthEmailType, 'reauthentication'>, { subject: string; lead: string; button: string; next: string }> = {
  signup: {
    subject: 'Confirm your RabbitOS account',
    lead: 'Thanks for creating a RabbitOS account. Confirm your email address to finish.',
    button: 'Confirm email address',
    next: '/',
  },
  invite: {
    subject: 'You have been invited to RabbitOS',
    lead: 'You have been invited to RabbitOS. Accept the invitation to set up your account.',
    button: 'Accept invitation',
    next: '/',
  },
  magiclink: {
    subject: 'Your RabbitOS sign-in link',
    lead: 'Use this link to sign in to RabbitOS.',
    button: 'Sign in',
    next: '/',
  },
  // RabbitOS has no passwords (sign-in is by emailed link) and the reset-password page was removed, so this link just signs the person in.
  recovery: {
    subject: 'Your RabbitOS sign-in link',
    lead: 'RabbitOS does not use passwords. Use this link to sign in to your account. If you did not ask for it, you can ignore this email.',
    button: 'Sign in',
    next: '/',
  },
  email_change: {
    subject: 'Confirm your new RabbitOS email address',
    lead: 'Confirm this change of email address for your RabbitOS account.',
    button: 'Confirm change',
    next: '/',
  },
}

export function renderAuthEmail(input: AuthEmailInput): RenderedEmail {
  const footer =
    'If you did not request this, you can ignore this email. Nothing will change. Questions? Reply to this email or write to contact@rabbitsoftware.io.'

  if (input.type === 'reauthentication') {
    const code = input.token ?? ''
    return {
      subject: 'Your RabbitOS verification code',
      text: `Your RabbitOS verification code is ${code}.\n\n${footer}`,
      html: layout('Your verification code', `<p style="font-size:28px;letter-spacing:6px;font-weight:700">${esc(code)}</p>`, footer),
    }
  }

  const c = COPY[input.type]
  const url =
    `${input.appUrl}/auth/confirm?token_hash=${encodeURIComponent(input.tokenHash)}` +
    `&type=${encodeURIComponent(input.type)}&next=${encodeURIComponent(c.next)}`

  return {
    subject: c.subject,
    text: `${c.lead}\n\n${c.button}: ${url}\n\n${footer}`,
    html: layout(
      c.subject,
      `<p>${esc(c.lead)}</p><p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#c75f43;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${esc(c.button)}</a></p>` +
        `<p style="font-size:13px;color:#666">Or paste this link into your browser:<br>${esc(url)}</p>`,
      footer
    ),
  }
}

function layout(title: string, body: string, footer: string) {
  return (
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,Segoe UI,sans-serif;color:#1d1d1d">` +
    `<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e3e3;border-radius:8px;padding:24px">` +
    `<p style="font-size:18px;font-weight:600;margin:0 0 16px"><span style="color:#c75f43">Rabbit</span>OS</p>` +
    `<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>${body}` +
    `<p style="font-size:12px;color:#888;margin-top:24px">${esc(footer)}</p></div></body></html>`
  )
}
