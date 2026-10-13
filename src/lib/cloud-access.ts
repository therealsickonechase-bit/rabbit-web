import { createHash, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTVerifyGetKey, JWTPayload } from 'jose'
import { CloudJobError, forwardCloud, upstreamConfig } from './cloud-jobs.ts'

export const CLOUD_SCOPES = ['shell.execute', 'vault.submit', 'vault.read'] as const
export type CloudScope = typeof CLOUD_SCOPES[number]
export type CloudIdentity = { subject: string; scopes: CloudScope[]; machine: boolean }
export type CloudConfig = Record<string, string | undefined>

export function accessMode(config: CloudConfig) {
  const mode = config.CLOUD_TOOLS_ACCESS_MODE ?? 'local-only'
  if (!['local-only', 'supabase', 'cloudflare-access'].includes(mode)) throw new CloudJobError(503, 'Cloud access mode is invalid.')
  return mode
}

export function requireRemoteMode(config: CloudConfig) {
  const mode = accessMode(config)
  if (mode === 'local-only') throw new CloudJobError(403, 'Local-only mode: all remote cloud integrations are disabled.')
  return mode
}

export function allowedEmail(value: unknown, config: CloudConfig) {
  if (typeof value !== 'string') throw new CloudJobError(403, 'An allowlisted verified email is required.')
  const email = value.trim().toLowerCase()
  const allowed = (config.CLOUD_TOOLS_ALLOWED_EMAILS ?? '').split(',').map(item => item.trim().toLowerCase())
    .filter(item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowed.includes(email)) {
    throw new CloudJobError(403, 'This identity is not in the owner-controlled cloud allowlist.')
  }
  return email
}

export function requestedScopes(value: unknown, allowed: readonly string[] = CLOUD_SCOPES): CloudScope[] {
  if (!Array.isArray(value) || !value.length || value.length > CLOUD_SCOPES.length ||
      value.some(scope => typeof scope !== 'string' || !CLOUD_SCOPES.includes(scope as CloudScope) || !allowed.includes(scope)) ||
      new Set(value).size !== value.length) throw new CloudJobError(403, 'Explicit permitted cloud scopes are required.')
  return [...value].sort() as CloudScope[]
}

export function supabaseIdentity(user: { email?: string; email_confirmed_at?: string | null } | null, config: CloudConfig): CloudIdentity {
  if (!user || !user.email_confirmed_at) throw new CloudJobError(401, 'An existing confirmed Supabase user is required.')
  return { subject: `email:${allowedEmail(user.email, config)}`, scopes: [...CLOUD_SCOPES], machine: false }
}

export function accessJwtConfig(config: CloudConfig) {
  const issuer = config.CLOUD_TOOLS_ACCESS_ISSUER
  const audience = config.CLOUD_TOOLS_ACCESS_AUD
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience?.trim()) {
    throw new CloudJobError(503, 'Cloudflare Access issuer/audience is not configured.')
  }
  return { issuer, audience, jwks: new URL(`${issuer}/cdn-cgi/access/certs`) }
}

const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
export async function verifiedAccessJwt(token: string | null, config: CloudConfig, key?: JWTVerifyGetKey): Promise<JWTPayload> {
  const { issuer, audience, jwks } = accessJwtConfig(config)
  if (!token || token.length > 16_000) throw new CloudJobError(401, 'A signed Cloudflare Access application JWT is required.')
  let resolver = key ?? keysets.get(issuer)
  if (!resolver) {
    const remote = createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 300_000 })
    keysets.set(issuer, remote)
    resolver = remote
  }
  try {
    const { payload } = await jwtVerify(token, resolver, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'],
    })
    if (payload.type !== 'app') throw new Error('not application token')
    return payload
  } catch { throw new CloudJobError(401, 'Cloudflare Access JWT verification failed.') }
}

export function accessHumanIdentity(payload: JWTPayload, config: CloudConfig): CloudIdentity {
  return { subject: `email:${allowedEmail(payload.email, config)}`, scopes: [...CLOUD_SCOPES], machine: false }
}

export async function machineIdentity(request: Request, config: CloudConfig, key?: JWTVerifyGetKey): Promise<CloudIdentity> {
  const mode = requireRemoteMode(config)
  if (request.headers.has('origin')) throw new CloudJobError(403, 'Machine cloud routes refuse all browser Origin headers.')
  const token = config.CLOUD_TOOLS_AGENT_TOKEN
  const id = config.CLOUD_TOOLS_AGENT_ID
  if (!token || token.length < 32 || !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new CloudJobError(503, 'Dedicated agent credentials/identity are not configured.')
  }
  const authorization = request.headers.get('authorization') ?? ''
  const expected = createHash('sha256').update(`Bearer ${token}`).digest()
  const received = createHash('sha256').update(authorization).digest()
  if (!timingSafeEqual(expected, received)) throw new CloudJobError(401, 'Invalid dedicated agent credential.')
  const scopes = requestedScopes((config.CLOUD_TOOLS_AGENT_SCOPES ?? '').split(',').map(scope => scope.trim()))
  if (mode === 'cloudflare-access') {
    if (!config.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME) throw new CloudJobError(503, 'Access service Client ID is not configured.')
    const payload = await verifiedAccessJwt(request.headers.get('cf-access-jwt-assertion'), config, key)
    if (payload.sub !== '' || payload.common_name !== config.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME) {
      throw new CloudJobError(403, 'Access service Client ID mismatch.')
    }
  }
  return { subject: `agent:${id}`, scopes, machine: true }
}

export function requireGrant(value: unknown, identity: CloudIdentity, scope: CloudScope, now = Date.now()) {
  const grant = value as { approved?: unknown; scopes?: unknown; expiresAt?: unknown; requestId?: unknown; subject?: unknown } | null
  if (!identity.scopes.includes(scope)) throw new CloudJobError(403, 'Identity configuration does not permit this scope.')
  if (!grant || grant.approved !== true || !Array.isArray(grant.scopes) || !grant.scopes.includes(scope) ||
      grant.scopes.some(item => !CLOUD_SCOPES.includes(item as CloudScope)) ||
      typeof grant.expiresAt !== 'number' || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now ||
      grant.expiresAt > now + 3600_000 || (grant.subject !== undefined && grant.subject !== identity.subject)) {
    throw new CloudJobError(403, 'Agent approval is pending, expired, revoked or missing the required scope. Request access and refresh status.')
  }
}

export function brokerConfig(config: CloudConfig) {
  if ((config.RABBIT_CLOUDSHELL_TOKEN?.length ?? 0) < 32) throw new CloudJobError(503, 'Approval broker is not configured.')
  return upstreamConfig(config.RABBIT_CLOUDSHELL_URL, config.RABBIT_CLOUDSHELL_TOKEN)
}

export async function checkCloudGrant(identity: CloudIdentity, scope: CloudScope, config: CloudConfig, fetcher: typeof fetch = fetch) {
  requireRemoteMode(config)
  if (!identity.scopes.includes(scope)) throw new CloudJobError(403, 'Identity configuration does not permit this scope.')
  const grant = await forwardCloud(brokerConfig(config), '/access/check', { subject: identity.subject }, fetcher)
  requireGrant(grant, identity, scope)
}

export async function linkCloudJob(identity: CloudIdentity, jobId: string, config: CloudConfig, fetcher: typeof fetch = fetch) {
  if (!/^[a-f0-9]{64}$/.test(jobId)) throw new CloudJobError(502, 'Invalid submitted vault job ID.')
  try {
    const response = await forwardCloud(brokerConfig(config), '/access/link-job', { subject: identity.subject, jobId }, fetcher) as { linked?: unknown; jobId?: unknown } | null
    if (!response || response.linked !== true || response.jobId !== jobId) throw new Error('link rejected')
  } catch {
    throw new CloudJobError(502, `Vault job was submitted but authorization linkage failed (possibly expired/revoked grant). Submitted job ID: ${jobId}. This is not a successful bridge submission; do not automatically retry. Ask the operator to review recovery.`)
  }
}

export async function checkCloudJob(identity: CloudIdentity, jobId: string, config: CloudConfig, fetcher: typeof fetch = fetch) {
  if (!/^[a-f0-9]{64}$/.test(jobId)) throw new CloudJobError(400, 'Invalid job identifier.')
  if (!identity.scopes.includes('vault.read')) throw new CloudJobError(403, 'Identity configuration does not permit vault reads.')
  const response = await forwardCloud(brokerConfig(config), '/access/check-job', { subject: identity.subject, jobId }, fetcher) as { approved?: unknown; expiresAt?: unknown } | null
  const now = Date.now()
  if (!response || response.approved !== true || typeof response.expiresAt !== 'number' ||
      !Number.isSafeInteger(response.expiresAt) || response.expiresAt <= now || response.expiresAt > now + 3600_000) {
    throw new CloudJobError(403, 'Vault job is not linked to this identity and active grant, or its grant expired/revoked. Other people’s or agents’ job IDs cannot be read.')
  }
}
