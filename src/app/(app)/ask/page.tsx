import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMember } from '@/lib/auth/session'
import { decryptSecret } from '@/lib/secrets'
import { MODEL, summarize } from '@/lib/summarize'
import { askQwen, QwenError, QWEN_MODEL } from '@/lib/qwen'
import { ASK_DISCLAIMER, ASK_SYSTEM, buildAskPrompt, citedIds, keywords, orFilter, type AskRecord } from '@/lib/ask'
import { Badge, Card, PageHeader, ago } from '@/components/ui'
import AskQuestionInputs from '@/components/AskQuestionInputs'

const DAILY_QUESTION_LIMIT = 40
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NOTICE: Record<string, string> = {
  nokey: 'Add your Anthropic key in Settings first.',
  limit: `Daily question limit reached (${DAILY_QUESTION_LIMIT} per day). Try again tomorrow.`,
  empty: 'Type a question first.',
  failed: 'The answer could not be generated. Try again in a moment.',
  credits: 'Your Anthropic account has no credits. Add credits in the Anthropic console, then try again.',
  badkey: 'Anthropic rejected your saved key. Replace it in Settings.',
  ratelimit: 'Anthropic is rate limiting this key. Wait a minute and try again.',
  consent: 'Choose a provider and approve sending this message before asking.',
  qwenlimit: 'Hosted Qwen reached its usage limit. Try later; no other provider was contacted.',
  qweninput: 'Hosted Qwen rejected the prompt. Remove personal information and keep the question and context short.',
  qwenfailed: 'Hosted Qwen could not answer. Try later; no other provider was contacted.',
}

async function ask(formData: FormData) {
  'use server'
  const user = await requireMember()
  const question = String(formData.get('question') ?? '').trim().slice(0, 1000)
  const given = String(formData.get('thread') ?? '')
  const provider = formData.get('provider')
  const useQwen = provider === 'qwen'
  const back = (code: string, thread?: string): never => redirect(`/ask?${thread ? `t=${thread}&` : ''}provider=${useQwen ? 'qwen' : 'anthropic'}&msg=${code}`)
  if (!['qwen', 'anthropic'].includes(String(provider)) || formData.get('consent') !== 'on') back('consent', UUID.test(given) ? given : undefined)
  if (!question) back('empty', UUID.test(given) ? given : undefined)

  const admin = createAdminClient()
  const sb = await createClient()

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const recent = await admin.from('chat_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('role', 'user').gte('created_at', since)
  if ((recent.count ?? 0) >= DAILY_QUESTION_LIMIT) back('limit', UUID.test(given) ? given : undefined)

  const { data: settings } = await admin.from('user_settings').select('anthropic_key_enc').eq('user_id', user.id).maybeSingle()
  if (!useQwen && !settings?.anthropic_key_enc) back('nokey', UUID.test(given) ? given : undefined)

  // An existing thread must belong to this person; otherwise start a new one.
  let threadId: string | null = null
  if (UUID.test(given)) {
    const own = await admin.from('chat_threads').select('id').eq('id', given).eq('user_id', user.id).maybeSingle()
    threadId = own.data?.id ?? null
  }
  if (!threadId) {
    const made = await admin.from('chat_threads').insert({ user_id: user.id, title: question.slice(0, 120) }).select('id').single()
    if (made.error || !made.data) back('failed')
    threadId = made.data!.id
  }

  // Retrieve: records whose title matches a keyword, plus records under topics that match.
  const words = keywords(question)
  const found = new Map<string, AskRecord>()
  if (words.length) {
    const [byTitle, topics] = await Promise.all([
      sb.from('research_records').select('id, source, title, meta').or(orFilter('title', words)).order('first_seen_at', { ascending: false }).limit(20),
      sb.from('research_topics').select('id').or(`${orFilter('topic', words)},${orFilter('biomarker', words)}`).limit(10),
    ])
    for (const r of byTitle.data ?? []) found.set(r.id, r)
    const topicIds = (topics.data ?? []).map((t) => t.id)
    if (topicIds.length) {
      const byTopic = await sb.from('research_records').select('id, source, title, meta').in('topic_id', topicIds).order('first_seen_at', { ascending: false }).limit(20)
      for (const r of byTopic.data ?? []) found.set(r.id, r)
    }
  }
  const records = [...found.values()].slice(0, 25)

  const history = await admin.from('chat_messages').select('role, content').eq('thread_id', threadId!).order('created_at', { ascending: false }).limit(6)
  const prompt = buildAskPrompt(question, records, (history.data ?? []).reverse())

  let outcome = 'failed'
  try {
    const answer = useQwen
      ? await askQwen(prompt, ASK_SYSTEM, 700)
      : await summarize(await decryptSecret(settings!.anthropic_key_enc), prompt, ASK_SYSTEM, 700)
    const cited = citedIds(answer, records.map((r) => r.id))
    const saved = await admin.from('chat_messages').insert([
      { thread_id: threadId, user_id: user.id, role: 'user', content: question },
      { thread_id: threadId, user_id: user.id, role: 'assistant', content: answer, cited, model: useQwen ? QWEN_MODEL : MODEL },
    ])
    if (saved.error) throw saved.error
    outcome = ''
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown'
    console.error('ask failed', detail.slice(0, 300))
    if (useQwen) outcome = e instanceof QwenError && e.status === 429 ? 'qwenlimit' : e instanceof QwenError && e.status === 400 ? 'qweninput' : 'qwenfailed'
    else if (/credit balance/i.test(detail)) outcome = 'credits'
    else if (/Anthropic API 40[13]/.test(detail)) outcome = 'badkey'
    else if (/Anthropic API 429/.test(detail)) outcome = 'ratelimit'
  }
  redirect(`/ask?t=${threadId}&provider=${useQwen ? 'qwen' : 'anthropic'}${outcome ? `&msg=${outcome}` : ''}`)
}

async function deleteThread(formData: FormData) {
  'use server'
  const user = await requireMember()
  const id = String(formData.get('thread') ?? '')
  if (UUID.test(id)) await createAdminClient().from('chat_threads').delete().eq('id', id).eq('user_id', user.id)
  redirect('/ask')
}

export default async function AskPage({ searchParams }: { searchParams: Promise<{ t?: string; msg?: string; provider?: string }> }) {
  const { t, msg, provider } = await searchParams
  await requireMember()
  const sb = await createClient()

  const threads = await sb.from('chat_threads').select('id, title, created_at').order('created_at', { ascending: false }).limit(30)
  const active = t && UUID.test(t) ? t : null
  const messages = active
    ? await sb.from('chat_messages').select('id, role, content, cited, created_at, model').eq('thread_id', active).order('created_at')
    : null

  const citedAll = [...new Set((messages?.data ?? []).flatMap((m) => m.cited ?? []))]
  const cites = citedAll.length ? await sb.from('research_records').select('id, source, title, url').in('id', citedAll) : null
  const byId = new Map((cites?.data ?? []).map((r) => [r.id, r]))

  return (
    <>
      <PageHeader title="Ask RabbitOS" sub="Questions answered only from the research records stored here, with sources" />
      <div className="grid lg:grid-cols-[240px_1fr] gap-6">
        <Card title="Conversations" flush>
          <nav className="text-sm" aria-label="Conversations">
            <Link href="/ask" className="block px-4 py-2 text-accent hover:bg-canvas border-b border-line">+ New question</Link>
            {(threads.data ?? []).map((th) => (
              <Link key={th.id} href={`/ask?t=${th.id}`} aria-current={th.id === active ? 'true' : undefined}
                className={`block px-4 py-2 border-b border-line last:border-0 hover:bg-canvas ${th.id === active ? 'bg-accent-soft' : ''}`}>
                <span className="block truncate">{th.title}</span>
                <span className="text-xs text-muted">{ago(th.created_at)}</span>
              </Link>
            ))}
          </nav>
        </Card>

        <div className="space-y-4 min-w-0">
          {msg && NOTICE[msg] && (
            <p role="status" className="text-sm rounded-md border border-bad/40 text-bad px-3 py-2">
              {NOTICE[msg]} {msg === 'nokey' && <Link href="/settings" className="underline">Open Settings</Link>}
            </p>
          )}

          {(messages?.data ?? []).map((m) => (
            <Card key={m.id}>
              <div className="flex items-center gap-2 mb-2">
                <Badge tone={m.role === 'user' ? 'info' : 'warn'}>{m.role === 'user' ? 'You' : 'AI answer'}</Badge>
                <span className="text-xs text-muted">{ago(m.created_at)}</span>
                {m.role === 'assistant' && m.model && <span className="text-xs text-muted">{m.model}</span>}
              </div>
              <p className="text-sm whitespace-pre-line">{m.content}</p>
              {m.role === 'assistant' && (
                <>
                  {(m.cited ?? []).length > 0 && (
                    <ul className="mt-3 pt-3 border-t border-line text-xs space-y-1">
                      {(m.cited as string[]).map((id) => {
                        const r = byId.get(id)
                        return (
                          <li key={id}>
                            <span className="font-mono text-muted">[{id}]</span>{' '}
                            {r?.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{r.title}</a> : (r?.title ?? 'record no longer available')}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="text-xs text-muted mt-2">{ASK_DISCLAIMER}</p>
                </>
              )}
            </Card>
          ))}

          <Card>
            <form action={ask} className="space-y-3">
              <input type="hidden" name="thread" value={active ?? ''} />
              <AskQuestionInputs key={`${active ?? 'new'}-${provider ?? 'anthropic'}`} provider={provider === 'qwen' ? 'qwen' : 'anthropic'} followUp={Boolean(active)} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted">Claude uses your key from Settings; Qwen runs on Cloudflare, not local Ollama. {DAILY_QUESTION_LIMIT} questions per day plus hosted gateway limits.</p>
                <button className="rounded-md bg-accent text-white text-sm font-medium px-4 py-2 hover:opacity-90">Ask</button>
              </div>
            </form>
            {active && (
              <form action={deleteThread} className="mt-3">
                <input type="hidden" name="thread" value={active} />
                <button className="text-xs text-muted underline hover:text-bad">Delete this conversation</button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
