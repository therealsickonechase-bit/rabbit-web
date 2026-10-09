import assert from 'node:assert/strict'
import test from 'node:test'
import { emailHash, generateContactKeys, normalizeEmail, openContact, sealContact } from '../src/lib/contact-crypto.ts'

const keys = await generateContactKeys()
const other = await generateContactKeys()

test('an address sealed with the public key opens with the private key', async () => {
  const sealed = await sealContact('Person@Example.com ', keys.publicKeySpkiB64)
  assert.equal(await openContact(sealed, keys.privateKeyPkcs8B64), 'person@example.com')
})

test('a long address (254 characters) still fits', async () => {
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`
  assert.ok(email.length >= 250)
  const sealed = await sealContact(email, keys.publicKeySpkiB64)
  assert.equal(await openContact(sealed, keys.privateKeyPkcs8B64), email)
})

test('the stored value never contains the address', async () => {
  const sealed = await sealContact('secret.name@example.com', keys.publicKeySpkiB64)
  const stored = JSON.stringify(sealed)
  assert.ok(!stored.includes('secret'))
  assert.ok(!stored.includes('example.com'))
})

test('sealing the same address twice gives different ciphertext', async () => {
  const a = await sealContact('same@example.com', keys.publicKeySpkiB64)
  const b = await sealContact('same@example.com', keys.publicKeySpkiB64)
  assert.notEqual(a.ct, b.ct)
  assert.notEqual(a.k, b.k)
  assert.notEqual(a.iv, b.iv)
})

test('a different private key cannot open it', async () => {
  const sealed = await sealContact('x@example.com', keys.publicKeySpkiB64)
  await assert.rejects(openContact(sealed, other.privateKeyPkcs8B64))
})

test('a tampered record is refused', async () => {
  const sealed = await sealContact('x@example.com', keys.publicKeySpkiB64)
  const bytes = Buffer.from(sealed.ct, 'base64')
  bytes[0] ^= 1
  await assert.rejects(openContact({ ...sealed, ct: bytes.toString('base64') }, keys.privateKeyPkcs8B64))
  await assert.rejects(openContact({ ...sealed, v: 2 }, keys.privateKeyPkcs8B64))
})

test('the public key alone cannot decrypt (it is not a private key)', async () => {
  const sealed = await sealContact('x@example.com', keys.publicKeySpkiB64)
  await assert.rejects(openContact(sealed, keys.publicKeySpkiB64))
})

test('the lookup hash ignores case and spaces, differs per key, and hides the address', async () => {
  const a = await emailHash('  Person@Example.com', keys.hashKeyB64)
  const b = await emailHash('person@example.com', keys.hashKeyB64)
  assert.equal(a, b)
  assert.notEqual(a, await emailHash('person@example.com', other.hashKeyB64))
  assert.notEqual(a, await emailHash('someone.else@example.com', keys.hashKeyB64))
  assert.ok(!Buffer.from(a, 'base64').toString('latin1').includes('person'))
  assert.equal(normalizeEmail(' A@B.co '), 'a@b.co')
})
