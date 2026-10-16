export const COMMAND_BYTES = 4000
export const SNAPSHOT_BYTES = 64 * 1024
export const OUTPUT_BYTES = 256 * 1024
export const VAULT_ROOTS = ['Cloud Agents/Knowledge/', 'Agents/', 'Workers/'] as const
const credentialPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}/
const bytes = (value: string) => new TextEncoder().encode(value).byteLength

export class CloudJobError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export function verifyOwnerIdentity(
  user: { id: string } | null, authError: unknown,
  owner: { data: unknown; error: unknown },
) {
  if (authError || !user) throw new CloudJobError(401, 'An existing owner session is required. Account sign-in remains disabled.')
  if (owner.error || typeof owner.data !== 'boolean') throw new CloudJobError(503, 'Owner identity check is unavailable or not configured.')
  if (owner.data !== true) throw new CloudJobError(403, 'Owner only.')
  return user.id
}

export function ownerCloudApi(path: string, method: string) {
  const base = path.replace(/^\/api\/cloud-agent\/vault/, '/api/vault')
  if (path === '/api/cloud-agent/shell') return method === 'POST'
  if (/^\/api\/(?:cloud-access|cloud-agent\/access)\/request$/.test(path)) return method === 'POST'
  if (/^\/api\/(?:cloud-access|cloud-agent\/access)\/status$/.test(path)) return method === 'GET'
  if (path === '/api/cloud-login') return method === 'POST'
  if (path === '/api/cloudshell/session') return method === 'GET' || method === 'POST'
  return (path === '/api/cloudshell/execute' && method === 'POST') ||
    (base === '/api/vault/jobs' && method === 'POST') ||
    (/^\/api\/vault\/jobs\/[a-f0-9]{64}(\/result)?$/.test(base) && method === 'GET')
}

export function requireWriteOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new CloudJobError(403, 'Same-origin JSON requests are required.')
  }
}

export async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new CloudJobError(413, 'Payload exceeds the permitted byte limit.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined)
}

export async function readJson(request: Request, limit: number) {
  const raw = await boundedText(request.body, limit)
  try { return JSON.parse(raw) as unknown }
  catch { throw new CloudJobError(400, 'Invalid JSON.') }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudJobError(400, 'Expected an object.')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new CloudJobError(400, 'Unexpected field.')
}

export function shellCommand(value: unknown) {
  const input = record(value)
  exactKeys(input, ['command', 'consent', 'session', 'timeoutSeconds'])
  if (input.consent !== true || typeof input.command !== 'string' || !input.command.trim() ||
      input.command.includes('\0') || bytes(input.command) > COMMAND_BYTES) {
    throw new CloudJobError(400, 'Approve each nonempty command (maximum 4000 UTF-8 bytes).')
  }
  const out: { command: string; consent: true; session?: true; timeoutSeconds?: number } = { command: input.command, consent: true }
  if ('session' in input && typeof input.session !== 'boolean') throw new CloudJobError(400, 'session must be true or false.')
  if (input.session === true) out.session = true
  if ('timeoutSeconds' in input) {
    const n = input.timeoutSeconds
    if (input.session !== true || typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 150) {
      throw new CloudJobError(400, 'timeoutSeconds (1-150) is only for session commands.')
    }
    out.timeoutSeconds = n
  }
  return out
}

export function vaultSnapshot(value: unknown, roots: readonly string[]) {
  if (!roots.length || roots.some(root => !VAULT_ROOTS.includes(root as typeof VAULT_ROOTS[number]))) {
    throw new CloudJobError(503, 'Approved vault roots must be a configured subset of the existing agent roots.')
  }
  const input = record(value)
  exactKeys(input, ['mode', 'instruction', 'notes', 'consent'])
  if (input.consent !== true || typeof input.mode !== 'string' || !['task', 'answer', 'organize'].includes(input.mode) ||
      typeof input.instruction !== 'string' || !input.instruction.trim() || bytes(input.instruction.trim()) > 4000 ||
      !Array.isArray(input.notes) || !input.notes.length || input.notes.length > 40) {
    throw new CloudJobError(400, 'Approve a task, answer or organize snapshot with 1–40 notes.')
  }
  const paths = new Set<string>()
  const notes = input.notes.map(value => {
    const note = record(value)
    exactKeys(note, ['path', 'content'])
    const { path, content } = note
    if (typeof path !== 'string' || typeof content !== 'string' ||
        path.length > 240 || !path.endsWith('.md') || path.startsWith('/') || /[\\<>:"|?*\u0000-\u001f\u007f]/.test(path) ||
        path.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) ||
        !roots.some(root => path.startsWith(root)) || paths.has(path.toLowerCase()) ||
        !content || content.includes('\0') || bytes(content) > 16_000) {
      throw new CloudJobError(400, 'Each note needs a unique Markdown path within approved roots and at most 16000 UTF-8 bytes.')
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
    const shareLines = frontmatter?.split(/\r?\n/).filter(line => line.startsWith('cloud-agent-share:'))
    if (shareLines?.length !== 1 || shareLines[0].slice('cloud-agent-share:'.length).trim() !== 'true') {
      throw new CloudJobError(400, 'Every note must explicitly contain exact cloud-agent-share: true frontmatter.')
    }
    if (credentialPattern.test(content)) throw new CloudJobError(400, 'Snapshot note contains a credential pattern; remove it before sharing.')
    paths.add(path.toLowerCase())
    return { path, content }
  })
  notes.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const payload = { mode: input.mode, instruction: input.instruction.trim(), notes }
  if (bytes(JSON.stringify(payload)) > SNAPSHOT_BYTES) throw new CloudJobError(413, 'Serialized snapshot exceeds 64 KiB.')
  return payload
}

export function configuredVaultRoots(value: string | undefined) {
  if (!value?.trim()) return []
  const roots = value.split(',').map(root => root.trim())
  if (roots.some(root => !VAULT_ROOTS.includes(root as typeof VAULT_ROOTS[number]))) return []
  return [...new Set(roots)]
}

export function vaultJobPath(id?: string, result = false) {
  if (id === undefined) return '/jobs'
  if (!/^[a-f0-9]{64}$/.test(id)) throw new CloudJobError(400, 'Invalid job identifier.')
  return `/jobs/${id}${result ? '/result' : ''}`
}

export function validateVaultResponse(value: unknown, expectedId?: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudJobError(502, 'Remote vault service returned an invalid response.')
  const response = value as Record<string, unknown>
  const id = response.id
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || (expectedId !== undefined && id !== expectedId)) {
    throw new CloudJobError(502, 'Remote vault service returned an invalid job identifier.')
  }
  return response
}

export function validateVaultResult(value: unknown, expectedId: string) {
  const response = validateVaultResponse(value, expectedId)
  if (typeof response.mode !== 'string' || !['task', 'answer', 'organize'].includes(response.mode) ||
      typeof response.answer !== 'string' || !Array.isArray(response.edits) ||
      response.edits.some(edit => !edit || typeof edit !== 'object' || Array.isArray(edit))) {
    throw new CloudJobError(502, 'Remote vault service returned an invalid result shape.')
  }
  return response
}

export function upstreamConfig(url: string | undefined, token: string | undefined) {
  if (!url || !token) throw new CloudJobError(503, 'Service is not deployed/configured yet.')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new CloudJobError(503, 'Service configuration is invalid.') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CloudJobError(503, 'Service configuration must be a credential-free HTTPS URL.')
  }
  return { url: parsed.href.replace(/\/$/, ''), token }
}

export async function forwardCloud(
  config: { url: string; token: string }, path: string, payload?: unknown,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 210_000)
  try {
    const response = await fetcher(`${config.url}${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${config.token}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal, redirect: 'manual', cache: 'no-store',
    })
    if (!response.ok) {
      await response.body?.cancel()
      const status = [409, 429, 503].includes(response.status) ? response.status : 502
      throw new CloudJobError(status, status === 409 || status === 429
        ? 'Service busy; one command at a time. Retry later.'
        : status === 503 ? 'Remote service is not configured/available yet.' : 'Remote service rejected the request.')
    }
    const raw = await boundedText(response.body, OUTPUT_BYTES)
    try { return JSON.parse(raw) as unknown }
    catch { throw new CloudJobError(502, 'Remote service returned invalid JSON.') }
  } catch (error) {
    if (error instanceof CloudJobError) throw error
    const cause = error instanceof Error ? error.cause : undefined
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? cause.code : undefined
    console.error('cloud_forward_transport_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
      code,
      aborted: controller.signal.aborted,
      unsupportedCache: error instanceof Error && /unsupported cache/i.test(error.message),
      unsupportedRedirect: error instanceof Error && /redirect/i.test(error.message),
      crossWorker: error instanceof Error && /same.zone|same.account|1042|strictly.public/i.test(error.message),
    })
    throw new CloudJobError(502, 'Remote service unavailable or the 210-second overall wait expired. This does not prove the command was canceled. No automatic retry was sent.')
  } finally { clearTimeout(timer) }
}
