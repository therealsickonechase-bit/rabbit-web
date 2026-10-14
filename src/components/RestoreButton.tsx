// "Restore from chain": a plain form post, no client JavaScript. Show it on a page whose data went missing.
export default function RestoreButton({ back, what = 'This page' }: { back: string; what?: string }) {
  return (
    <form method="post" action={`/api/chain/restore?back=${encodeURIComponent(back)}`} className="flex flex-wrap items-center gap-3 text-sm">
      <p className="text-muted">{what} is empty. Every write is also kept on the hash-chained ledger, so it can be brought back.</p>
      <button className="rounded-md border border-line px-3 py-1.5 text-sm font-medium">Restore from chain</button>
    </form>
  )
}
