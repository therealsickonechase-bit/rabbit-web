import Link from 'next/link'

export const metadata = { title: 'RabbitOS guide', description: 'Using the account-free RabbitOS workspace.' }

export default function GuidePage() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-semibold">RabbitOS: no account required</h1>
      <Link href="/dashboard" className="text-accent underline">Open RabbitOS</Link>
      <section className="space-y-3 text-sm">
        <h2 className="font-semibold">Get started</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Open the workspace. No email, password, magic link, CAPTCHA or guest pass is required.</li>
          <li>Research shows the latest 20 already-public literature titles and source links, not private records.</li>
          <li>Ask RabbitOS uses hosted Qwen3 on Cloudflare. Approve each question, recent chat and public record titles before sending. No local model or personal API key is required. Provider errors are shown without fallback. Shared hourly/daily attempt quotas apply.</li>
          <li>Brain &amp; Body, Twin model and Connections open the local interactive explorer. Built-in simulations work without account data. Stored server EEG and personal twin readings are never loaded. Device bridges are opt-in and run on your computer.</li>
          <li>The avatar answers body questions locally. Choose hosted Qwen for open questions, with fresh consent. Avatar chat stays in the current tab.</li>
          <li>Memory, Collections and Local tasks store notes/checklists in this browser profile. The local file viewer reads selected text files without uploading them. Local tasks do not execute remote agent jobs.</li>
          <li>Settings lets you name, export or clear the browser workspace. Chat history and notes persist in this browser only, with no cross-device sync. Browser storage is unencrypted: avoid sensitive information on shared computers.</li>
        </ol>
      </section>
      <section className="space-y-3 text-sm">
        <h2 className="font-semibold">Existing private data and integrations</h2>
        <p>Existing accounts, saved chats, contact records, private files, provider keys and owner controls have not been deleted or made public. They are inaccessible through this account-free application, including from old signed-in browsers. Account API actions return an explicit disabled-service error.</p>
        <p>Already-public downloads, teaching model APIs and public audit proofs remain available. Signed machine-to-machine agent, ingest and MCP integrations retain their own credential checks; they are not anonymous account access.</p>
        <p>CRISPR is text-only education. No private guide candidates are loaded. The workspace is not medical advice, a diagnosis, or a lab protocol.</p>
      </section>
      <section className="space-y-3 text-sm">
        <h2 className="font-semibold">Local bridges</h2>
        <p>The explorer includes directions for each loopback bridge. Start only the connections you want: EEG/EMG, your own data hub, WiFi sensing with everyone&apos;s consent, twin network, or logged-moment matching. Your files and devices are never connected automatically.</p>
        <p>Hosted text/image inference and public feeds require internet. Private raw device values are not sent to Qwen chat; the avatar supplies fixed state words only. Review consent before using any hosted model.</p>
      </section>
    </main>
  )
}
