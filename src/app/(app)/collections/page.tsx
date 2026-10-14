import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMember, viewerClient } from '@/lib/auth/session'
import { Badge, Card, PageHeader, ago } from '@/components/ui'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The collection id if it exists and belongs to this person, else null. */
async function ownCollection(userId: string, id: string) {
  if (!UUID.test(id)) return null
  const { data } = await createAdminClient().from('collections').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  return data?.id ?? null
}

async function createCollection(formData: FormData) {
  'use server'
  const user = await requireMember()
  const name = String(formData.get('name') ?? '').trim().slice(0, 80)
  if (!name) redirect('/collections')
  const admin = createAdminClient()
  const count = await admin.from('collections').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  if ((count.count ?? 0) >= 50) redirect('/collections?msg=toomany')
  const made = await admin.from('collections').insert({ user_id: user.id, name }).select('id').single()
  if (made.error) redirect('/collections?msg=exists')
  redirect(`/collections?c=${made.data.id}`)
}

async function deleteCollection(formData: FormData) {
  'use server'
  const user = await requireMember()
  const id = await ownCollection(user.id, String(formData.get('collection') ?? ''))
  if (id) await createAdminClient().from('collections').delete().eq('id', id)
  redirect('/collections')
}

async function removeItem(formData: FormData) {
  'use server'
  const user = await requireMember()
  const id = await ownCollection(user.id, String(formData.get('collection') ?? ''))
  const record = String(formData.get('record') ?? '')
  if (id) await createAdminClient().from('collection_items').delete().eq('collection_id', id).eq('record_id', record)
  redirect(`/collections?c=${id ?? ''}`)
}

async function addNote(formData: FormData) {
  'use server'
  const user = await requireMember()
  const id = await ownCollection(user.id, String(formData.get('collection') ?? ''))
  const body = String(formData.get('body') ?? '').trim().slice(0, 5000)
  const record = String(formData.get('record') ?? '') || null
  if (id && body) {
    await createAdminClient().from('notes').insert({ user_id: user.id, collection_id: record ? null : id, record_id: record, body })
  }
  redirect(`/collections?c=${id ?? ''}`)
}

async function deleteNote(formData: FormData) {
  'use server'
  const user = await requireMember()
  const note = String(formData.get('note') ?? '')
  if (UUID.test(note)) await createAdminClient().from('notes').delete().eq('id', note).eq('user_id', user.id)
  redirect(`/collections?c=${String(formData.get('collection') ?? '')}`)
}

const NOTICE: Record<string, string> = {
  exists: 'You already have a collection with that name.',
  toomany: 'You can have up to 50 collections.',
}

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ c?: string; msg?: string }> }) {
  const { c, msg } = await searchParams
  await requireMember()
  const sb = await viewerClient()

  const [cols, items] = await Promise.all([
    sb.from('collections').select('id, name, created_at').order('created_at', { ascending: false }),
    sb.from('collection_items').select('collection_id'),
  ])
  const counts = new Map<string, number>()
  for (const i of items.data ?? []) counts.set(i.collection_id, (counts.get(i.collection_id) ?? 0) + 1)

  const active = (cols.data ?? []).find((x) => x.id === c) ?? null
  const [members, notes] = active
    ? await Promise.all([
        sb.from('collection_items').select('record_id, added_at, research_records(id, source, title, url)').eq('collection_id', active.id).order('added_at', { ascending: false }),
        sb.from('notes').select('id, body, record_id, collection_id, created_at').eq('collection_id', active.id).order('created_at', { ascending: false }),
      ])
    : [null, null]
  const recordIds = (members?.data ?? []).map((m) => m.record_id)
  const recordNotes = active && recordIds.length ? await sb.from('notes').select('id, body, record_id, created_at').in('record_id', recordIds).order('created_at', { ascending: false }) : null
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v)

  return (
    <>
      <PageHeader title="Collections" sub="Save research records, group them, and keep private notes" />
      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        <div className="space-y-4">
          <Card title="Your collections" flush>
            <nav aria-label="Collections" className="text-sm">
              {(cols.data ?? []).length === 0 && <p className="p-4 text-muted">None yet.</p>}
              {(cols.data ?? []).map((col) => (
                <Link key={col.id} href={`/collections?c=${col.id}`} aria-current={col.id === active?.id ? 'true' : undefined}
                  className={`flex items-center justify-between px-4 py-2 border-b border-line last:border-0 hover:bg-canvas ${col.id === active?.id ? 'bg-accent-soft' : ''}`}>
                  <span className="truncate">{col.name}</span>
                  <span className="text-xs text-muted">{counts.get(col.id) ?? 0}</span>
                </Link>
              ))}
            </nav>
          </Card>
          <Card>
            <form action={createCollection} className="space-y-2">
              <label htmlFor="name" className="block text-xs font-medium">New collection</label>
              <input id="name" name="name" required maxLength={80} placeholder="e.g. BRCA1 reading list"
                className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
              <button className="rounded-md border border-line text-sm px-3 py-1.5 hover:border-accent hover:text-accent">Create</button>
            </form>
          </Card>
          {msg && NOTICE[msg] && <p role="status" className="text-sm text-bad">{NOTICE[msg]}</p>}
        </div>

        <div className="space-y-4 min-w-0">
          {!active ? (
            <Card><p className="text-sm text-muted">Pick a collection, or create one. Use <strong>Save</strong> on the Research page to add records to it.</p></Card>
          ) : (
            <>
              <Card title={active.name} action={
                <form action={deleteCollection}>
                  <input type="hidden" name="collection" value={active.id} />
                  <button className="text-xs text-muted underline hover:text-bad">Delete collection</button>
                </form>
              }>
                {(members?.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted">Empty. Save records from the Research page.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {(members?.data ?? []).map((m) => {
                      const r = one(m.research_records)
                      const mine = (recordNotes?.data ?? []).filter((n) => n.record_id === m.record_id)
                      return (
                        <li key={m.record_id} className="py-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Badge tone="accent">{r?.source ?? 'record'}</Badge>{' '}
                              {r?.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline text-sm">{r.title}</a> : <span className="text-sm">{r?.title ?? m.record_id}</span>}
                              <p className="text-xs text-muted mt-0.5">saved {ago(m.added_at)}</p>
                            </div>
                            <form action={removeItem}>
                              <input type="hidden" name="collection" value={active.id} />
                              <input type="hidden" name="record" value={m.record_id} />
                              <button className="text-xs text-muted underline hover:text-bad">Remove</button>
                            </form>
                          </div>
                          {mine.map((n) => (
                            <form key={n.id} action={deleteNote} className="text-xs bg-canvas rounded border border-line px-3 py-2 flex justify-between gap-3">
                              <span className="whitespace-pre-line">{n.body}</span>
                              <input type="hidden" name="note" value={n.id} />
                              <input type="hidden" name="collection" value={active.id} />
                              <button className="text-muted underline hover:text-bad shrink-0">Delete</button>
                            </form>
                          ))}
                          <form action={addNote} className="flex gap-2">
                            <input type="hidden" name="collection" value={active.id} />
                            <input type="hidden" name="record" value={m.record_id} />
                            <input name="body" required maxLength={5000} placeholder="Add a private note" aria-label="Add a private note"
                              className="flex-1 min-w-0 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs" />
                            <button className="text-xs rounded-md border border-line px-2 hover:border-accent hover:text-accent">Add</button>
                          </form>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>

              <Card title="Notes on the whole collection">
                <div className="space-y-2">
                  {(notes?.data ?? []).map((n) => (
                    <form key={n.id} action={deleteNote} className="text-sm bg-canvas rounded border border-line px-3 py-2 flex justify-between gap-3">
                      <span className="whitespace-pre-line">{n.body}</span>
                      <input type="hidden" name="note" value={n.id} />
                      <input type="hidden" name="collection" value={active.id} />
                      <button className="text-xs text-muted underline hover:text-bad shrink-0">Delete</button>
                    </form>
                  ))}
                  <form action={addNote} className="flex gap-2">
                    <input type="hidden" name="collection" value={active.id} />
                    <input name="body" required maxLength={5000} placeholder="Write a note" aria-label="Write a note"
                      className="flex-1 min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
                    <button className="rounded-md border border-line text-sm px-3 hover:border-accent hover:text-accent">Add</button>
                  </form>
                  <p className="text-xs text-muted">Notes are private to you.</p>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}
