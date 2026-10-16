'use client'

import Link from 'next/link'
import { useState } from 'react'
import { payWithBrowserWallet, type Eip1193 } from '@/lib/eth-pay'
import { DONATIONS_OPEN, WALLET } from '@/lib/wallet'

// Receive-only donation addresses. The text comes from WALLET (generated from the signed wallet.json), never typed here.
// Nothing is sent from this page; "Open in wallet" uses the bitcoin: / ethereum: link of the visitor's own wallet app.
const ROWS = [
  { id: 'btc', label: 'Bitcoin (BTC), native SegWit', address: WALLET.bitcoin.address, uri: `bitcoin:${WALLET.bitcoin.address}` },
  { id: 'eth', label: 'Ethereum (ETH), Ethereum mainnet', address: WALLET.ethereum.address, uri: `ethereum:${WALLET.ethereum.address}` },
] as const

export default function DonateCard({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState('')
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const [payMsg, setPayMsg] = useState('')
  if (!DONATIONS_OPEN) return null // donations are paused (workers/wallet/donations.json in rabbitsoftware-cloudflare)

  async function copy(id: string, address: string) {
    try { await navigator.clipboard.writeText(address); setCopied(id); setNote(''); setTimeout(() => setCopied(''), 1600) }
    catch { setNote('Clipboard unavailable: select the address text and copy it.') }
  }

  async function pay() {
    setPayMsg(await payWithBrowserWallet((window as unknown as { ethereum?: Eip1193 }).ethereum, WALLET.ethereum.address, amount))
  }

  return (
    <section className="bg-surface border border-line rounded-lg" aria-labelledby="donate-heading">
      <header className="px-4 py-3 border-b border-line">
        <h2 id="donate-heading" className="text-sm font-semibold">Support RabbitSoftware</h2>
        <p className="text-xs text-muted mt-0.5">Voluntary donations toward hosting and development. Not an investment; no goods or services in return.</p>
      </header>
      <div className="p-4 space-y-4 text-sm">
        {ROWS.map((r) => (
          <div key={r.id} className="space-y-1.5">
            <p className="text-xs font-medium text-muted">{r.label}</p>
            <code className="block rounded border border-line bg-canvas px-3 py-2 font-mono text-xs break-all select-all">{r.address}</code>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => copy(r.id, r.address)} className="rounded-md border border-line px-3 py-1 text-xs hover:bg-canvas">
                {copied === r.id ? 'Copied' : 'Copy address'}
              </button>
              <a href={r.uri} className="rounded-md border border-line px-3 py-1 text-xs hover:bg-canvas">Open in wallet</a>
            </div>
          </div>
        ))}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">Or pay with a browser wallet (Ethereum mainnet)</p>
          <div className="flex flex-wrap gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount in ETH, e.g. 0.01" aria-label="Amount in ETH" className="rounded-md border border-line bg-canvas px-3 py-1 text-xs" />
            <button type="button" onClick={pay} className="rounded-md border border-line px-3 py-1 text-xs hover:bg-canvas">Send from my wallet</button>
          </div>
          {payMsg && <p role="status" className="text-xs text-muted">{payMsg}</p>}
        </div>
        {note && <p role="status" className="text-xs text-warn">{note}</p>}
        <p className="text-xs text-muted">
          Send Bitcoin only to the Bitcoin address, and ETH only on Ethereum mainnet to the Ethereum address. Transactions cannot be reversed, and funds sent on another network can be lost.
          {compact && <> <Link href="/donate" className="underline text-accent">How to verify these addresses</Link>.</>}
        </p>
      </div>
    </section>
  )
}
