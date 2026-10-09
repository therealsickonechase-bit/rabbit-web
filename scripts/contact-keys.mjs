// Creates the keys for encrypted contact records. RUN THIS YOURSELF, on your own machine.
//
//   node scripts/contact-keys.mjs
//   node scripts/contact-keys.mjs --out "D:\\private\\rabbitos-keys"
//
// What it does:
//   - writes your PRIVATE key to a folder OUTSIDE this repository (default: ~/rabbitos-contact-keys)
//   - adds the PUBLIC key and a lookup hash key to .dev.vars (so the next deploy gives them to the Worker)
//   - prints the public key's fingerprint so you can check it later
// It never prints the private key. It refuses to run if keys already exist, because replacing the public
// key would leave older records unreadable to the new one and unreadable by anyone without the old private key.
//
// BACK UP THE PRIVATE KEY OFFLINE (a USB stick, or a password manager's secure file storage), in at least
// two places. Without it the contact records cannot be opened by anyone, including you.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { generateContactKeys } from '../src/lib/contact-crypto.ts'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : null
const outDir = resolve(outArg ?? join(homedir(), 'rabbitos-contact-keys'))
const repo = resolve('.')

const rel = relative(repo, outDir)
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error(`Refusing: ${outDir} is inside this repository. Choose a folder outside it, so the private key can never be committed.`)
  process.exit(1)
}

const keyFile = join(outDir, 'contact-private-key.pem')
const devVars = '.dev.vars'
const existing = existsSync(devVars) ? readFileSync(devVars, 'utf8') : ''
if (existsSync(keyFile) || /^CONTACT_PUBLIC_KEY=/m.test(existing) || /^CONTACT_HASH_KEY=/m.test(existing)) {
  console.error('Contact keys already exist (a private key file or CONTACT_* lines in .dev.vars). Not overwriting them.')
  process.exit(1)
}

const { publicKeySpkiB64, privateKeyPkcs8B64, hashKeyB64 } = await generateContactKeys()
const pem = `-----BEGIN PRIVATE KEY-----\n${privateKeyPkcs8B64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`

mkdirSync(outDir, { recursive: true })
writeFileSync(keyFile, pem, { mode: 0o600, flag: 'wx' })
appendFileSync(devVars, `${existing && !existing.endsWith('\n') ? '\n' : ''}CONTACT_PUBLIC_KEY=${publicKeySpkiB64}\nCONTACT_HASH_KEY=${hashKeyB64}\n`)

const fingerprint = createHash('sha256').update(Buffer.from(publicKeySpkiB64, 'base64')).digest('hex')
console.log('Contact record keys created.\n')
console.log(`  Private key written to: ${keyFile}`)
console.log(`  Public key fingerprint: ${fingerprint}`)
console.log('  .dev.vars now has CONTACT_PUBLIC_KEY and CONTACT_HASH_KEY (deploy to give them to the Worker).\n')
console.log('NEXT:')
console.log('  1. Copy the private key file to offline storage in at least two places.')
console.log('  2. Write the fingerprint down somewhere safe so you can confirm it later.')
console.log('  3. Do not email, chat or commit the private key, and never paste it into any tool.')
