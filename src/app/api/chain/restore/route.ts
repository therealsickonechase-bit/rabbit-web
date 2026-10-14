import { restoreFromChain } from '@/lib/chain-ledger-db'
import { appPage } from '@/lib/open-access'

// Anyone can trigger a restore. It is idempotent (rows already present are left alone) and refuses a broken hash chain.
// A form post (from the "Restore from chain" button) is sent back to the page it came from; JSON callers get the result.
const calls: number[] = []
const allowed = () => {
  const now = Date.now()
  while (calls.length && now - calls[0] > 60_000) calls.shift()
  if (calls.length >= 6) return false
  calls.push(now)
  return true
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const back = url.searchParams.get('back') ?? ''
  const isForm = (request.headers.get('content-type') ?? '').includes('form')
  const page = appPage(back) ? back.split('?')[0] : '/dashboard'
  if (!allowed()) return isForm ? redirect(page, 'restore-busy') : Response.json({ error: 'too many restores, try again in a minute' }, { status: 429 })
  let result
  try { result = await restoreFromChain() } catch { result = { ok: false as const, reason: 'restore failed' } }
  if (isForm) return redirect(page, result.ok ? 'restored' : 'restore-refused')
  return Response.json(result, { status: result.ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
}

const redirect = (page: string, msg: string) => new Response(null, { status: 303, headers: { Location: `${page}?msg=${msg}`, 'Cache-Control': 'no-store' } })
