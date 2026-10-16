import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DONATIONS_OPEN, WALLET } from '../src/lib/wallet.ts'

const here = dirname(fileURLToPath(import.meta.url))
const src = (p) => readFileSync(join(here, '..', p), 'utf8')
const BECH32 = /^bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}$/
const ETH_ANY = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g
const BTC_ANY = /\bbc1[a-z0-9]{20,}\b/gi

test('the wallet module has well-formed receive addresses and a proof for the same ones', () => {
  assert.match(WALLET.bitcoin.address, BECH32)
  assert.match(WALLET.ethereum.address, /^0x[0-9a-fA-F]{40}$/)
  assert.equal(WALLET.proof.bitcoin.address, WALLET.bitcoin.address)
  assert.equal(WALLET.proof.ethereum.address, WALLET.ethereum.address)
  assert.equal(WALLET.key.algorithm, 'EC_SIGN_SECP256K1_SHA256')
  assert.match(WALLET.proof.ethereum.signature, /^0x[0-9a-f]{130}$/)
})

test('no private key material or secrets are in the wallet module', () => {
  const text = src('src/lib/wallet.ts')
  assert.ok(!/private[_ ]?key|secret|seed|mnemonic|BEGIN [A-Z ]*PRIVATE/i.test(text.replace(/Its private key cannot/gi, '')), 'looks like secret material')
  assert.ok(!/\b[0-9a-f]{64}\b/.test(text.replace(/"messageHash": "[^"]+"|"(r|s)": "[^"]+"|"publicKeyCompressed": "[^"]+"|"signature": "[^"]+"/g, '')), 'unexplained 64-hex value')
})

test('the components never type an address: every address on the pages comes from WALLET', () => {
  for (const file of ['src/components/DonateCard.tsx', 'src/app/(app)/donate/page.tsx', 'src/app/(app)/dashboard/page.tsx']) {
    const text = src(file)
    assert.deepEqual(text.match(ETH_ANY) ?? [], [], `${file} contains a typed Ethereum address`)
    assert.deepEqual(text.match(BTC_ANY) ?? [], [], `${file} contains a typed Bitcoin address`)
  }
  assert.match(src('src/components/DonateCard.tsx'), /WALLET\.bitcoin\.address/)
  assert.match(src('src/components/DonateCard.tsx'), /WALLET\.ethereum\.address/)
})

test('the card says what the money is and is not, and warns about networks and reversals', () => {
  const text = src('src/components/DonateCard.tsx')
  assert.match(text, /Not an investment/)
  assert.match(text, /Ethereum mainnet/)
  assert.match(text, /cannot be reversed/)
})

test('the app copy equals the signed source in the wallet worker (when that repo is checked out)', () => {
  const source = join(here, '..', '..', 'rabbitsoftware-cloudflare', 'workers', 'wallet', 'wallet.json')
  if (!existsSync(source)) return
  assert.deepEqual(JSON.parse(readFileSync(source, 'utf8')), JSON.parse(JSON.stringify(WALLET)))
})

test('the app shows the Donate card, link and page only while donations are open (DONATIONS_OPEN comes from donations.json via the generated module)', () => {
  assert.equal(typeof DONATIONS_OPEN, 'boolean')
  assert.match(src('src/components/DonateCard.tsx'), /if \(!DONATIONS_OPEN\) return null/)
  assert.match(src('src/app/(app)/donate/page.tsx'), /if \(!DONATIONS_OPEN\) notFound\(\)/)
  assert.match(src('src/app/(app)/layout.tsx'), /\{DONATIONS_OPEN && <Link href="\/donate"/)
})

test('the wallet and explorer links open in a new tab safely, use https, and point only at the listed sites', async () => {
  const { WALLET_LINKS } = await import('../src/lib/wallet-links.ts')
  const hosts = new Set(['metamask.io', 'www.exodus.com', 'trustwallet.com', 'www.ledger.com', 'trezor.io', 'bitcoin.org', 'ethereum.org'])
  for (const l of [...WALLET_LINKS.apps, ...WALLET_LINKS.guides]) {
    const u = new URL(l.url)
    assert.equal(u.protocol, 'https:', l.name)
    assert.ok(hosts.has(u.host), `${l.name}: ${u.host} is not on the list`)
    assert.ok(!u.search, `${l.name}: no tracking or referral parameters`)
  }
  const card = src('src/components/DonateCard.tsx')
  assert.equal((card.match(/target="_blank"/g) ?? []).length, (card.match(/rel="noopener noreferrer"/g) ?? []).length)
  assert.match(card, /not endorsements/)
})
