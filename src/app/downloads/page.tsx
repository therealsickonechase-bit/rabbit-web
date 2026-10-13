import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { humanSize, publicUrl } from '@/lib/packages'

// Only already-public packages are available. Account upload/removal actions are disabled.
export const metadata = { title: 'RabbitOS downloads', description: 'Data packages published by RabbitOS, free to download.' }
export const dynamic = 'force-dynamic'

export default async function DownloadsPage() {
  const sb = await createClient()
  const { data: packages } = await sb.from('public_packages').select('id, title, description, licence, file_name, path, size_bytes, sha256, created_at').order('created_at', { ascending: false }).limit(200)
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  return (
    <main className="min-h-screen bg-canvas text-fg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <p className="text-2xl font-semibold tracking-tight"><span className="text-accent">Rabbit</span>OS downloads</p>
          <p className="text-sm text-muted">Data packages published by RabbitOS. Free to download, no sign-in. Check the SHA-256 of what you download against the one shown here.</p>
          <div className="flex gap-2 text-xs">
            <Link href="/dashboard" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">Open RabbitOS</Link>
            <Link href="/guide" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">Guide</Link>
          </div>
        </header>

        <section className="space-y-3" aria-label="Packages">
          {(packages ?? []).length === 0 && <p className="text-sm text-muted">Nothing has been published yet.</p>}
          {(packages ?? []).map((p) => (
            <article key={p.id} className="bg-surface border border-line rounded-lg p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-medium">{p.title}</h3>
                <a className="text-xs rounded-md border border-accent text-accent px-3 py-1 hover:bg-accent-soft" href={publicUrl(base, p.path, p.file_name)} rel="noopener noreferrer">Download · {humanSize(Number(p.size_bytes))}</a>
              </div>
              <p className="text-sm text-muted whitespace-pre-line">{p.description}</p>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <div><dt className="text-muted inline">File: </dt><dd className="inline font-mono">{p.file_name}</dd></div>
                <div><dt className="text-muted inline">Licence: </dt><dd className="inline">{p.licence}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted inline">SHA-256: </dt><dd className="inline font-mono break-all">{p.sha256}</dd></div>
                <div><dt className="text-muted inline">Published: </dt><dd className="inline">{new Date(p.created_at).toISOString().slice(0, 10)}</dd></div>
              </dl>
            </article>
          ))}
        </section>

        <footer className="text-xs text-muted pb-8">
          Research and education. Nothing here is medical advice. Each package is shared under the licence shown with it. Questions: contact@rabbitsoftware.io
        </footer>
      </div>
    </main>
  )
}
