import assert from 'node:assert/strict'
import test from 'node:test'
import { ethToWeiHex, payWithBrowserWallet } from '../src/lib/eth-pay.ts'

test('amounts convert to exact wei and anything odd is refused', () => {
  assert.equal(ethToWeiHex('1'), '0xde0b6b3a7640000')
  assert.equal(ethToWeiHex('0.01'), '0x2386f26fc10000')
  assert.equal(ethToWeiHex(' 0.000000000000000001 '), '0x1')
  assert.equal(ethToWeiHex('100'), '0x56bc75e2d63100000')
  for (const bad of ['', '0', '0.0', '-1', '1e3', '1,5', '0x10', '100.000000000000000001', '1.0000000000000000001', 'abc', '1 ETH']) assert.equal(ethToWeiHex(bad), null, bad)
})

const TO = '0x724Dfe717565742b066465813773586df98d9372'
const fakeWallet = (overrides = {}) => {
  const calls = []
  return { calls, request: async ({ method, params }) => { calls.push({ method, params }); if (overrides[method]) return overrides[method](params); return { eth_requestAccounts: ['0xabc'], wallet_switchEthereumChain: null, eth_sendTransaction: '0xhash' }[method] } }
}

test('the wallet is asked to switch to mainnet, then to send to the donation address with no data field', async () => {
  const w = fakeWallet()
  const msg = await payWithBrowserWallet(w, TO, '0.01')
  assert.match(msg, /^Sent\. Transaction 0xhash/)
  assert.deepEqual(w.calls.map((c) => c.method), ['eth_requestAccounts', 'wallet_switchEthereumChain', 'eth_sendTransaction'])
  assert.deepEqual(w.calls[1].params, [{ chainId: '0x1' }])
  assert.deepEqual(w.calls[2].params, [{ from: '0xabc', to: TO, value: '0x2386f26fc10000' }])
  assert.ok(!('data' in w.calls[2].params[0]))
})

test('a bad amount or a missing wallet sends nothing, and the visitor is told why', async () => {
  const w = fakeWallet()
  assert.match(await payWithBrowserWallet(w, TO, 'ten'), /Enter an amount/)
  assert.equal(w.calls.length, 0)
  assert.match(await payWithBrowserWallet(undefined, TO, '0.01'), /No browser wallet/)
})

test('cancelling or a wallet error is reported without throwing', async () => {
  const cancel = fakeWallet({ eth_sendTransaction: () => { throw Object.assign(new Error('no'), { code: 4001 }) } })
  assert.match(await payWithBrowserWallet(cancel, TO, '0.01'), /Cancelled/)
  const broken = fakeWallet({ wallet_switchEthereumChain: () => { throw new Error('boom') } })
  assert.match(await payWithBrowserWallet(broken, TO, '0.01'), /could not send/)
})
