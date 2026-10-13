import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { accessApplication } from '../src/lib/cloud-deployment.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function deploymentInputs(mode, publicConfig, shellConfig, provider, agentToken) {
  if (!['cloud-supabase', 'cloud-access'].includes(mode)) throw new Error('Choose an isolated cloud console mode.')
  const validOrigin = value => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Service configuration must use a credential-free HTTPS origin.')
    }
    return url.origin
  }
  const validToken = value => {
    if (typeof value !== 'string' || value.length < 32 || value.length > 4096 || /[^\x20-\x7e]/.test(value)) {
      throw new Error('A dedicated service credential is missing or invalid.')
    }
    return value
  }
  if (!provider || provider.type !== 'cloudflare-jobs' || provider.allowRemote !== true) {
    throw new Error('Use the existing explicitly authorized cloud note provider.')
  }
  if (!publicConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error('Supabase public configuration is missing.')
  const accessConfig = Object.fromEntries(Object.entries(accessApplication).map(([key, value]) => [key, process.env[key] ?? value]))
  if (mode === 'cloud-access') {
    const clientId = publicConfig.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]+\.access$/.test(clientId)) {
      throw new Error('Configure the exact Access service Client ID from the protected caller snapshot.')
    }
    accessConfig.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME = clientId
  }
  if (mode === 'cloud-access' && (!accessConfig.CLOUD_TOOLS_ACCESS_ISSUER || !accessConfig.CLOUD_TOOLS_ACCESS_AUD)) {
    throw new Error('Configure the actual Access application issuer and audience before deployment.')
  }
  return {
    env: {
      ...process.env,
      ...accessConfig,
      NEXT_PUBLIC_SUPABASE_URL: validOrigin(publicConfig.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: publicConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      VAULT_AGENT_URL: validOrigin(provider.url),
    },
    secrets: {
      CLOUD_TOOLS_AGENT_TOKEN: validToken(agentToken),
      RABBIT_CLOUDSHELL_TOKEN: validToken(shellConfig.RABBIT_CLOUDSHELL_TOKEN),
      VAULT_AGENT_TOKEN: validToken(provider.token),
    },
  }
}

async function main(args) {
  const [mode, vaultFlag, vault, secretsFlag, shellSecrets] = args
  if (args.length !== 5 || vaultFlag !== '--vault' || secretsFlag !== '--shell-secrets') {
    throw new Error('Use MODE --vault PATH --shell-secrets PATH. Credentials must not be passed as arguments.')
  }
  if (!['cloud-supabase', 'cloud-access'].includes(mode)) throw new Error('Choose cloud-supabase or cloud-access.')
  const destination = resolve(root, `.env.${mode}`)
  const ignored = await new Promise((done, reject) => {
    const child = spawn('git', ['check-ignore', destination], { cwd: root, stdio: 'ignore', shell: false })
    child.on('error', reject)
    child.on('close', code => done(code === 0))
  })
  if (!ignored) throw new Error('Deployment credential destination must be ignored by Git.')
  let existing
  try { existing = parseEnv(await readFile(destination, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const provider = JSON.parse(await readFile(resolve(vault, '.obsidian', 'plugins', 'rabbit-vault-agent', 'data.json'), 'utf8')).provider
  const publicConfig = parseEnv(await readFile(resolve(root, '.env.local'), 'utf8'))
  if (mode === 'cloud-access') {
    const client = parseEnv(await readFile(resolve(root, '.env.cloud-access-client'), 'utf8'))
    publicConfig.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME = client.CF_ACCESS_CLIENT_ID
  }
  const inputs = deploymentInputs(mode, publicConfig,
    parseEnv(await readFile(resolve(shellSecrets), 'utf8')), provider,
    existing?.CLOUD_TOOLS_AGENT_TOKEN ?? randomBytes(32).toString('hex'))
  if (existing) {
    if (Object.keys(existing).length !== 3 || Object.entries(inputs.secrets).some(([key, value]) => existing[key] !== value)) {
      throw new Error('Existing credential snapshot differs; explicitly resolve rotation before deployment.')
    }
  } else {
    await writeFile(destination, Object.entries(inputs.secrets).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
      { flag: 'wx', mode: 0o600 })
  }
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'node_modules', 'cf', 'bin', 'cf'), 'deploy',
      '--mode', mode, '--secrets-file', destination], { cwd: root, env: inputs.env, stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('close', done)
  })
  if (code !== 0) throw new Error(`Isolated console deployment failed (exit ${code}); no fallback or automatic retry.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
