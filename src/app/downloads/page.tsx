import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { humanSize, publicUrl } from '@/lib/packages'
import { CORE_AFTER, CORE_PLATFORMS, CORE_SITE, checksumCommands, fetchCoreLatest } from '@/lib/maxwell-core-download'

// Only already-public packages are available. Account upload/removal actions are disabled.
export const metadata = { title: 'RabbitOS downloads', description: 'Maxwell Core (the node for the research chain) and data packages published by RabbitOS, free to download.' }
export const dynamic = 'force-dynamic'

export default async function DownloadsPage() {
  const sb = await createClient()
  const { data: packages } = await sb.from('public_packages').select('id, title, description, licence, file_name, path, size_bytes, sha256, created_at').order('created_at', { ascending: false }).limit(200)
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const core = await fetchCoreLatest()

  return (
    <main className="min-h-screen bg-canvas text-fg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <p className="text-2xl font-semibold tracking-tight"><span className="text-accent">Rabbit</span>OS downloads</p>
          <p className="text-sm text-muted">Maxwell Core and the data packages published by RabbitOS. Free to download, no sign-in. Check the SHA-256 of what you download against the one shown here.</p>
          <div className="flex gap-2 text-xs">
            <Link href="/dashboard" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">Open RabbitOS</Link>
            <Link href="/guide" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">Guide</Link>
          </div>
        </header>

        <section className="bg-surface border border-line rounded-lg p-4 space-y-4" aria-label="Maxwell Core">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">Maxwell Core{core ? ` ${core.version}` : ''}</h2>
              <p className="text-sm text-muted">The node for the research chain, the kernel of RabbitOS. It keeps its own verified copy of the chain, and reports to rabbitsoftware.io so the network shows on the live view. One ZIP for Raspberry Pi, Linux, Windows, macOS and Docker. It starts by itself at boot or sign-in and adds a Maxwell Core desktop icon that opens a local dashboard: your chain, the cloud network, the other nodes, the research, and a way into the RabbitOS cloud shell. Needs Node.js 18 or newer. Install it for your user, or for the whole computer with administrator rights, and use it from any terminal: maxwell-core verify, watch, status, update. Read-only: it never mines and holds no secret that can change the chain.</p>
            </div>
            {core
              ? <a className="text-xs rounded-md border border-accent text-accent px-3 py-1 hover:bg-accent-soft" href={core.url} rel="noopener noreferrer">Download · {humanSize(core.bytes)}</a>
              : <a className="text-xs rounded-md border border-accent text-accent px-3 py-1 hover:bg-accent-soft" href={`${CORE_SITE}/maxwell-core`} rel="noopener noreferrer">Download page</a>}
          </div>
          {core && (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div><dt className="text-muted inline">File: </dt><dd className="inline font-mono">{core.file}</dd></div>
              <div><dt className="text-muted inline">Licence: </dt><dd className="inline">UPL-1.0</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted inline">SHA-256: </dt><dd className="inline font-mono break-all">{core.sha256}</dd></div>
            </dl>
          )}
          <ol className="text-sm list-decimal pl-5 space-y-1">
            <li>Download the ZIP{core ? <> and check its SHA-256 against the one above: <code className="font-mono text-xs">{checksumCommands(core.file).linux}</code> (Linux, Raspberry Pi), <code className="font-mono text-xs">{checksumCommands(core.file).macos}</code> (macOS), <code className="font-mono text-xs">{checksumCommands(core.file).windows}</code> (Windows)</> : null}.</li>
            <li>Unzip it, then open the folder for your machine under <code className="font-mono text-xs">platforms/</code> and run the steps below. Every installer has a dry run, so you can look first.</li>
            <li>Read the installer before you run it. Never pipe a download straight into your shell.</li>
          </ol>
          <div className="space-y-3">
            {CORE_PLATFORMS.map((p) => (
              <div key={p.id} className="space-y-1">
                <h3 className="text-sm font-medium">{p.name} <span className="text-xs font-normal text-muted">{p.note}</span></h3>
                <pre className="overflow-x-auto rounded-md border border-line bg-canvas p-2 text-xs font-mono">{p.steps.join('\n')}</pre>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Once it runs: it talks to RabbitOS, rabbitsoftware.io and rabbitweb</h3>
            <pre className="overflow-x-auto rounded-md border border-line bg-canvas p-2 text-xs font-mono">{CORE_AFTER.join('\n')}</pre>
            <p className="text-xs text-muted">Your node only reads public files. If you give it a name, it writes a signed heartbeat (software, platform, chain head, time) and sends nothing unless you publish that file. No telemetry. To appear on the live view, send the project owner the public key it prints. Full details: <a className="underline" href={`${CORE_SITE}/maxwell-core`} rel="noopener noreferrer">rabbitsoftware.io/maxwell-core</a> and <a className="underline" href={`${CORE_SITE}/core`} rel="noopener noreferrer">the live view</a>.</p>
          </div>
        </section>

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
