// Pure helpers for the "pay with a browser wallet" button (Ethereum mainnet). The page asks the visitor's own wallet (an EIP-1193 provider such as MetaMask) to send ETH
// straight to the donation address; nothing passes through RabbitSoftware or any payment processor. No contract data is ever set.

const WEI_PER_ETH = BigInt('1000000000000000000')
const ZERO = BigInt(0)
export const MAX_ETH = BigInt('100000000000000000000')

/** "0.01" -> "0x2386f26fc10000" (wei as hex). null for anything that is not a plain positive decimal up to 100 ETH with at most 18 decimals. */
export function ethToWeiHex(text: string): string | null {
  const t = String(text).trim()
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null
  const [whole, frac = ''] = t.split('.')
  const wei = BigInt(whole) * WEI_PER_ETH + BigInt(frac.padEnd(18, '0'))
  if (wei <= ZERO || wei > MAX_ETH) return null
  return '0x' + wei.toString(16)
}

export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

/** Asks the wallet to send. Returns a message for the visitor, never throws. */
export async function payWithBrowserWallet(provider: Eip1193 | undefined, to: string, amountText: string): Promise<string> {
  const value = ethToWeiHex(amountText)
  if (!value) return 'Enter an amount in ETH, for example 0.01 (up to 100).'
  if (!provider) return 'No browser wallet found here. Use "Open in wallet" or copy the address.'
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to, value }] })
    return `Sent. Transaction ${String(hash)}. Thank you.`
  } catch (err) {
    return (err as { code?: number } | null)?.code === 4001 ? 'Cancelled in the wallet. Nothing was sent.' : 'The wallet could not send it. Nothing was sent.'
  }
}
