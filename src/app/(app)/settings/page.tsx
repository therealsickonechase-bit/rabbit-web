import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptSecret } from '@/lib/secrets'
import { keyIsValid } from '@/lib/summarize'
import { Badge, Card, PageHeader } from '@/components/ui'

async function currentUser() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')
  return user
}

async function saveKey(formData: FormData) {
  'use server'
  const user = await currentUser()
  const key = String(formData.get('key') ?? '').trim()
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) redirect('/settings?msg=format')

  let outcome: 'ok' | 'invalid' | 'unreachable' | 'config' = 'ok'
  try {
    const valid = await keyIsValid(key)
    if (valid === false) outcome = 'invalid'
    else if (valid === null) outcome = 'unreachable'
    else {
      const enc = await encryptSecret(key)
      const { error } = await createAdminClient().from('user_settings').upsert({
        user_id: user.id,
        anthropic_key_enc: enc,
        anthropic_key_last4: key.slice(-4),
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
    }
  } catch (e) {
    console.error('saveKey failed', e instanceof Error ? e.message : 'unknown')
    outcome = 'config'
  }
  redirect(`/settings?msg=${outcome === 'ok' ? 'saved' : outcome}`)
}

async function removeKey() {
  'use server'
  const user = await currentUser()
  await createAdminClient().from('user_settings').delete().eq('user_id', user.id)
  redirect('/settings?msg=removed')
}

const MESSAGES: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  saved: { tone: 'ok', text: 'Key verified and saved.' },
  removed: { tone: 'ok', text: 'Key removed.' },
  format: { tone: 'bad', text: 'That does not look like an Anthropic key (it should start with sk-ant-).' },
  invalid: { tone: 'bad', text: 'Anthropic rejected that key. Check it and try again.' },
  unreachable: { tone: 'bad', text: 'Could not reach Anthropic to verify the key. Try again in a moment.' },
  config: { tone: 'bad', text: 'Could not save the key. The server is missing its encryption setup.' },
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams
  const user = await currentUser()
  const { data } = await createAdminClient()
    .from('user_settings')
    .select('anthropic_key_last4')
    .eq('user_id', user.id)
    .maybeSingle()
  const note = msg ? MESSAGES[msg] : undefined
  const input =
    'w-full rounded-md bg-canvas border border-line px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

  return (
    <>
      <PageHeader title="Settings" sub="Your account and connected services" />
      <div className="space-y-6 max-w-2xl">
        {note && (
          <p role="status" className={`text-sm rounded-md border px-3 py-2 ${note.tone === 'ok' ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>
            {note.text}
          </p>
        )}

        <Card title="Anthropic API key">
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              Used by the <strong className="text-fg">Summarize</strong> button on the Research page. Each click sends the
              records already stored for that topic to Claude and saves the answer, clearly labelled as an AI interpretation.
              Each summary is one billed request on your Anthropic account. The key is verified, then encrypted before it
              is stored, and it is never shown again or sent to your browser.
            </p>

            <div className="flex items-center gap-3">
              <span className="text-muted">Status</span>
              {data?.anthropic_key_last4 ? (
                <>
                  <Badge tone="ok">Connected</Badge>
                  <span className="font-mono text-xs">sk-ant-…{data.anthropic_key_last4}</span>
                </>
              ) : (
                <Badge tone="muted">No key saved</Badge>
              )}
            </div>

            <form action={saveKey} className="space-y-3">
              <label htmlFor="key" className="block text-xs font-medium">
                {data?.anthropic_key_last4 ? 'Replace key' : 'Paste your key'}
              </label>
              <input id="key" name="key" type="password" required autoComplete="off" spellCheck={false} placeholder="sk-ant-…" className={input} />
              <button className="rounded-md bg-accent text-white font-medium px-4 py-2 text-sm hover:opacity-90">
                Verify and save
              </button>
            </form>

            {data?.anthropic_key_last4 && (
              <form action={removeKey}>
                <button className="rounded-md border border-line px-4 py-2 text-sm hover:bg-canvas">Remove key</button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
