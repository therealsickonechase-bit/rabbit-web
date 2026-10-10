'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BUCKET, LICENCES, MAX_BYTES, checkFile, checkMeta, humanSize, isTextFile, safeFileName, scanText, sha256Hex } from '@/lib/packages'

// Owner only (the page shows it only to the owner and the database enforces it). Picks a file from this computer, checks it, and publishes it.
// Everything uploaded here is public to the whole internet. The checks run in this browser before anything is sent.

const SCAN_LIMIT = 8 * 1024 * 1024      // text files up to 8 MB are scanned for keys and personal identifiers

export default function PackageUpload() {
  const router = useRouter()
  const input = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [licence, setLicence] = useState('')
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const pick = async (f: File | null) => {
    setFile(f); setProblems([]); setWarnings([]); setNote(''); setSure(false)
    if (!f) return
    const c = checkFile(f.name, f.size)
    const p = [...c.problems], w = [...c.warnings]
    if (c.ok && isTextFile(f.name)) {
      if (f.size <= SCAN_LIMIT) {
        const found = scanText(await f.text())
        if (found.length) p.push(`The file appears to contain ${found.join('; ')}. Remove it before publishing.`)
      } else w.push('This text file is too large to scan here. Check it yourself for keys and personal data.')
    }
    setProblems(p); setWarnings(w)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120))
  }

  const publish = async () => {
    if (!file || problems.length || !sure) return
    const meta = { title, description, licence }
    const metaProblems = checkMeta(meta)
    if (metaProblems.length) { setNote(metaProblems.join(' ')); return }
    setBusy(true); setNote('Calculating the checksum…')
    const sb = createClient()
    const name = safeFileName(file.name)
    const path = `${crypto.randomUUID()}/${name}`
    try {
      const sha = await sha256Hex(await file.arrayBuffer())
      setNote(`Uploading ${humanSize(file.size)}…`)
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false, cacheControl: '3600' })
      if (up.error) throw new Error(up.error.message)
      const ins = await sb.from('public_packages').insert({ title: title.trim(), description: description.trim(), licence, file_name: name, path, size_bytes: file.size, sha256: sha })
      if (ins.error) { await sb.storage.from(BUCKET).remove([path]); throw new Error(ins.error.message) }
      setNote('Published. It is now on the public Downloads page.')
      setFile(null); setTitle(''); setDescription(''); setLicence(''); setSure(false)
      if (input.current) input.current.value = ''
      router.refresh()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setNote(/row-level security|violates|not authorized|403/i.test(m) ? 'Only the owner account can publish. Sign in as the owner.' : `Could not publish: ${m.slice(0, 200)}`)
    } finally { setBusy(false) }
  }

  const field = 'w-full rounded border border-line bg-canvas px-2 py-1 text-sm'
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted">
        Choose a file from this computer or any drive connected to it. It must be a data file or an archive (zip, 7z, tar, csv, json, fasta and similar), up to {humanSize(MAX_BYTES)}.
        Text files are scanned for keys and personal identifiers first. <strong>Everything you publish is visible to anyone on the internet and cannot be recalled from copies people already downloaded.</strong>
      </p>
      <input ref={input} type="file" onChange={(e) => void pick(e.target.files?.[0] ?? null)} className="text-xs" aria-label="Choose a file to publish" />
      {file && <p className="text-xs text-muted">{file.name} · {humanSize(file.size)}</p>}
      {problems.map((p) => <p key={p} role="alert" className="text-xs text-bad">{p}</p>)}
      {warnings.map((w) => <p key={w} className="text-xs text-warn">{w}</p>)}
      {file && problems.length === 0 && (
        <div className="space-y-2">
          <label className="block text-xs">Title<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
          <label className="block text-xs">Description (what is in it, where it came from)<textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} className={field} /></label>
          <label className="block text-xs">Licence<select value={licence} onChange={(e) => setLicence(e.target.value)} className={field}><option value="">Choose…</option>{LICENCES.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5" />
            I am allowed to share this file, it contains nothing private, and I understand it will be public.</label>
          <button disabled={busy || !sure || problems.length > 0} onClick={() => void publish()} className="text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50">
            {busy ? 'Publishing…' : 'Publish publicly'}
          </button>
        </div>
      )}
      {note && <p className="text-xs text-muted" aria-live="polite">{note}</p>}
    </div>
  )
}

/** Owner-only: takes a package down (the file and its listing). Copies already downloaded cannot be recalled. */
export function PackageRemove({ id, path }: { id: string; path: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    if (!window.confirm('Remove this package from the public Downloads page? Copies already downloaded cannot be recalled.')) return
    setBusy(true)
    const sb = createClient()
    await sb.from('public_packages').delete().eq('id', id)
    await sb.storage.from(BUCKET).remove([path])
    setBusy(false); router.refresh()
  }
  return <button disabled={busy} onClick={() => void remove()} className="text-xs rounded-md border border-line px-2 py-0.5 hover:border-bad hover:text-bad disabled:opacity-50">{busy ? 'Removing…' : 'Remove'}</button>
}
