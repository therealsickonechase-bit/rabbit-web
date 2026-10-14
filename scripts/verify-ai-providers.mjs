// Owner-run check of the AI provider contracts, using YOUR keys from the environment. Run it locally:  npm run verify:ai
//   GEMINI_API_KEY        -> lists Gemini models, then sends one tiny generateContent request
//   ANTHROPIC_API_KEY     -> sends one tiny /v1/messages request (same request shape the AI coder panel uses)
//   COPILOT_GITHUB_TOKEN  -> checks that GitHub accepts the token (GET /user). Copilot has no REST API to test; the CLI itself is not run.
// Without keys it only checks the CLI packages with `npm view`. Each item prints PASS, FAIL or SKIPPED. Keys are never printed:
// every line goes through scrub(), and failures show only an HTTP status, never a response body.
// Exit code 1 if any item FAILS. Skipped items do not fail the run.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_CLAUDE_MODEL, fetchGeminiModels, providerRequest, extractReply, scrub,
} from '../src/lib/coding-assistant.ts'

export const CLI_PACKAGES = ['@google/gemini-cli', '@anthropic-ai/claude-code', '@github/copilot']
const PING = [
  { role: 'system', content: 'Reply with the single word OK.' },
  { role: 'user', content: 'ping' },
]

function npmView(pkg) {
  const r = spawnSync('npm', ['view', pkg, 'version'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000 })
  if (r.status !== 0) return { ok: false, error: 'npm view failed' }
  const version = (r.stdout ?? '').trim()
  return /^\d+\.\d+\.\d+/.test(version) ? { ok: true, version } : { ok: false, error: 'no version returned' }
}

/** @returns {Promise<{name: string, status: 'PASS'|'FAIL'|'SKIPPED', detail: string}[]>} */
export async function run({ env = process.env, fetcher = fetch, view = npmView, skipNpm = false, print = () => {} } = {}) {
  const secrets = [env.GEMINI_API_KEY, env.ANTHROPIC_API_KEY, env.COPILOT_GITHUB_TOKEN].filter((v) => typeof v === 'string' && v.length >= 8)
  const results = []
  const add = (name, status, detail = '') => {
    const line = scrub(`${status.padEnd(7)} ${name}${detail ? `  ${detail}` : ''}`, secrets)
    results.push({ name, status, detail: scrub(detail, secrets) })
    print(line)
  }
  const failure = (e) => scrub(e instanceof Error ? e.message : 'error', secrets)

  // ---- Gemini ----
  const gKey = (env.GEMINI_API_KEY ?? '').trim()
  if (!gKey) {
    add('gemini models.list', 'SKIPPED', 'GEMINI_API_KEY not set')
    add('gemini generateContent', 'SKIPPED', 'GEMINI_API_KEY not set')
  } else {
    let models = []
    try {
      models = await fetchGeminiModels(gKey, fetcher)
      add('gemini models.list', 'PASS', `${models.length} models support generateContent`)
    } catch (e) { add('gemini models.list', 'FAIL', failure(e)) }
    const model = models.find((m) => /flash/.test(m)) ?? models[0]
    if (!model) add('gemini generateContent', 'SKIPPED', 'no model available from the list')
    else {
      try {
        const req = providerRequest({ provider: 'gemini', apiKey: gKey, model }, PING)
        const res = await fetcher(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), redirect: 'error', cache: 'no-store', credentials: 'omit' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        extractReply('gemini', await res.json())
        add('gemini generateContent', 'PASS', `model ${model} replied`)
      } catch (e) { add('gemini generateContent', 'FAIL', failure(e)) }
    }
  }

  // ---- Claude ----
  const aKey = (env.ANTHROPIC_API_KEY ?? '').trim()
  if (!aKey) add('claude messages', 'SKIPPED', 'ANTHROPIC_API_KEY not set')
  else {
    try {
      const req = providerRequest({ provider: 'claude', apiKey: aKey, model: DEFAULT_CLAUDE_MODEL }, PING)
      const res = await fetcher(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify({ ...req.body, max_tokens: 16 }), redirect: 'error', cache: 'no-store', credentials: 'omit' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      extractReply('claude', await res.json())
      add('claude messages', 'PASS', `model ${DEFAULT_CLAUDE_MODEL} replied`)
    } catch (e) { add('claude messages', 'FAIL', failure(e)) }
  }

  // ---- Copilot (terminal only) ----
  const cKey = (env.COPILOT_GITHUB_TOKEN ?? '').trim()
  if (!cKey) add('copilot token', 'SKIPPED', 'COPILOT_GITHUB_TOKEN not set (Copilot is terminal-only; there is no REST call to test)')
  else {
    try {
      const res = await fetcher('https://api.github.com/user', {
        method: 'GET', headers: { Authorization: `Bearer ${cKey}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'rabbitos-verify-ai' },
        redirect: 'error', cache: 'no-store', credentials: 'omit',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      add('copilot token', 'PASS', 'GitHub accepts the token. Copilot entitlement and the "Copilot Requests" permission are NOT checked: run `copilot` to confirm')
    } catch (e) { add('copilot token', 'FAIL', failure(e)) }
  }

  // ---- CLI packages ----
  for (const pkg of CLI_PACKAGES) {
    if (skipNpm) { add(`npm ${pkg}`, 'SKIPPED', 'npm checks disabled'); continue }
    const r = view(pkg)
    if (r.ok) add(`npm ${pkg}`, 'PASS', `latest ${r.version}`)
    else add(`npm ${pkg}`, 'FAIL', r.error)
  }
  return results
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await run({ print: (line) => console.log(line) })
  const count = (s) => results.filter((r) => r.status === s).length
  console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIPPED')} skipped`)
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.COPILOT_GITHUB_TOKEN) console.log('No keys in the environment, so only the npm checks ran.')
  process.exitCode = count('FAIL') ? 1 : 0
}
