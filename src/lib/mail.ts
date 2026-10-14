import { runtimeEnv } from '@/lib/runtime-env'

// Sender must be on a domain onboarded to Cloudflare Email Sending (mail.rabbitsoftware.io).
// The EMAIL binding is also restricted to this address in cloudflare.config.ts.
export const MAIL_FROM = { email: 'accounts@mail.rabbitsoftware.io', name: 'RabbitOS' }

// The sender address cannot receive mail, so replies go to contact@, which Email Routing forwards to the owner.
export const MAIL_REPLY_TO = { email: 'contact@rabbitsoftware.io', name: 'RabbitOS' }

interface MailBinding {
  send(message: {
    to: string
    from: { email: string; name: string }
    replyTo: { email: string; name: string }
    subject: string
    text: string
    html: string
  }): Promise<unknown>
}

export async function sendMail(message: { to: string; subject: string; text: string; html: string }) {
  // Cloudflare Email Sending is a Workers binding; off Workers there is no mailer until one is wired in.
  const mailer = (await runtimeEnv()).EMAIL as MailBinding | undefined
  if (!mailer) throw new Error('email binding is not configured')
  await mailer.send({ to: message.to, from: MAIL_FROM, replyTo: MAIL_REPLY_TO, subject: message.subject, text: message.text, html: message.html })
}

/** The public address of this app, without a trailing slash (changes if the app moves under /console). */
export function appUrl() {
  return (process.env.APP_URL ?? 'https://app.rabbitsoftware.io').replace(/\/+$/, '')
}
